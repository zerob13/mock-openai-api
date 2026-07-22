import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { LookupFunction } from 'node:net'
import type { Request, Response } from 'express'
import {
  createCaptureWriter,
  extractCredentialSecrets,
  type CaptureProtocol,
  type HeaderPair,
} from './recording.js'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function rawPairs(rawHeaders: string[]): HeaderPair[] {
  const pairs: HeaderPair[] = []
  for (let index = 0; index < rawHeaders.length; index += 2) {
    pairs.push([rawHeaders[index], rawHeaders[index + 1] ?? ''])
  }
  return pairs
}

function connectionTokens(pairs: HeaderPair[]): Set<string> {
  return new Set(
    pairs
      .filter(([name]) => name.toLowerCase() === 'connection')
      .flatMap(([, value]) => value.split(','))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function forwardHeaderPairs(rawHeaders: string[]): HeaderPair[] {
  const pairs = rawPairs(rawHeaders)
  const dynamic = connectionTokens(pairs)
  return pairs.filter(([name]) => {
    const lower = name.toLowerCase()
    return lower !== 'host' && !HOP_BY_HOP.has(lower) && !dynamic.has(lower)
  })
}

function trailerDeclarationPairs(rawHeaders: string[]): HeaderPair[] {
  const names = rawPairs(rawHeaders)
    .filter(([name]) => name.toLowerCase() === 'trailer')
    .flatMap(([, value]) => value.split(','))
    .map((name) => name.trim())
    .filter((name) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
    .filter((name) => !HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'content-length')
  return names.length > 0 ? [['Trailer', [...new Set(names)].join(', ')]] : []
}

function headerObject(pairs: HeaderPair[]): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  for (const [name, value] of pairs) {
    const key = name.toLowerCase()
    const existing = result[key]
    if (existing === undefined) result[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else result[key] = [existing, value]
  }
  return result
}

function protocolError(protocol: CaptureProtocol, message: string): Buffer {
  const payload = protocol === 'anthropic-messages'
    ? { type: 'error', error: { type: 'api_error', message } }
    : { error: { type: 'api_error', code: 'upstream_error', message } }
  return Buffer.from(JSON.stringify(payload))
}

function isEventStream(headers: HeaderPair[]): boolean {
  return headers.some(([name, value]) => (
    name.toLowerCase() === 'content-type'
    && value.split(';', 1)[0].trim().toLowerCase() === 'text/event-stream'
  ))
}

function terminalMarkerDetector(protocol: CaptureProtocol): {
  observe: (chunk: Buffer) => void
  result: () => { kind: string; observed: boolean }
} {
  const marker = protocol === 'openai-chat'
    ? { kind: 'openai-chat-done', pattern: /(?:^|[\r\n])data:\s*\[DONE\]\s*(?=[\r\n]|$)/ }
    : protocol === 'openai-responses'
      ? { kind: 'openai-response-terminal', pattern: /(?:^|[\r\n])event:\s*response\.(?:completed|failed|incomplete)\s*(?=[\r\n]|$)/ }
      : { kind: 'anthropic-stream-terminal', pattern: /(?:^|[\r\n])event:\s*(?:message_stop|error)\s*(?=[\r\n]|$)/ }
  let tail = ''
  let observed = false
  return {
    observe(chunk) {
      if (observed) return
      tail += chunk.toString('latin1')
      observed = marker.pattern.test(tail)
      tail = tail.slice(-512)
    },
    result: () => ({ kind: marker.kind, observed }),
  }
}

type ProxyWritable = http.ClientRequest | ServerResponse

function waitForDrain(stream: ProxyWritable): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      stream.off('drain', drained)
      stream.off('error', failed)
      stream.off('close', closed)
    }
    const drained = (): void => {
      cleanup()
      resolve()
    }
    const failed = (error: Error): void => {
      cleanup()
      reject(error)
    }
    const closed = (): void => {
      cleanup()
      reject(new Error('Writable stream closed before drain'))
    }
    stream.once('drain', drained)
    stream.once('error', failed)
    stream.once('close', closed)
  })
}

