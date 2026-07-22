import { randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, link, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  captureRequestStream,
  captureToScenario,
  captureView,
} from './capture-utils.js'
import type { GatewayContext } from './app.js'
import { parseUpstreamBaseUrl, probeNetworkTarget } from './network.js'
import {
  captureExactReplayEligibility,
  normalizeHeaders,
  sanitizeErrorMessage,
  sanitizeHeaders,
  sanitizeUrl,
  type CaptureRecord,
} from './recording.js'
import { GATEWAY_PROTOCOLS, type GatewayProtocol, type ReplaySpeed, type UpstreamConfig } from './runtime.js'
import { compileScenario, validateScenario } from './scenario.js'

export interface AdminAppOptions extends GatewayContext {
  apiBaseUrl: string
  adminBaseUrl: string
  webDirectory: string
  adminToken?: string
}

function isProtocol(value: unknown): value is GatewayProtocol {
  return typeof value === 'string' && GATEWAY_PROTOCOLS.includes(value as GatewayProtocol)
}

function routeParam(value: string | string[]): string {
  if (Array.isArray(value)) throw new Error('Route parameter must be singular')
  return value
}

function adminAuthorization(token: string | undefined): express.RequestHandler {
  if (!token) return (_request, _response, next) => next()
  const expected = Buffer.from(`Bearer ${token}`)
  return (request, response, next) => {
    const actual = Buffer.from(request.header('authorization') ?? '')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.status(401).json({ error: 'Admin authorization required' })
      return
    }
    next()
  }
}

function sanitizeImportedRecord(value: unknown): CaptureRecord {
  if (!value || typeof value !== 'object') throw new Error('Each capture line must be a JSON object')
  const record = structuredClone(value) as Record<string, unknown>
  if (record.rawHeaders) record.rawHeaders = sanitizeHeaders(record.rawHeaders as never)
  if (typeof record.url === 'string') record.url = sanitizeUrl(record.url)
  if (record.kind === 'capture') {
    if (typeof record.downstreamUrl === 'string') record.downstreamUrl = sanitizeUrl(record.downstreamUrl)
    if (typeof record.upstreamUrl === 'string') record.upstreamUrl = sanitizeUrl(record.upstreamUrl)
  }
  if (record.kind === 'failure' && typeof record.message === 'string') {
    record.message = sanitizeErrorMessage(record.message)
  }
  return record as unknown as CaptureRecord
}

function assertImportedRecordIsSanitized(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Each capture line must be a JSON object')
  const record = value as Record<string, unknown>
  if (record.rawHeaders) {
    const original = normalizeHeaders(record.rawHeaders as never)
    const sanitized = sanitizeHeaders(original)
    if (original.some(([, value], index) => sanitized[index]?.[1] !== value)) {
      throw new Error('Imported capture contains an unredacted credential header')
    }
  }
  for (const key of ['url', 'downstreamUrl', 'upstreamUrl']) {
    const rawUrl = record[key]
    if (typeof rawUrl !== 'string') continue
    const normalized = new URL(rawUrl).toString()
    if (sanitizeUrl(rawUrl) !== normalized) {
      throw new Error('Imported capture contains unredacted URL credentials')
    }
  }
}

function parseImportedCapture(body: Buffer): CaptureRecord[] {
  if (body.length === 0) throw new Error('Capture file is empty')
  return body.toString('utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    if (Buffer.byteLength(line) > 16 * 1024 * 1024) throw new Error('A capture record exceeds the 16 MiB import limit')
    const value: unknown = JSON.parse(line)
    assertImportedRecordIsSanitized(value)
    return sanitizeImportedRecord(value)
  })
}

