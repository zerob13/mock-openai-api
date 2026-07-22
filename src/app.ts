import { randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'
import cors from 'cors'
import express, { type Request, type RequestHandler, type Response } from 'express'
import {
  captureRequestIncludeUsage,
  captureRequestStream,
  captureToScenario,
} from './capture-utils.js'
import { proxyAndRecord, readRawBody, requestStreamOptions } from './gateway.js'
import { parseUpstreamBaseUrl, resolveNetworkTarget } from './network.js'
import {
  CaptureStore,
  createCaptureWriter,
  extractCredentialSecrets,
  replayCaptureResponse,
  type CaptureProtocol,
} from './recording.js'
import routes from './routes/index.js'
import { GATEWAY_PROTOCOLS, type GatewayProtocol, type ReplaySpeed, type RuntimeConfig, RuntimeState } from './runtime.js'
import { compileScenario, type CompiledResponse, type ScenarioV1 } from './scenario.js'
import { ScenarioStore } from './scenario-store.js'

declare global {
  var verboseLogging: boolean
}

const ENDPOINTS: Record<GatewayProtocol, string> = {
  'openai-chat': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'anthropic-messages': '/v1/messages',
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
])

export interface RuntimeMetrics {
  activeRequests: number
  errorCount: number
}

export interface GatewayContext {
  runtime: RuntimeState
  captures: CaptureStore
  scenarios: ScenarioStore
  capturesDirectory: string
  metrics: RuntimeMetrics
}

function protocolError(protocol: GatewayProtocol, message: string, code = 'invalid_request_error'): unknown {
  if (protocol === 'anthropic-messages') {
    return { type: 'error', error: { type: code, message } }
  }
  return { error: { message, type: code, param: null, code } }
}

export function resolveUpstreamUrl(baseUrl: string, protocol: GatewayProtocol): string {
  if (!baseUrl) throw new Error(`No upstream configured for ${protocol}`)
  const url = parseUpstreamBaseUrl(baseUrl)

  const endpoint = ENDPOINTS[protocol]
  const pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith(endpoint)) {
    url.pathname = pathname
  } else if (pathname.endsWith('/v1')) {
    url.pathname = `${pathname}${endpoint.slice(3)}`
  } else {
    url.pathname = `${pathname}${endpoint}`.replace(/\/{2,}/g, '/')
  }
  return url.toString()
}

function requestMetadata(body: Buffer): { stream: boolean; includeUsage: boolean; model?: string } {
  const stream = requestStreamOptions(body)
  if (body.length === 0) return stream
  const value = JSON.parse(body.toString('utf8')) as { model?: unknown }
  return { ...stream, model: typeof value.model === 'string' ? value.model : undefined }
}

function abortSignal(request: Request, response: Response): AbortSignal {
  const controller = new AbortController()
  request.once('aborted', () => controller.abort())
  response.once('close', () => {
    if (!response.writableEnded) controller.abort()
  })
  return controller.signal
}

async function writeResponseChunk(response: ServerResponse, data: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw Object.assign(new Error('Request aborted'), { name: 'AbortError' })
  if (response.write(data)) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      response.off('drain', drained)
      response.off('close', closed)
      response.off('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    const drained = (): void => { cleanup(); resolve() }
    const failed = (error: Error): void => { cleanup(); reject(error) }
    const closed = (): void => { cleanup(); reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })) }
    const aborted = (): void => { cleanup(); reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' })) }
    response.once('drain', drained)
    response.once('close', closed)
    response.once('error', failed)
    signal.addEventListener('abort', aborted, { once: true })
  })
}

function filteredHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())))
}

