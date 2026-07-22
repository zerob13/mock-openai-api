import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type Server,
} from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServers } from '../src/server.js'

const ADMIN_TOKEN = 'integration-admin-token'
const runningServers: RunningServers[] = []
const upstreamServers: Server[] = []
const temporaryDirectories: string[] = []

interface RuntimeView {
  mode: 'builtin' | 'record' | 'replay'
  revision: number
  activeRequests: number
  apiBaseUrl: string
  adminBaseUrl: string
  captureCount: number
  scenarioCount: number
  partialCount: number
}

interface CaptureView {
  id: string
  partial: boolean
  protocol: string
  outcome: string
  stream: boolean
  bodyExact: boolean
  timingReplayable: boolean
  valid: boolean
  redactions: string[]
  records: Array<Record<string, unknown>>
  request: { bodyUtf8: string }
  response: { bodyUtf8: string }
  hashes?: { integrity: { request: string; response: string } }
}

interface BindingView {
  protocol: string
  stream: boolean
  sourceType: string
  sourceId: string
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })
}

afterEach(async () => {
  await Promise.allSettled(runningServers.splice(0).map((server) => server.close()))
  await Promise.allSettled(upstreamServers.splice(0).map(closeHttpServer))
  await Promise.allSettled(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function startTestServer(): Promise<RunningServers> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mock-openai-integration-'))
  temporaryDirectories.push(dataDir)
  const webDirectory = join(dataDir, 'web')
  await mkdir(webDirectory)
  await writeFile(join(webDirectory, 'index.html'), '<!doctype html><title>Test admin</title>')
  const servers = await startServer({
    apiHost: '127.0.0.1',
    apiPort: 0,
    adminHost: '127.0.0.1',
    adminPort: 0,
    adminToken: ADMIN_TOKEN,
    dataDir,
    webDirectory,
  })
  runningServers.push(servers)
  return servers
}

async function adminFetch(
  servers: RunningServers,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${ADMIN_TOKEN}`)
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(`${servers.adminUrl}${path}`, { ...init, headers })
}

async function adminJson<T>(
  servers: RunningServers,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await adminFetch(servers, path, init)
  if (!response.ok) throw new Error(`Admin ${response.status}: ${await response.text()}`)
  return response.json() as Promise<T>
}

function requestBody(protocol: string, stream: boolean): Record<string, unknown> {
  if (protocol === 'openai-chat') {
    return {
      model: 'integration-model',
      messages: [{ role: 'user', content: 'Anything' }],
      stream,
      stream_options: stream ? { include_usage: true } : undefined,
    }
  }
  if (protocol === 'openai-responses') {
    return { model: 'integration-model', input: 'Anything', stream }
  }
  return {
    model: 'integration-model',
    max_tokens: 64,
    messages: [{ role: 'user', content: 'Anything' }],
    stream,
  }
}

async function waitForCaptures(servers: RunningServers, count: number): Promise<CaptureView[]> {
  let lastError = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await adminFetch(servers, '/admin/api/captures')
    if (response.ok) {
      const captures = await response.json() as CaptureView[]
      if (captures.length === count && captures.every((capture) => !capture.partial)) return captures
    } else {
      lastError = `${response.status}: ${await response.text()}`
    }
    await delay(10)
  }
  throw new Error(`Timed out waiting for ${count} capture(s)${lastError ? `; last error ${lastError}` : ''}`)
}

async function updateMode(
  servers: RunningServers,
  mode: RuntimeView['mode'],
  upstreams?: unknown[],
  enabledEndpoints?: string[],
): Promise<RuntimeView> {
  const runtime = await adminJson<RuntimeView>(servers, '/admin/api/runtime')
  return adminJson<RuntimeView>(servers, '/admin/api/runtime', {
    method: 'PATCH',
    body: JSON.stringify({ revision: runtime.revision, mode, upstreams, enabledEndpoints }),
  })
}

async function bindCapture(
  servers: RunningServers,
  protocol: string,
  captureId: string,
): Promise<BindingView[]> {
  return adminJson<BindingView[]>(servers, '/admin/api/bindings', {
    method: 'PUT',
    body: JSON.stringify({
      protocol,
      stream: true,
      sourceType: 'capture',
      sourceId: captureId,
      speed: 'instant',
    }),
  })
}

describe('startServer integration', () => {
  it('serves built-in stream and non-stream responses for all three protocols', async () => {
    const servers = await startTestServer()
    const cases = [
      {
        protocol: 'openai-chat',
        path: '/v1/chat/completions',
        object: 'chat.completion',
        streamStart: '"object":"chat.completion.chunk"',
        streamEnd: 'data: [DONE]',
      },
      {
        protocol: 'openai-responses',
        path: '/v1/responses',
        object: 'response',
        streamStart: 'event: response.created',
        streamEnd: 'event: response.completed',
      },
      {
        protocol: 'anthropic-messages',
        path: '/v1/messages',
        object: 'message',
        streamStart: 'event: message_start',
        streamEnd: 'event: message_stop',
      },
    ]

    for (const testCase of cases) {
      const nonStream = await fetch(`${servers.apiUrl}${testCase.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(testCase.protocol, false)),
      })
      expect(nonStream.status).toBe(200)
      expect(nonStream.headers.get('content-type')).toContain('application/json')
      const object = await nonStream.json() as Record<string, unknown>
      expect(object.object ?? object.type).toBe(testCase.object)
      expect(JSON.stringify(object)).toContain('Recorded')
      expect(JSON.stringify(object)).toContain('Replayable')

      const stream = await fetch(`${servers.apiUrl}${testCase.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(testCase.protocol, true)),
      })
      expect(stream.status).toBe(200)
      expect(stream.headers.get('content-type')).toContain('text/event-stream')
      const body = await stream.text()
      expect(body).toContain(testCase.streamStart)
      expect(body).toContain(testCase.streamEnd)
      expect(body).toContain('Recorded')
      expect(body).toContain('Replayable')
      if (testCase.protocol !== 'openai-chat') expect(body).not.toContain('data: [DONE]')
    }
  })

  it('exposes authenticated runtime state and protocol previews through admin', async () => {
    const servers = await startTestServer()
    expect((await fetch(`${servers.adminUrl}/admin/api/runtime`)).status).toBe(401)

    const runtime = await adminJson<RuntimeView>(servers, '/admin/api/runtime')
    expect(runtime).toMatchObject({
      mode: 'builtin',
      revision: 1,
      activeRequests: 0,
      apiBaseUrl: servers.apiUrl,
      adminBaseUrl: servers.adminUrl,
      captureCount: 0,
      scenarioCount: 3,
      partialCount: 0,
    })

    const scenario = await adminJson<Record<string, unknown>>(
      servers,
      '/admin/api/scenarios/builtin-tool-call',
    )
    const preview = await adminJson<{
      protocol: string
      status: number
      headers: Record<string, string>
      frames: Array<{ atUs: number; raw: string }>
    }>(servers, '/admin/api/scenarios/preview/openai-responses', {
      method: 'POST',
      body: JSON.stringify(scenario),
    })
    expect(preview.protocol).toBe('openai-responses')
    expect(preview.status).toBe(200)
    expect(preview.headers['content-type']).toContain('text/event-stream')
    expect(preview.frames[0].raw).toContain('event: response.created')
    expect(preview.frames.map((frame) => frame.raw).join('')).toContain(
      'event: response.function_call_arguments.delta',
    )
    expect(preview.frames.at(-1)?.raw).toContain('event: response.completed')
  })

  it('rejects imported captures that contain unredacted request credentials', async () => {
    const servers = await startTestServer()
    const secret = 'imported-secret-123'
    const request = Buffer.from(`{"apiKey":"${secret}"}`)
    const response = Buffer.from(`{"echo":"${secret}"}`)
    const records = [
      {
        kind: 'capture',
        schema: 'mock-openai-api.capture',
        schemaVersion: 1,
        id: 'cap_importsecret1',
        createdAt: '2026-07-22T00:00:00.000Z',
        protocol: 'openai-chat',
        source: 'record',
        downstreamUrl: 'http://127.0.0.1/v1/chat/completions',
        upstreamUrl: 'https://example.com/v1/chat/completions',
        redactions: [],
      },
      {
        kind: 'request.head',
        atUs: 0,
        method: 'POST',
        httpVersion: '1.1',
        rawHeaders: [['authorization', `Bearer ${secret}`]],
      },
      { kind: 'request.body_chunk', seq: 0, atUs: 1, byteOffset: 0, bytesBase64: request.toString('base64') },
      { kind: 'request.end', atUs: 2, bytes: request.byteLength, sha256: sha256(request), complete: true },
      { kind: 'response.head', atUs: 3, status: 200, httpVersion: '1.1', rawHeaders: [['content-type', 'application/json']] },
      { kind: 'response.body_chunk', seq: 0, atUs: 4, byteOffset: 0, bytesBase64: response.toString('base64') },
      { kind: 'response.end', atUs: 5, bytes: response.byteLength, sha256: sha256(response), complete: true, eofObserved: true },
      {
        kind: 'capture.end',
        atUs: 6,
        outcome: 'complete',
        requestBodyExact: true,
        requestHeadersSanitized: true,
        responseBodyExact: true,
        timingReplayable: true,
        downstreamBytesWritten: response.byteLength,
      },
    ]
    const imported = await adminFetch(servers, '/admin/api/captures/import', {
      method: 'POST',
      headers: { 'content-type': 'application/x-ndjson' },
      body: `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    })
    expect(imported.status).toBe(400)
    expect(await imported.json()).toMatchObject({ error: expect.stringContaining('unredacted credential') })
    expect(await adminJson<CaptureView[]>(servers, '/admin/api/captures')).toEqual([])
  })

  it('records requests rejected by upstream network policy', async () => {
    const servers = await startTestServer()
    await updateMode(servers, 'record', [{
      protocol: 'openai-chat',
      baseUrl: 'http://127.0.0.1:9',
      transport: 'raw',
      auth: 'passthrough',
      allowPrivateNetwork: false,
    }], ['openai-chat'])

    const secret = 'preflight-secret-123'
    const request = requestBody('openai-chat', false)
    const rejected = await fetch(`${servers.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(request),
    })
    expect(rejected.status).toBe(502)
    expect(await rejected.json()).toMatchObject({ error: { code: 'upstream_error' } })

    const [summary] = await waitForCaptures(servers, 1)
    const capture = await adminJson<CaptureView>(
      servers,
      `/admin/api/captures/${encodeURIComponent(summary.id)}`,
    )
    expect(capture).toMatchObject({ outcome: 'upstream_error', bodyExact: true })
    expect(capture.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'failure', scope: 'upstream' }),
      expect.objectContaining({ kind: 'response.head', status: 502, source: 'gateway' }),
    ]))
    const [filename] = (await readdir(join(servers.dataDir, 'captures')))
      .filter((value) => value.endsWith('.llmcap.jsonl'))
    expect(await readFile(join(servers.dataDir, 'captures', filename), 'utf8')).not.toContain(secret)
  })

  it('records a byte-exact raw proxy and replays it raw or transcoded', async () => {
    const event = Buffer.from(
      'data: {"id":"raw-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello 世界"},"finish_reason":null}]}\r\n\r\n',
    )
    const character = event.indexOf(Buffer.from('世'))
    const upstreamChunks = [
      event.subarray(0, character + 1),
      event.subarray(character + 1),
      Buffer.from(
        'data: {"id":"raw-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n',
      ),
    ]
    const upstreamResponse = Buffer.concat(upstreamChunks)
    let observedHeaders: IncomingHttpHeaders = {}
    let observedUrl = ''
    let observedRequestBody = Buffer.alloc(0)

    const upstream = createServer(async (request, response) => {
      observedHeaders = request.headers
      observedUrl = request.url ?? ''
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      observedRequestBody = Buffer.concat(chunks)
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-upstream-id': 'raw-1',
        trailer: 'x-stream-result',
      })
      response.flushHeaders()
      response.write(upstreamChunks[0])
      await delay(12)
      response.write(upstreamChunks[1])
      await delay(12)
      response.write(upstreamChunks[2])
      response.addTrailers({ 'x-stream-result': 'complete' })
      response.end()
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    upstreamServers.push(upstream)
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Upstream did not bind')

    const servers = await startTestServer()
    await updateMode(servers, 'record', [{
      protocol: 'openai-chat',
      baseUrl: `http://127.0.0.1:${address.port}`,
      transport: 'raw',
      auth: 'passthrough',
      allowPrivateNetwork: true,
    }], ['openai-chat'])

    const request = requestBody('openai-chat', true)
    const requestBytes = Buffer.from(JSON.stringify(request))
    const recorded = await fetch(`${servers.apiUrl}/v1/chat/completions?api_key=query-secret`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer authorization-secret',
        'x-api-key': 'header-secret',
      },
      body: requestBytes,
    })
    expect(recorded.status).toBe(200)
    expect(recorded.headers.get('x-upstream-id')).toBe('raw-1')
    expect(Buffer.from(await recorded.arrayBuffer())).toEqual(upstreamResponse)
    expect(observedUrl).toBe('/v1/chat/completions?api_key=query-secret')
    expect(observedHeaders.authorization).toBe('Bearer authorization-secret')
    expect(observedHeaders['x-api-key']).toBe('header-secret')
    expect(observedRequestBody).toEqual(requestBytes)

    const [captureSummary] = await waitForCaptures(servers, 1)
    const capture = await adminJson<CaptureView>(
      servers,
      `/admin/api/captures/${encodeURIComponent(captureSummary.id)}`,
    )
    expect(capture).toMatchObject({
      protocol: 'openai-chat',
      outcome: 'complete',
      stream: true,
      bodyExact: true,
    })
    expect(Buffer.from(capture.request.bodyUtf8)).toEqual(requestBytes)
    expect(Buffer.from(capture.response.bodyUtf8)).toEqual(upstreamResponse)
    const capturedChunkRecords = capture.records
      .filter((record) => record.kind === 'response.body_chunk')
    const capturedChunks = capturedChunkRecords
      .map((record) => Buffer.from(String(record.bytesBase64), 'base64'))
    let byteOffset = 0
    capturedChunkRecords.forEach((record, index) => {
      expect(record.seq).toBe(index)
      expect(record.byteOffset).toBe(byteOffset)
      byteOffset += capturedChunks[index].byteLength
    })
    expect(capturedChunks.length).toBeGreaterThanOrEqual(2)
    expect(Buffer.concat(capturedChunks)).toEqual(upstreamResponse)
    const networkRecords = capture.records.filter((record) => record.kind === 'upstream.network')
    expect(networkRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'socket', reusedSocket: false }),
      expect.objectContaining({ event: 'connect', address: '127.0.0.1' }),
    ]))
    expect(capture.records.find((record) => record.kind === 'response.head')).toMatchObject({
      rawHeaders: expect.arrayContaining([['Trailer', 'x-stream-result']]),
    })
    expect(capture.records.find((record) => record.kind === 'response.trailers')).toMatchObject({
      rawHeaders: [['x-stream-result', 'complete']],
    })

    const captureFiles = (await readdir(join(servers.dataDir, 'captures')))
      .filter((filename) => filename.endsWith('.llmcap.jsonl'))
    expect(captureFiles).toHaveLength(1)
    const captureFile = await readFile(join(servers.dataDir, 'captures', captureFiles[0]), 'utf8')
    expect(captureFile).toContain('[REDACTED]')
    expect(captureFile).not.toContain('query-secret')
    expect(captureFile).not.toContain('authorization-secret')
    expect(captureFile).not.toContain('header-secret')

    let bindings = await bindCapture(servers, 'openai-chat', capture.id)
    expect(bindings).toContainEqual(expect.objectContaining({
      protocol: 'openai-chat',
      stream: true,
      sourceType: 'capture',
      sourceId: capture.id,
    }))
    await updateMode(servers, 'replay', undefined, ['openai-chat', 'anthropic-messages'])

    const sameProtocol = await fetch(`${servers.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'anything',
        messages: [],
        stream: true,
        stream_options: { include_usage: true },
      }),
    })
    expect(sameProtocol.status).toBe(200)
    expect(sameProtocol.headers.get('x-upstream-id')).toBe('raw-1')
    expect(Buffer.from(await sameProtocol.arrayBuffer())).toEqual(upstreamResponse)

    const mismatchedOptions = await fetch(`${servers.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'anything', messages: [], stream: true }),
    })
    expect(mismatchedOptions.status).toBe(409)
    expect(await mismatchedOptions.json()).toMatchObject({
      error: { code: 'replay_options_mismatch' },
    })

    bindings = await bindCapture(servers, 'anthropic-messages', capture.id)
    expect(bindings).toContainEqual(expect.objectContaining({
      protocol: 'anthropic-messages',
      stream: true,
      sourceType: 'capture',
      sourceId: capture.id,
    }))
    const transcoded = await fetch(`${servers.apiUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody('anthropic-messages', true)),
    })
    expect(transcoded.status).toBe(200)
    expect(transcoded.headers.get('content-type')).toContain('text/event-stream')
    const transcodedBody = await transcoded.text()
    expect(transcodedBody).toContain('event: message_start')
    expect(transcodedBody).toContain('"type":"text_delta","text":"hello 世界"')
    expect(transcodedBody).toContain('event: message_stop')
    expect(transcodedBody).not.toContain('data: [DONE]')

    const deleteActive = await adminFetch(
      servers,
      `/admin/api/captures/${encodeURIComponent(capture.id)}`,
      { method: 'DELETE' },
    )
    expect(deleteActive.status).toBe(409)
    expect(await deleteActive.json()).toMatchObject({ error: expect.stringContaining('active replay binding') })
  })

  it('marks protocol-incomplete SSE captures as truncated without affecting JSON captures', async () => {
    const cases = [
      {
        protocol: 'openai-chat',
        path: '/v1/chat/completions',
        markerKind: 'openai-chat-done',
        body: 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
      },
      {
        protocol: 'openai-responses',
        path: '/v1/responses',
        markerKind: 'openai-response-terminal',
        body: 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
      },
      {
        protocol: 'anthropic-messages',
        path: '/v1/messages',
        markerKind: 'anthropic-stream-terminal',
        body: 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"partial"}}\n\n',
      },
    ]
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean }
      if (body.stream === true) {
        if ((body as { model?: string }).model === 'anthropic-error') {
          response.writeHead(200, { 'content-type': 'text/event-stream' })
          response.end('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n')
          return
        }
        const testCase = cases.find((candidate) => candidate.path === request.url)
        response.writeHead(200, { 'content-type': 'Text/Event-Stream; charset=utf-8' })
        response.end(testCase?.body ?? 'data: partial\n\n')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end('{"id":"json-complete","choices":[]}')
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    upstreamServers.push(upstream)
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Upstream did not bind')

    const servers = await startTestServer()
    await updateMode(
      servers,
      'record',
      cases.map(({ protocol }) => ({
        protocol,
        baseUrl: `http://127.0.0.1:${address.port}`,
        transport: 'raw',
        auth: 'passthrough',
        allowPrivateNetwork: true,
      })),
      cases.map(({ protocol }) => protocol),
    )

    for (const testCase of cases) {
      const response = await fetch(`${servers.apiUrl}${testCase.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody(testCase.protocol, true)),
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(testCase.body)
    }

    const jsonResponse = await fetch(`${servers.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody('openai-chat', false)),
    })
    expect(jsonResponse.status).toBe(200)
    expect(await jsonResponse.json()).toMatchObject({ id: 'json-complete' })

    const summaries = await waitForCaptures(servers, 4)
    for (const testCase of cases) {
      const summary = summaries.find((capture) => capture.protocol === testCase.protocol && capture.stream)
      if (!summary) throw new Error(`Missing ${testCase.protocol} stream capture`)
      const capture = await adminJson<CaptureView>(
        servers,
        `/admin/api/captures/${encodeURIComponent(summary.id)}`,
      )
      expect(capture.outcome).toBe('capture_truncated')
      expect(capture.records.find((record) => record.kind === 'response.end')).toMatchObject({
        complete: false,
        eofObserved: true,
        terminalMarker: { kind: testCase.markerKind, observed: false },
      })

      const binding = await adminFetch(servers, '/admin/api/bindings', {
        method: 'PUT',
        body: JSON.stringify({
          protocol: testCase.protocol,
          stream: true,
          sourceType: 'capture',
          sourceId: capture.id,
          speed: 'instant',
        }),
      })
      expect(binding.status).toBe(422)
      expect(await binding.json()).toMatchObject({ error: expect.stringContaining('not complete') })
    }

    const jsonSummary = summaries.find((capture) => capture.protocol === 'openai-chat' && !capture.stream)
    if (!jsonSummary) throw new Error('Missing OpenAI Chat JSON capture')
    const jsonCapture = await adminJson<CaptureView>(
      servers,
      `/admin/api/captures/${encodeURIComponent(jsonSummary.id)}`,
    )
    expect(jsonCapture.outcome).toBe('complete')
    expect(jsonCapture.records.find((record) => record.kind === 'response.end')).toMatchObject({
      complete: true,
      eofObserved: true,
    })
    expect(jsonCapture.records.find((record) => record.kind === 'response.end')).not.toHaveProperty('terminalMarker')
    expect((await adminFetch(servers, '/admin/api/bindings', {
      method: 'PUT',
      body: JSON.stringify({
        protocol: 'openai-chat',
        stream: false,
        sourceType: 'capture',
        sourceId: jsonCapture.id,
        speed: 'instant',
      }),
    })).status).toBe(200)

    const anthropicError = await fetch(`${servers.apiUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody('anthropic-messages', true), model: 'anthropic-error' }),
    })
    expect(anthropicError.status).toBe(200)
    expect(await anthropicError.text()).toContain('event: error')

    const withError = await waitForCaptures(servers, 5)
    const errorSummary = withError.find((capture) => (
      capture.protocol === 'anthropic-messages' && capture.stream && capture.outcome === 'complete'
    ))
    if (!errorSummary) throw new Error('Missing complete Anthropic error capture')
    const errorCapture = await adminJson<CaptureView>(
      servers,
      `/admin/api/captures/${encodeURIComponent(errorSummary.id)}`,
    )
    expect(errorCapture.records.find((record) => record.kind === 'response.end')).toMatchObject({
      complete: true,
      eofObserved: true,
      terminalMarker: { kind: 'anthropic-stream-terminal', observed: true },
    })
  })

  it('redacts cross-chunk credential echoes without changing proxy bytes', async () => {
    const secret = 'cross-chunk-credential-123'
    const querySecret = 'forwarded-query-credential-456'
    const requestBody = Buffer.from(`{"model":"integration","stream":false,"credential":"${secret}"}`)
    const responseBody = Buffer.from(`{"echo":"${secret}"}`)
    let observedUrl = ''
    let observedAuthorization = ''
    let observedRequestBody = Buffer.alloc(0)
    let resolveObservedRequest!: () => void
    const observedRequest = new Promise<void>((resolve) => {
      resolveObservedRequest = resolve
    })

    const upstream = createServer((request, response) => {
      observedUrl = request.url ?? ''
      observedAuthorization = request.headers.authorization ?? ''
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        observedRequestBody = Buffer.concat(chunks)
        resolveObservedRequest()
      })

      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': String(responseBody.byteLength),
      })
      response.flushHeaders()
      const split = responseBody.indexOf(secret) + 6
      response.write(responseBody.subarray(0, split))
      setTimeout(() => response.end(responseBody.subarray(split)), 5)
    })
    upstream.listen(0, '127.0.0.1')
    await once(upstream, 'listening')
    upstreamServers.push(upstream)
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('Upstream did not bind')

    const servers = await startTestServer()
    await updateMode(servers, 'record', [{
      protocol: 'openai-chat',
      baseUrl: `http://127.0.0.1:${address.port}`,
      transport: 'raw',
      auth: 'passthrough',
      allowPrivateNetwork: true,
    }], ['openai-chat'])

    let clientRequest!: ClientRequest
    const downstreamResponse = new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      clientRequest = httpRequest(
        `${servers.apiUrl}/v1/chat/completions?api_key=${querySecret}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/json',
            'content-length': String(requestBody.byteLength),
          },
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', () => resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks),
          }))
        },
      )
      clientRequest.once('error', reject)
    })

    const requestSplit = requestBody.indexOf(secret)
    clientRequest.write(requestBody.subarray(0, requestSplit + 5))
    await delay(25)
    clientRequest.write(requestBody.subarray(requestSplit + 5, requestSplit + 13))
    await delay(25)
    clientRequest.end(requestBody.subarray(requestSplit + 13))

    const result = await downstreamResponse
    await observedRequest
    expect(result).toEqual({ status: 200, body: responseBody })
    expect(observedUrl).toBe(`/v1/chat/completions?api_key=${querySecret}`)
    expect(observedAuthorization).toBe(`Bearer ${secret}`)
    expect(observedRequestBody).toEqual(requestBody)

    const [captureSummary] = await waitForCaptures(servers, 1)
    expect(captureSummary).toMatchObject({
      protocol: 'openai-chat',
      bodyExact: false,
      timingReplayable: false,
      valid: true,
    })
    const capture = await adminJson<CaptureView>(
      servers,
      `/admin/api/captures/${encodeURIComponent(captureSummary.id)}`,
    )
    const sanitizedRequest = Buffer.from(requestBody.toString().replace(secret, '[REDACTED]'))
    const sanitizedResponse = Buffer.from(responseBody.toString().replace(secret, '[REDACTED]'))
    expect(Buffer.from(capture.request.bodyUtf8)).toEqual(sanitizedRequest)
    expect(Buffer.from(capture.response.bodyUtf8)).toEqual(sanitizedResponse)
    expect(capture.hashes?.integrity).toEqual({
      request: 'valid',
      upstreamRequest: 'unavailable',
      response: 'valid',
    })

    const record = (kind: string) => capture.records.find((candidate) => candidate.kind === kind)
    expect(record('request.end')).toMatchObject({
      bytes: sanitizedRequest.byteLength,
      sha256: sha256(sanitizedRequest),
    })
    expect(record('upstream.request.end')).toMatchObject({
      bytes: requestBody.byteLength,
      sha256: sha256(requestBody),
    })
    expect(record('response.end')).toMatchObject({
      bytes: sanitizedResponse.byteLength,
      sha256: sha256(sanitizedResponse),
    })
    expect(record('upstream.response.end')).toMatchObject({
      bytes: responseBody.byteLength,
      sha256: sha256(responseBody),
    })
    expect(record('capture.end')).toMatchObject({
      requestBodyExact: false,
      responseBodyExact: false,
      timingReplayable: false,
      downstreamBytesWritten: responseBody.byteLength,
    })
    expect(Number(record('response.head')?.atUs)).toBeLessThan(Number(record('request.end')?.atUs))

    const bodyChunks = capture.records.filter(
      (candidate) => candidate.kind === 'request.body_chunk' || candidate.kind === 'response.body_chunk',
    )
    for (const chunk of bodyChunks) {
      expect(Buffer.from(String(chunk.bytesBase64), 'base64').includes(Buffer.from(secret))).toBe(false)
    }
    const captureFiles = (await readdir(join(servers.dataDir, 'captures')))
      .filter((filename) => filename.endsWith('.llmcap.jsonl'))
    expect(captureFiles).toHaveLength(1)
    const captureFile = await readFile(join(servers.dataDir, 'captures', captureFiles[0]), 'utf8')
    expect(captureFile).not.toContain(secret)
    expect(captureFile).not.toContain(querySecret)
  })
})