async function importCapture(options: AdminAppOptions, body: Buffer): Promise<Record<string, unknown>> {
  const records = parseImportedCapture(body)
  const header = records[0]
  if (!header || header.kind !== 'capture') throw new Error('Capture header is missing')
  if (!/^cap_[A-Za-z0-9_-]{8,128}$/.test(header.id)) throw new Error('Imported capture id is invalid')
  if (!isProtocol(header.protocol)) throw new Error('Imported capture protocol is invalid')
  if (typeof header.createdAt !== 'string' || Number.isNaN(Date.parse(header.createdAt))) {
    throw new Error('Imported capture createdAt is invalid')
  }
  const existing = await options.captures.list({ includePartial: true })
  if (existing.some((capture) => capture.id === header.id)) throw new Error(`Capture ${header.id} already exists`)

  const filename = `import_${header.id}.llmcap.jsonl`
  const finalPath = path.join(options.capturesDirectory, filename)
  const partialPath = `${finalPath}.partial`
  await writeFile(partialPath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, {
    mode: 0o600,
    flag: 'wx',
  })
  let finalCreated = false
  try {
    const detail = await options.captures.read(`${filename}.partial`)
    if (!detail.captureEnd) throw new Error('Imported capture must contain capture.end')
    if (detail.integrity.response !== 'valid' || detail.integrity.request !== 'valid') {
      throw new Error('Imported capture failed integrity validation')
    }
    await link(partialPath, finalPath)
    finalCreated = true
    await unlink(partialPath)
    return captureView(await options.captures.read(filename))
  } catch (error) {
    await unlink(partialPath).catch(() => undefined)
    if (finalCreated) await unlink(finalPath).catch(() => undefined)
    throw error
  }
}

async function moveCaptureToTrash(options: AdminAppOptions, id: string): Promise<void> {
  const detail = await options.captures.read(id)
  const bindings = options.runtime.snapshot().bindings
  const active = GATEWAY_PROTOCOLS.some((protocol) => (
    [bindings[protocol].stream, bindings[protocol].nonstream]
      .some((source) => source.kind === 'capture' && source.id === detail.header.id)
  ))
  if (active) throw new Error('Capture is an active replay binding; bind another source before deleting it')
  const source = path.join(options.capturesDirectory, detail.filename)
  const stats = await lstat(source)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Capture target must be a regular file')
  const trash = path.join(options.runtime.dataDir, 'trash')
  await mkdir(trash, { recursive: true, mode: 0o700 })
  const trashStats = await lstat(trash)
  if (!trashStats.isDirectory() || trashStats.isSymbolicLink()) throw new Error('Trash directory must be a real directory')
  await chmod(trash, 0o700)
  await rename(source, path.join(trash, `${Date.now()}_${randomUUID()}_${detail.filename}`))
}

function runtimeUpstreams(options: AdminAppOptions): Array<UpstreamConfig & { status: 'unchecked' }> {
  const config = options.runtime.snapshot()
  return GATEWAY_PROTOCOLS.map((protocol) => ({ ...config.upstreams[protocol], status: 'unchecked' }))
}

async function runtimeView(options: AdminAppOptions): Promise<Record<string, unknown>> {
  const config = options.runtime.snapshot()
  const captures = await options.captures.list({ includePartial: true })
  const scenarios = await options.scenarios.list()
  return {
    mode: config.mode,
    revision: config.revision,
    activeRequests: options.metrics.activeRequests,
    apiBaseUrl: options.apiBaseUrl,
    adminBaseUrl: options.adminBaseUrl,
    dataDir: options.runtime.dataDir,
    enabledEndpoints: config.enabledEndpoints,
    captureCount: captures.filter((capture) => !capture.partial).length,
    scenarioCount: scenarios.length,
    errorCount: options.metrics.errorCount + captures.filter((capture) => !capture.valid).length,
    partialCount: captures.filter((capture) => capture.partial).length,
    upstreams: runtimeUpstreams(options),
  }
}

