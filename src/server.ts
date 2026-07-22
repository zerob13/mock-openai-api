import { access, chmod, lstat, mkdir } from 'node:fs/promises'
import type { Server } from 'node:http'
import { BlockList, isIP, type AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAdminApp } from './admin.js'
import { createApiApp, type RuntimeMetrics } from './app.js'
import { CaptureStore } from './recording.js'
import { RuntimeState } from './runtime.js'
import { ScenarioStore } from './scenario-store.js'

export interface StartServerOptions {
  apiHost?: string
  apiPort?: number
  adminHost?: string
  adminPort?: number
  dataDir?: string
  adminToken?: string
  webDirectory?: string
  shutdownTimeoutMs?: number
}

export interface RunningServers {
  api: Server
  admin: Server
  apiUrl: string
  adminUrl: string
  dataDir: string
  close(): Promise<void>
}

async function listen(app: ReturnType<typeof createApiApp>, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => resolve(server))
    server.once('error', reject)
  })
}

async function defaultWebDirectory(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.resolve(moduleDirectory, '../admin'), path.resolve(process.cwd(), 'dist/admin')]
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'index.html'))
      return candidate
    } catch {
      // Try the next build location.
    }
  }
  return candidates[0]
}

const LOOPBACKS = new BlockList()
LOOPBACKS.addSubnet('127.0.0.0', 8, 'ipv4')
LOOPBACKS.addAddress('::1', 'ipv6')
LOOPBACKS.addSubnet('::ffff:127.0.0.0', 104, 'ipv6')

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true
  const family = isIP(normalized)
  if (family === 4) return LOOPBACKS.check(normalized, 'ipv4')
  if (family === 6) return LOOPBACKS.check(normalized, 'ipv6')
  return false
}

interface ClosingServer {
  server: Server
  done: boolean
  error?: Error
  completion: Promise<void>
}

function beginClose(server: Server): ClosingServer {
  const closing = {} as ClosingServer
  closing.server = server
  closing.done = false
  closing.completion = new Promise((resolve) => {
    server.close((error) => {
      closing.done = true
      closing.error = error
      resolve()
    })
    server.closeIdleConnections()
  })
  return closing
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function closeServers(
  servers: Server[],
  metrics: RuntimeMetrics,
  timeoutMs: number,
): Promise<void> {
  const closing = servers.map(beginClose)
  const deadline = performance.now() + timeoutMs
  while ((!closing.every((state) => state.done) || metrics.activeRequests > 0) && performance.now() < deadline) {
    if (metrics.activeRequests === 0) {
      for (const state of closing) {
        if (!state.done) state.server.closeIdleConnections()
      }
    }
    await sleep(Math.min(10, Math.max(1, deadline - performance.now())))
  }

  if (!closing.every((state) => state.done) || metrics.activeRequests > 0) {
    for (const state of closing) state.server.closeAllConnections()
  }
  await Promise.all(closing.map((state) => state.completion))
  const errors = closing.flatMap((state) => state.error ? [state.error] : [])
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Failed to close servers')
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServers> {
  const apiHost = options.apiHost ?? '0.0.0.0'
  const apiPort = options.apiPort ?? 3000
  const adminHost = options.adminHost ?? '127.0.0.1'
  const adminPort = options.adminPort ?? 3001
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 10_000
  if (!Number.isFinite(shutdownTimeoutMs) || shutdownTimeoutMs < 0) {
    throw new Error('shutdownTimeoutMs must be a non-negative finite number')
  }
  if (!options.adminToken && !isLoopbackHost(adminHost)) {
    throw new Error('Admin listener requires adminToken when adminHost is not loopback')
  }
  const dataDir = path.resolve(options.dataDir ?? '.mock-openai-api')
  const capturesDirectory = path.join(dataDir, 'captures')
  const scenariosDirectory = path.join(dataDir, 'scenarios')
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  const dataStats = await lstat(dataDir)
  if (!dataStats.isDirectory() || dataStats.isSymbolicLink()) {
    throw new Error('Data directory must be a real directory')
  }
  await chmod(dataDir, 0o700)

  const runtime = new RuntimeState(dataDir)
  const captures = new CaptureStore(capturesDirectory)
  const scenarios = new ScenarioStore(scenariosDirectory)
  await Promise.all([runtime.load(), captures.init(), scenarios.initialize()])

  const metrics: RuntimeMetrics = { activeRequests: 0, errorCount: 0 }
  const context = { runtime, captures, scenarios, capturesDirectory, metrics }
  const webDirectory = options.webDirectory ?? await defaultWebDirectory()

  const api = await listen(createApiApp(context), apiPort, apiHost)
  const actualApiPort = (api.address() as AddressInfo).port
  const apiUrl = `http://${apiHost === '0.0.0.0' ? '127.0.0.1' : apiHost}:${actualApiPort}`
  const adminOptions = {
    ...context,
    apiBaseUrl: apiUrl,
    adminBaseUrl: `http://${adminHost === '0.0.0.0' ? '127.0.0.1' : adminHost}:${adminPort}`,
    webDirectory,
    adminToken: options.adminToken,
  }
  let admin: Server
  try {
    admin = await listen(createAdminApp(adminOptions), adminPort, adminHost)
  } catch (error) {
    await closeServers([api], metrics, shutdownTimeoutMs)
    throw error
  }
  const actualAdminPort = (admin.address() as AddressInfo).port
  const adminUrl = `http://${adminHost === '0.0.0.0' ? '127.0.0.1' : adminHost}:${actualAdminPort}`
  adminOptions.adminBaseUrl = adminUrl

  let closeTask: Promise<void> | undefined
  return {
    api,
    admin,
    apiUrl,
    adminUrl,
    dataDir,
    async close() {
      closeTask ??= closeServers([api, admin], metrics, shutdownTimeoutMs)
      await closeTask
    },
  }
}