async function waitUntil(originNs: bigint, atMs: number, speed: ReplaySpeed, signal: AbortSignal): Promise<void> {
  if (speed === 'instant') return
  const targetNs = originNs + BigInt(Math.round(atMs * 1_000_000 / speed))
  while (true) {
    if (signal.aborted) throw Object.assign(new Error('Request aborted'), { name: 'AbortError' })
    const remaining = targetNs - process.hrtime.bigint()
    if (remaining <= 0n) return
    await new Promise<void>((resolve, reject) => {
      const done = (): void => {
        signal.removeEventListener('abort', aborted)
        resolve()
      }
      const aborted = (): void => {
        clearTimeout(timer)
        reject(Object.assign(new Error('Request aborted'), { name: 'AbortError' }))
      }
      const timer = setTimeout(done, Math.max(1, Math.ceil(Number(remaining) / 1_000_000)))
      signal.addEventListener('abort', aborted, { once: true })
    })
  }
}

async function sendCompiled(
  response: Response,
  compiled: CompiledResponse,
  speed: ReplaySpeed,
  originNs: bigint,
  signal: AbortSignal,
): Promise<void> {
  response.status(compiled.status).set(filteredHeaders(compiled.headers))
  if (!compiled.stream) {
    response.end(compiled.body)
    return
  }
  response.flushHeaders()
  for (const frame of compiled.frames) {
    await waitUntil(originNs, frame.atMs, speed, signal)
    await writeResponseChunk(response, frame.data, signal)
  }
  response.end()
}

async function resolveScenario(
  context: GatewayContext,
  config: RuntimeConfig,
  protocol: GatewayProtocol,
  stream: boolean,
): Promise<{ scenario: ScenarioV1; speed: ReplaySpeed }> {
  if (config.mode === 'builtin') {
    return { scenario: await context.scenarios.read('builtin-markdown'), speed: 1 }
  }
  const binding = config.bindings[protocol][stream ? 'stream' : 'nonstream']
  if (binding.kind === 'scenario') {
    return { scenario: await context.scenarios.read(binding.id), speed: binding.speed }
  }
  const capture = await context.captures.read(binding.id)
  return {
    scenario: captureToScenario(capture, `derived-${capture.header.id}`, `Derived from ${capture.header.id}`),
    speed: binding.speed,
  }
}

async function recordPreflightFailure(
  request: Request,
  response: Response,
  protocol: GatewayProtocol,
  upstreamUrl: string,
  capturesDirectory: string,
  error: Error,
): Promise<void> {
  const downstreamUrl = `http://${request.headers.host ?? 'localhost'}${request.originalUrl}`
  const writer = await createCaptureWriter({
    directory: capturesDirectory,
    protocol,
    downstreamUrl,
    upstreamUrl,
    request: {
      method: request.method,
      httpVersion: request.httpVersion,
      headers: request.rawHeaders,
      url: downstreamUrl,
    },
    credentialSecrets: extractCredentialSecrets(request.rawHeaders, downstreamUrl),
  })
  try {
    for await (const value of request) {
      await writer.recordRequestChunk(Buffer.from(value as Uint8Array), { forwarded: false })
    }
    await writer.endRequest()
    await writer.recordFailure('upstream', error)
    const body = Buffer.from(JSON.stringify(protocolError(protocol, 'Upstream request failed', 'upstream_error')))
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
    }
    const atUs = writer.elapsedUs()
    response.writeHead(502, headers)
    await writer.recordResponseHead({ status: 502, headers, source: 'gateway' }, atUs)
    response.end(body)
    await writer.recordResponseChunk(body, { atUs })
    await writer.endResponse({ atUs: writer.elapsedUs() })
    await writer.finish({
      outcome: 'upstream_error',
      downstreamBytesWritten: body.byteLength,
      timingReplayable: true,
    })
  } catch (failure) {
    await writer.abandon()
    throw failure
  }
}