async function bindingView(options: AdminAppOptions): Promise<Record<string, unknown>[]> {
  const config = options.runtime.snapshot()
  const result: Record<string, unknown>[] = []
  for (const protocol of GATEWAY_PROTOCOLS) {
    for (const stream of [true, false]) {
      const source = config.bindings[protocol][stream ? 'stream' : 'nonstream']
      let sourceTitle = source.id
      let compatible = source.kind === 'scenario'
      const diagnostics: string[] = []
      try {
        if (source.kind === 'scenario') {
          const scenario = await options.scenarios.read(source.id)
          sourceTitle = scenario.title
          compatible = scenario.match.protocols.includes(protocol)
          if (!compatible) diagnostics.push(`Scenario does not allow ${protocol}`)
        } else {
          const capture = await options.captures.read(source.id)
          sourceTitle = capture.header.id
          const rawShapeMatches = capture.header.protocol === protocol
            && captureRequestStream(capture) === stream
          if (rawShapeMatches) {
            const eligibility = captureExactReplayEligibility(capture, { targetProtocol: protocol })
            compatible = eligibility.eligible
              && (source.speed === 'instant' || capture.captureEnd?.timingReplayable === true)
            if (eligibility.reason) diagnostics.push(eligibility.reason)
            if (eligibility.eligible && !compatible) {
              diagnostics.push('Capture timing is not replayable; choose instant speed or semantic replay')
            }
          } else {
            compatible = false
            diagnostics.push('Capture will be semantically transcoded for this target')
          }
        }
      } catch (error) {
        compatible = false
        diagnostics.push((error as Error).message)
      }
      result.push({
        protocol,
        stream,
        sourceType: source.kind,
        sourceId: source.id,
        sourceTitle,
        speed: source.speed,
        compatible,
        diagnostics,
      })
    }
  }
  return result
}

function normalizeReplaySpeed(value: unknown): ReplaySpeed {
  if (value === 'instant') return value
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.1 || value > 10) {
    throw new Error('Replay speed must be instant or a number between 0.1 and 10')
  }
  return value
}

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>): express.RequestHandler {
  return (request, response, next) => {
    handler(request, response).catch(next)
  }
}