async function writeWithBackpressure(
  stream: ProxyWritable,
  chunk: Buffer,
  accepted: () => Promise<void> | void,
): Promise<void> {
  if (stream.destroyed || stream.writableEnded) throw new Error('Writable stream is closed')
  const canContinue = stream.write(chunk)
  const drain = canContinue ? Promise.resolve() : waitForDrain(stream)
  await Promise.all([Promise.resolve(accepted()), drain])
}

export async function readRawBody(request: IncomingMessage, limit = 32 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const value of request) {
    const chunk = Buffer.from(value as Uint8Array)
    bytes += chunk.byteLength
    if (bytes > limit) throw new Error(`Request body exceeds ${limit} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function requestStreamOptions(body: Buffer): { stream: boolean; includeUsage: boolean } {
  if (body.length === 0) return { stream: false, includeUsage: false }
  const value = JSON.parse(body.toString('utf8')) as { stream?: unknown; stream_options?: { include_usage?: unknown } }
  return {
    stream: value.stream === true,
    includeUsage: value.stream_options?.include_usage === true,
  }
}

export interface ProxyRecordOptions {
  request: Request
  response: Response
  protocol: CaptureProtocol
  upstreamUrl: string
  capturesDirectory: string
  lookup?: LookupFunction
}

export async function proxyAndRecord(options: ProxyRecordOptions): Promise<void> {
  const { request, response, protocol, capturesDirectory } = options
  const upstreamUrl = new URL(options.upstreamUrl)
  if (upstreamUrl.protocol !== 'http:' && upstreamUrl.protocol !== 'https:') {
    throw new Error('Upstream URL must use http or https')
  }
  if (upstreamUrl.username || upstreamUrl.password) throw new Error('Upstream URL must not include credentials')

  const downstreamUrl = `http://${request.headers.host ?? 'localhost'}${request.originalUrl}`
  upstreamUrl.search = new URL(request.originalUrl, 'http://downstream.invalid').search
  const forwardedPairs = [
    ...forwardHeaderPairs(request.rawHeaders),
    ...trailerDeclarationPairs(request.rawHeaders),
  ]
  const forwardedHeaders = headerObject(forwardedPairs)
  const writer = await createCaptureWriter({
    directory: capturesDirectory,
    protocol,
    downstreamUrl,
    upstreamUrl: upstreamUrl.toString(),
    request: {
      method: request.method,
      httpVersion: request.httpVersion,
      headers: request.rawHeaders,
      url: downstreamUrl,
    },
    credentialSecrets: extractCredentialSecrets(request.rawHeaders, downstreamUrl),
  })

  const transport = upstreamUrl.protocol === 'https:' ? https : http
  let responseStarted = false
  let responseCompleted = false
  let responseProtocolComplete = true
  let upstreamResponseReceived = false
  let requestCompleted = false
  let clientDisconnected = false
  let forwardingStopped = false
  let downstreamBytesWritten = 0
  let downstreamRequestEndAtUs: number | undefined
  let downstreamResponseHeadAtUs: number | undefined
  let upstreamRequest: http.ClientRequest | undefined
  let networkRecords = Promise.resolve()

  const recordNetwork = (
    event: 'socket' | 'lookup' | 'connect' | 'secureConnect',
    details: { reusedSocket?: boolean; address?: string; family?: string | number } = {},
  ): void => {
    const atUs = writer.elapsedUs()
    networkRecords = networkRecords.then(() => writer.recordNetwork(event, details, atUs))
  }

  const timingReplayable = (): boolean => (
    downstreamRequestEndAtUs === undefined
    || downstreamResponseHeadAtUs === undefined
    || downstreamResponseHeadAtUs >= downstreamRequestEndAtUs
  )

  const upstreamDispatchedAtUs = writer.elapsedUs()
  const responseTask = new Promise<void>((resolve, reject) => {
    upstreamRequest = transport.request(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders,
      setHost: true,
      lookup: options.lookup,
    }, (upstreamResponse) => {
      upstreamResponseReceived = true
      responseStarted = true
      void (async () => {
        const observedAtUs = writer.elapsedUs()
        await writer.recordUpstreamResponseHead({
          status: upstreamResponse.statusCode ?? 502,
          statusText: upstreamResponse.statusMessage,
          httpVersion: upstreamResponse.httpVersion,
          headers: upstreamResponse.rawHeaders,
        }, observedAtUs)

        const responsePairs = [
          ...forwardHeaderPairs(upstreamResponse.rawHeaders),
          ...trailerDeclarationPairs(upstreamResponse.rawHeaders),
        ]
        const responseHead = {
          status: upstreamResponse.statusCode ?? 502,
          statusText: upstreamResponse.statusMessage,
          httpVersion: upstreamResponse.httpVersion,
          headers: responsePairs,
        }
        const responseHeadAtUs = writer.elapsedUs()
        downstreamResponseHeadAtUs = responseHeadAtUs
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          headerObject(responsePairs),
        )
        await writer.recordResponseHead(responseHead, responseHeadAtUs)

        const eventStream = isEventStream(responsePairs)
        const markerDetector = terminalMarkerDetector(protocol)
        for await (const value of upstreamResponse) {
          const chunk = Buffer.from(value as Uint8Array)
          const upstreamObservedAtUs = writer.elapsedUs()
          const writtenAtUs = writer.elapsedUs()
          await writeWithBackpressure(response, chunk, async () => {
            downstreamBytesWritten += chunk.byteLength
            await writer.recordResponseChunk(chunk, { atUs: writtenAtUs, upstreamObservedAtUs })
          })
          if (eventStream) markerDetector.observe(chunk)
        }

        const responseBodyEndAtUs = writer.elapsedUs()
        await writer.flushResponseBody(responseBodyEndAtUs)

        if (upstreamResponse.rawTrailers.length > 0) {
          await writer.recordTrailers('upstream.response', upstreamResponse.rawTrailers)
          const trailers = forwardHeaderPairs(upstreamResponse.rawTrailers)
          if (trailers.length > 0) {
            await writer.recordTrailers('response', trailers)
            response.addTrailers(headerObject(trailers))
          }
        }
        await writer.endUpstreamResponse()
        const responseEndAtUs = writer.elapsedUs()
        response.end()
        responseCompleted = true
        const terminalMarker = eventStream ? markerDetector.result() : undefined
        responseProtocolComplete = terminalMarker?.observed !== false
        await writer.endResponse({
          atUs: responseEndAtUs,
          complete: responseProtocolComplete,
          eofObserved: true,
          terminalMarker,
        })
      })().then(resolve, reject)
    })
    upstreamRequest.once('error', reject)
    upstreamRequest.once('close', () => {
      if (!upstreamResponseReceived) reject(new Error('Upstream request closed before response'))
    })
  })

  const requestTarget = upstreamRequest
  requestTarget?.once('socket', (socket) => {
    recordNetwork('socket', { reusedSocket: requestTarget.reusedSocket })
    socket.once('lookup', (error, address, family) => {
      if (!error) recordNetwork('lookup', { address, family: family ?? undefined })
    })
    socket.once('connect', () => {
      recordNetwork('connect', {
        address: socket.remoteAddress,
        family: socket.remoteFamily ?? undefined,
      })
    })
    socket.once('secureConnect', () => {
      recordNetwork('secureConnect', {
        address: socket.remoteAddress,
        family: socket.remoteFamily ?? undefined,
      })
    })
  })
  const upstreamHeadTask = requestTarget
    ? writer.recordUpstreamRequestHead({
      method: request.method,
      url: upstreamUrl.toString(),
      headers: { ...forwardedHeaders, host: upstreamUrl.host },
    }, upstreamDispatchedAtUs)
    : Promise.resolve()

  response.once('close', () => {
    if (!response.writableEnded) {
      clientDisconnected = true
      requestTarget?.destroy(new Error('Downstream client disconnected'))
    }
  })

  const requestTask = requestTarget ? (async () => {
    for await (const value of request) {
      const chunk = Buffer.from(value as Uint8Array)
      const observedAtUs = writer.elapsedUs()
      const recording = writer.recordRequestChunk(chunk, { atUs: observedAtUs, forwarded: false })
      if (forwardingStopped) {
        await recording
        continue
      }
      try {
        if (requestTarget.destroyed || requestTarget.writableEnded) {
          throw new Error('Upstream request is closed')
        }
        const canContinue = requestTarget.write(chunk)
        writer.observeForwardedRequestChunk(chunk)
        const drain = canContinue ? Promise.resolve() : waitForDrain(requestTarget)
        await Promise.all([recording, drain])
      } catch (error) {
        await recording.catch(() => undefined)
        throw error
      }
    }
    downstreamRequestEndAtUs = writer.elapsedUs()
    await writer.flushRequestBody(downstreamRequestEndAtUs)
    if (request.rawTrailers.length > 0) {
      await writer.recordTrailers('request', request.rawTrailers)
      const trailers = forwardHeaderPairs(request.rawTrailers)
      if (trailers.length > 0) {
        await writer.recordTrailers('upstream.request', trailers)
        requestTarget.addTrailers(headerObject(trailers))
      }
    }
    await writer.endRequest({ atUs: downstreamRequestEndAtUs })
    if (forwardingStopped) {
      await writer.endUpstreamRequest({ complete: false })
    } else {
      requestTarget.end()
      await writer.endUpstreamRequest()
    }
    requestCompleted = true
  })() : Promise.resolve()

  try {
    await Promise.all([upstreamHeadTask, requestTask, responseTask])
    await networkRecords
    await writer.finish({
      outcome: responseProtocolComplete ? 'complete' : 'capture_truncated',
      downstreamBytesWritten,
      timingReplayable: timingReplayable(),
    })
  } catch (error) {
    forwardingStopped = true
    requestTarget?.destroy(new Error('Proxy request aborted'))
    await networkRecords.catch(() => undefined)
    const failure = error instanceof Error ? error : new Error(String(error))
    if (clientDisconnected) {
      request.destroy()
      await Promise.allSettled([upstreamHeadTask, requestTask, responseTask])
      await writer.recordClientDisconnect().catch(() => undefined)
      await writer.endUpstreamResponse({ complete: false }).catch(() => undefined)
      await writer.endResponse({ complete: false, eofObserved: false }).catch(() => undefined)
      await writer.finish({
        outcome: 'client_cancelled',
        downstreamBytesWritten,
        timingReplayable: timingReplayable(),
      }).catch(() => writer.abandon())
      return
    }
    if (responseCompleted) {
      await Promise.allSettled([upstreamHeadTask, requestTask, responseTask])
      await writer.recordFailure('request', failure).catch(() => undefined)
      await writer.finish({
        outcome: requestCompleted
          ? responseProtocolComplete ? 'complete' : 'capture_truncated'
          : 'aborted',
        downstreamBytesWritten,
        timingReplayable: timingReplayable(),
      }).catch(() => writer.abandon())
      return
    }
    await writer.recordFailure(responseStarted ? 'response' : 'upstream', failure).catch(() => undefined)
    if (!response.headersSent && !response.destroyed) {
      const body = protocolError(protocol, 'Upstream request failed')
      const headers: IncomingHttpHeaders = {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(body.byteLength),
      }
      const responseHeadAtUs = writer.elapsedUs()
      downstreamResponseHeadAtUs = responseHeadAtUs
      response.writeHead(502, headers)
      await writer.recordResponseHead({ status: 502, headers, source: 'gateway' }, responseHeadAtUs).catch(() => undefined)
      const writtenAtUs = writer.elapsedUs()
      response.end(body)
      downstreamBytesWritten += body.byteLength
      await writer.recordResponseChunk(body, { atUs: writtenAtUs }).catch(() => undefined)
      await writer.endResponse({ atUs: writtenAtUs }).catch(() => undefined)
    } else {
      if (!response.writableEnded) response.destroy()
      request.destroy()
      await writer.endUpstreamResponse({ complete: false }).catch(() => undefined)
      await writer.endResponse({ complete: false, eofObserved: false }).catch(() => undefined)
    }
    await Promise.allSettled([upstreamHeadTask, requestTask, responseTask])
    await writer.finish({
      outcome: 'upstream_error',
      downstreamBytesWritten,
      timingReplayable: timingReplayable(),
    }).catch(() => writer.abandon())
  }
}
