import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeState } from '../src/runtime.js'
import { isLoopbackHost, startServer, type RunningServers } from '../src/server.js'

const temporaryDirectories: string[] = []
const runningServers: RunningServers[] = []

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mock-openai-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}

async function webDirectory(root: string): Promise<string> {
  const directory = join(root, 'web')
  await mkdir(directory)
  await writeFile(join(directory, 'index.html'), '<!doctype html><title>Admin</title>')
  return directory
}

afterEach(async () => {
  await Promise.allSettled(runningServers.splice(0).map((servers) => servers.close()))
  await Promise.allSettled(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('RuntimeState mutations', () => {
  it('serializes updates and bindings without losing either mutation', async () => {
    const directory = await temporaryDirectory()
    const runtime = new RuntimeState(directory)
    await runtime.load()

    const results = await Promise.all([
      runtime.update({ mode: 'replay' }),
      runtime.updateBinding('openai-chat', true, {
        kind: 'scenario',
        id: 'builtin-text',
        speed: 'instant',
      }),
    ])
    expect(results.map((result) => result.revision)).toEqual([2, 3])
    expect(runtime.snapshot()).toMatchObject({
      revision: 3,
      mode: 'replay',
      bindings: {
        'openai-chat': {
          stream: { kind: 'scenario', id: 'builtin-text', speed: 'instant' },
        },
      },
    })

    const persisted = JSON.parse(await readFile(runtime.runtimeFile, 'utf8'))
    expect(persisted).toEqual(runtime.snapshot())
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('checks expectedRevision inside the mutation queue', async () => {
    const directory = await temporaryDirectory()
    const runtime = new RuntimeState(directory)
    await runtime.load()
    const revision = runtime.snapshot().revision

    const results = await Promise.allSettled([
      runtime.update({ mode: 'record' }, revision),
      runtime.update({ enabledEndpoints: ['openai-chat'] }, revision),
    ])
    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect(results[1]).toMatchObject({
      reason: expect.objectContaining({ message: 'Runtime changed; refresh and try again' }),
    })
    expect(runtime.snapshot()).toMatchObject({ revision: revision + 1, mode: 'record' })
    expect(runtime.snapshot().enabledEndpoints).toHaveLength(3)

    await expect(runtime.updateBinding(
      'openai-chat',
      false,
      { kind: 'scenario', id: 'builtin-text', speed: 1 },
      revision,
    )).rejects.toThrow('Runtime changed')
  })

  it('does not publish an in-memory update when persistence fails', async () => {
    const directory = await temporaryDirectory()
    const runtime = new RuntimeState(directory)
    await runtime.load()
    const before = runtime.snapshot()
    await unlink(runtime.runtimeFile)
    await mkdir(runtime.runtimeFile)

    await expect(runtime.update({ mode: 'record' })).rejects.toThrow()
    expect(runtime.snapshot()).toEqual(before)
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('removes credential-bearing upstream URLs while loading persisted state', async () => {
    const directory = await temporaryDirectory()
    const runtime = new RuntimeState(directory)
    await runtime.load()
    const persisted = runtime.snapshot()
    persisted.upstreams['openai-chat'].baseUrl = 'https://api-key:secret@example.com/v1'
    await writeFile(runtime.runtimeFile, `${JSON.stringify(persisted)}\n`)

    const reloaded = new RuntimeState(directory)
    await reloaded.load()
    expect(reloaded.snapshot().upstreams['openai-chat'].baseUrl).toBe('')
    expect(await readFile(reloaded.runtimeFile, 'utf8')).not.toContain('secret')
  })
})

describe('server security and shutdown', () => {
  it('rejects an unauthenticated non-loopback admin listener', async () => {
    expect(isLoopbackHost('127.0.0.42')).toBe(true)
    expect(isLoopbackHost('::1')).toBe(true)
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('0.0.0.0')).toBe(false)
    expect(isLoopbackHost('::')).toBe(false)

    const rejectedData = await temporaryDirectory()
    await expect(startServer({
      apiHost: '127.0.0.1',
      apiPort: 0,
      adminHost: '0.0.0.0',
      adminPort: 0,
      dataDir: rejectedData,
      webDirectory: await webDirectory(rejectedData),
    })).rejects.toThrow('requires adminToken')

    const allowedData = await temporaryDirectory()
    const servers = await startServer({
      apiHost: '127.0.0.1',
      apiPort: 0,
      adminHost: '0.0.0.0',
      adminPort: 0,
      adminToken: 'admin-secret',
      dataDir: allowedData,
      webDirectory: await webDirectory(allowedData),
    })
    runningServers.push(servers)
    const response = await fetch(`${servers.adminUrl}/admin/api/runtime`, {
      headers: { authorization: 'Bearer admin-secret' },
    })
    expect(response.status).toBe(200)
  })

  it('lets an active streaming request finish before closing', async () => {
    const directory = await temporaryDirectory()
    const servers = await startServer({
      apiHost: '127.0.0.1',
      apiPort: 0,
      adminHost: '127.0.0.1',
      adminPort: 0,
      dataDir: directory,
      webDirectory: await webDirectory(directory),
      shutdownTimeoutMs: 1_000,
    })
    runningServers.push(servers)

    const response = await fetch(`${servers.apiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [], stream: true }),
    })
    expect(response.status).toBe(200)
    const body = response.text()
    const startedAt = performance.now()
    await servers.close()
    const elapsedMs = performance.now() - startedAt

    expect(await body).toContain('data: [DONE]')
    expect(elapsedMs).toBeGreaterThanOrEqual(15)
    expect(elapsedMs).toBeLessThan(1_000)
  })

  it('forces an active connection only after the shutdown timeout', async () => {
    const directory = await temporaryDirectory()
    const servers = await startServer({
      apiHost: '127.0.0.1',
      apiPort: 0,
      adminHost: '127.0.0.1',
      adminPort: 0,
      dataDir: directory,
      webDirectory: await webDirectory(directory),
      shutdownTimeoutMs: 50,
    })
    runningServers.push(servers)
    const target = new URL('/v1/chat/completions', servers.apiUrl)
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })
    const closed = Promise.race([
      once(request, 'error'),
      once(request, 'close'),
    ])
    request.write('{"stream":true')
    request.flushHeaders()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const runtime = await fetch(`${servers.adminUrl}/admin/api/runtime`).then((response) => response.json()) as {
        activeRequests: number
      }
      if (runtime.activeRequests === 1) break
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (attempt === 19) throw new Error('Request did not become active')
    }

    const startedAt = performance.now()
    await servers.close()
    const elapsedMs = performance.now() - startedAt
    await closed
    expect(elapsedMs).toBeGreaterThanOrEqual(40)
    expect(elapsedMs).toBeLessThan(1_000)
  })
})