export function createAdminApp(options: AdminAppOptions): express.Express {
  const app = express()
  app.disable('x-powered-by')

  app.post(
    '/admin/api/captures/import',
    adminAuthorization(options.adminToken),
    express.raw({ type: ['application/x-ndjson', 'application/json', 'application/octet-stream'], limit: '64mb' }),
    asyncRoute(async (request, response) => {
      response.status(201).json(await importCapture(options, Buffer.from(request.body as Uint8Array)))
    }),
  )

  app.use('/admin/api', adminAuthorization(options.adminToken), express.json({ limit: '16mb' }))

  app.get('/admin/api/runtime', asyncRoute(async (_request, response) => {
    response.json(await runtimeView(options))
  }))

  app.patch('/admin/api/runtime', asyncRoute(async (request, response) => {
    const current = options.runtime.snapshot()
    if (request.body.revision !== current.revision) {
      response.status(409).json({ error: 'Runtime changed; refresh and try again' })
      return
    }
    if (request.body.mode !== undefined && !['builtin', 'record', 'replay'].includes(request.body.mode)) {
      throw new Error('Runtime mode must be builtin, record, or replay')
    }
    let enabledEndpoints = current.enabledEndpoints
    if (request.body.enabledEndpoints !== undefined) {
      if (!Array.isArray(request.body.enabledEndpoints) || !request.body.enabledEndpoints.every(isProtocol)) {
        throw new Error('Enabled endpoints must contain only supported protocols')
      }
      enabledEndpoints = [...new Set(request.body.enabledEndpoints as GatewayProtocol[])]
    }
    const upstreams: Partial<Record<GatewayProtocol, Partial<UpstreamConfig>>> = {}
    if (request.body.upstreams !== undefined && !Array.isArray(request.body.upstreams)) {
      throw new Error('Upstreams must be an array')
    }
    if (Array.isArray(request.body.upstreams)) {
      for (const candidate of request.body.upstreams as Array<Partial<UpstreamConfig>>) {
        if (!isProtocol(candidate.protocol)) throw new Error('Unsupported upstream protocol')
        if (typeof candidate.baseUrl !== 'string') throw new Error('Upstream baseUrl must be a string')
        if (candidate.baseUrl) parseUpstreamBaseUrl(candidate.baseUrl)
        if (typeof candidate.allowPrivateNetwork !== 'boolean') {
          throw new Error('allowPrivateNetwork must be a boolean')
        }
        upstreams[candidate.protocol] = {
          baseUrl: candidate.baseUrl,
          allowPrivateNetwork: candidate.allowPrivateNetwork,
        }
      }
    }
    const nextMode = request.body.mode ?? current.mode
    if (nextMode === 'record') {
      for (const protocol of enabledEndpoints) {
        const upstream = { ...current.upstreams[protocol], ...upstreams[protocol] }
        if (!upstream.baseUrl) throw new Error(`Record mode requires an upstream for ${protocol}`)
      }
    }
    await options.runtime.update({
      mode: nextMode,
      enabledEndpoints,
      upstreams,
    }, request.body.revision)
    response.json(await runtimeView(options))
  }))

  app.get('/admin/api/captures', asyncRoute(async (_request, response) => {
    response.json(await options.captures.list({ includePartial: true }))
  }))

  app.get('/admin/api/captures/:id', asyncRoute(async (request, response) => {
    response.json(captureView(await options.captures.read(routeParam(request.params.id))))
  }))

  app.delete('/admin/api/captures/:id', asyncRoute(async (request, response) => {
    await moveCaptureToTrash(options, routeParam(request.params.id))
    response.status(204).end()
  }))

  app.post('/admin/api/captures/:id/to-scenario', asyncRoute(async (request, response) => {
    const capture = await options.captures.read(routeParam(request.params.id))
    const id = typeof request.body.id === 'string' ? request.body.id : `scenario-${capture.header.id}`
    const title = typeof request.body.title === 'string' ? request.body.title : `Scenario from ${capture.header.id}`
    response.status(201).json(await options.scenarios.save(captureToScenario(capture, id, title)))
  }))

  app.get('/admin/api/scenarios', asyncRoute(async (_request, response) => {
    response.json(await options.scenarios.list())
  }))

  app.get('/admin/api/scenarios/:id', asyncRoute(async (request, response) => {
    response.json(await options.scenarios.read(routeParam(request.params.id)))
  }))

  app.put('/admin/api/scenarios/:id', asyncRoute(async (request, response) => {
    if (routeParam(request.params.id) !== request.body.id) throw new Error('Scenario path id must match body id')
    validateScenario(request.body)
    response.json(await options.scenarios.save(request.body))
  }))

  app.delete('/admin/api/scenarios/:id', asyncRoute(async (request, response) => {
    await options.scenarios.delete(routeParam(request.params.id))
    response.status(204).end()
  }))

  app.post('/admin/api/scenarios/preview/:protocol', asyncRoute(async (request, response) => {
    if (!isProtocol(request.params.protocol)) throw new Error('Unsupported preview protocol')
    validateScenario(request.body)
    const stream = request.body.match?.stream === true
    const compiled = compileScenario(request.params.protocol, request.body, {
      stream,
      includeUsage: true,
      model: 'mock-model',
      invocationId: 'preview',
      createdAt: 0,
    })
    response.json(compiled.stream
      ? { protocol: compiled.protocol, status: compiled.status, headers: compiled.headers, frames: compiled.frames.map((frame) => ({ atUs: frame.atMs * 1000, raw: frame.data })) }
      : { protocol: compiled.protocol, status: compiled.status, headers: compiled.headers, body: JSON.parse(compiled.body) })
  }))

  app.get('/admin/api/bindings', asyncRoute(async (_request, response) => {
    response.json(await bindingView(options))
  }))

  app.put('/admin/api/bindings', asyncRoute(async (request, response) => {
    if (!isProtocol(request.body.protocol) || typeof request.body.stream !== 'boolean') {
      throw new Error('Binding requires protocol and stream')
    }
    if (request.body.sourceType !== 'capture' && request.body.sourceType !== 'scenario') {
      throw new Error('Binding sourceType must be capture or scenario')
    }
    if (typeof request.body.sourceId !== 'string' || !request.body.sourceId) throw new Error('Binding sourceId is required')
    if (request.body.sourceType === 'capture') {
      const capture = await options.captures.read(request.body.sourceId)
      const exact = capture.header.protocol === request.body.protocol
        && captureRequestStream(capture) === request.body.stream
      if (exact) {
        const eligibility = captureExactReplayEligibility(capture, {
          targetProtocol: request.body.protocol,
        })
        if (!eligibility.eligible) throw new Error(eligibility.reason)
        if (request.body.speed !== 'instant' && capture.captureEnd?.timingReplayable !== true) {
          throw new Error('Capture timing is not replayable; choose instant speed or semantic replay')
        }
      } else {
        compileScenario(request.body.protocol, captureToScenario(capture), {
          stream: request.body.stream,
          includeUsage: true,
          model: 'mock-model',
          invocationId: 'binding-check',
          createdAt: 0,
        })
      }
    } else {
      const scenario = await options.scenarios.read(request.body.sourceId)
      if (!scenario.match.protocols.includes(request.body.protocol)) {
        throw new Error(`Scenario does not allow ${request.body.protocol}`)
      }
      compileScenario(request.body.protocol, scenario, {
        stream: request.body.stream,
        includeUsage: true,
        model: 'mock-model',
        invocationId: 'binding-check',
        createdAt: 0,
      })
    }
    await options.runtime.updateBinding(request.body.protocol, request.body.stream, {
      kind: request.body.sourceType,
      id: request.body.sourceId,
      speed: normalizeReplaySpeed(request.body.speed),
    })
    response.json(await bindingView(options))
  }))

  app.post('/admin/api/upstreams/check', asyncRoute(async (request, response) => {
    if (!isProtocol(request.body.protocol) || typeof request.body.baseUrl !== 'string') {
      throw new Error('Upstream protocol and baseUrl are required')
    }
    parseUpstreamBaseUrl(request.body.baseUrl)
    if (request.body.allowPrivateNetwork !== undefined && typeof request.body.allowPrivateNetwork !== 'boolean') {
      throw new Error('allowPrivateNetwork must be a boolean')
    }
    const startedAt = performance.now()
    const remote = await probeNetworkTarget(request.body.baseUrl, request.body.allowPrivateNetwork === true)
    response.json({
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
      message: `Base URL reachable (HTTP ${remote.status}); authentication is checked on the first proxied request`,
    })
  }))

  app.use('/admin/api', (_request, response) => {
    response.status(404).json({ error: 'Admin API route not found' })
  })

  app.use(express.static(options.webDirectory, { index: 'index.html' }))
  app.use(async (request, response, next) => {
    if (request.method !== 'GET' || !request.accepts('html')) return next()
    try {
      response.type('html').send(await readFile(path.join(options.webDirectory, 'index.html'), 'utf8'))
    } catch (error) {
      next(error)
    }
  })

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = sanitizeErrorMessage(error instanceof Error ? error.message : 'Admin request failed')
    const expressStatus = typeof error === 'object' && error && 'status' in error
      && typeof error.status === 'number' ? error.status : undefined
    const status = expressStatus === 413 ? 413
      : /not found/i.test(message) ? 404
      : /read-only|already exists|changed|active replay binding/i.test(message) ? 409
        : /does not allow|not complete|semantically|content-encoding|not replayable/i.test(message) ? 422
        : error instanceof SyntaxError || /invalid|must|required|unsupported|unredacted credential/i.test(message) ? 400
          : 500
    response.status(status).json({ error: message })
  })
  return app
}