function gatewayHandler(protocol: GatewayProtocol, context: GatewayContext): RequestHandler {
  return async (request, response) => {
    const originNs = process.hrtime.bigint()
    const config = context.runtime.snapshot()
    const signal = abortSignal(request, response)
    context.metrics.activeRequests += 1
    try {
      if (!config.enabledEndpoints.includes(protocol)) {
        response.status(404).json(protocolError(protocol, `${protocol} endpoint is disabled`, 'not_found_error'))
        return
      }

      if (config.mode === 'record') {
        const upstream = config.upstreams[protocol]
        const upstreamUrl = resolveUpstreamUrl(upstream.baseUrl, protocol)
        let target
        try {
          target = await resolveNetworkTarget(upstreamUrl, upstream.allowPrivateNetwork)
        } catch (error) {
          await recordPreflightFailure(
            request,
            response,
            protocol,
            upstreamUrl,
            context.capturesDirectory,
            error instanceof Error ? error : new Error(String(error)),
          )
          return
        }
        await proxyAndRecord({
          request,
          response,
          protocol,
          upstreamUrl: target.url.toString(),
          capturesDirectory: context.capturesDirectory,
          lookup: target.lookup,
        })
        return
      }

      const body = await readRawBody(request)
      const metadata = requestMetadata(body)
      const binding = config.bindings[protocol][metadata.stream ? 'stream' : 'nonstream']
      if (config.mode === 'replay' && binding.kind === 'capture') {
        const capture = await context.captures.read(binding.id)
        const rawShapeMatches = capture.header.protocol === protocol
          && captureRequestStream(capture) === metadata.stream
        if (rawShapeMatches && captureRequestIncludeUsage(capture) !== metadata.includeUsage) {
          response.status(409).json(protocolError(
            protocol,
            'Request stream_options.include_usage does not match the body-exact capture',
            'replay_options_mismatch',
          ))
          return
        }
        if (rawShapeMatches && binding.speed !== 'instant' && capture.captureEnd?.timingReplayable !== true) {
          response.status(422).json(protocolError(
            protocol,
            'Capture timing is not replayable; choose instant speed or semantic replay',
            'timing_replay_unsupported',
          ))
          return
        }
        if (rawShapeMatches) {
          await replayCaptureResponse(capture, response, {
            speed: binding.speed,
            signal,
            startTimeNs: originNs,
            targetProtocol: protocol as CaptureProtocol,
          })
          return
        }
      }

      const source = await resolveScenario(context, config, protocol, metadata.stream)
      const compiled = compileScenario(protocol, source.scenario, {
        stream: metadata.stream,
        includeUsage: metadata.includeUsage,
        model: metadata.model,
        invocationId: randomUUID(),
        createdAt: Math.floor(Date.now() / 1000),
      })
      await sendCompiled(response, compiled, source.speed, originNs, signal)
    } catch (error) {
      if ((error as Error).name === 'AbortError') return
      context.metrics.errorCount += 1
      if (!response.headersSent) {
        const message = error instanceof SyntaxError ? 'Request body must be valid JSON' : (error as Error).message
        const status = error instanceof SyntaxError ? 400
          : /request body exceeds/i.test(message) ? 413
          : /unsupported|cannot semantically|does not allow/i.test(message) ? 422
            : 500
        response.status(status).json(protocolError(
          protocol,
          message,
          status === 400 ? 'invalid_json'
            : status === 413 ? 'request_too_large'
              : status === 422 ? 'semantic_replay_unsupported' : 'gateway_error',
        ))
      } else if (!response.writableEnded) {
        response.destroy(error instanceof Error ? error : undefined)
      }
    } finally {
      context.metrics.activeRequests -= 1
    }
  }
}

export function createApiApp(context: GatewayContext): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(cors())
  app.post('/v1/chat/completions', gatewayHandler('openai-chat', context))
  app.post('/chat/completions', gatewayHandler('openai-chat', context))
  app.post('/v1/responses', gatewayHandler('openai-responses', context))
  app.post('/v1/messages', gatewayHandler('anthropic-messages', context))

  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.get('/', (_request, response) => {
    response.json({
      message: 'Mock OpenAI API Server',
      status: 'running',
      mode: context.runtime.snapshot().mode,
      endpoints: ENDPOINTS,
    })
  })
  app.use(routes)
  app.use((request, response) => {
    response.status(404).json({
      error: {
        message: `Path not found: ${request.originalUrl}`,
        type: 'not_found_error',
        code: 'path_not_found',
      },
    })
  })
  return app
}

export const API_ENDPOINTS = ENDPOINTS
export const SUPPORTED_PROTOCOLS = GATEWAY_PROTOCOLS
