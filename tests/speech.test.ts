import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServers } from '../src/server.js'

const directories: string[] = []
const servers: RunningServers[] = []

async function start(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mock-openai-speech-'))
  directories.push(dataDir)
  const running = await startServer({
    apiHost: '127.0.0.1',
    apiPort: 0,
    adminHost: '127.0.0.1',
    adminPort: 0,
    adminToken: 'speech-admin-token',
    dataDir,
    webDirectory: dataDir,
  })
  servers.push(running)
  return running.apiUrl
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((running) => running.close()))
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

function speech(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /v1/audio/speech', () => {
  const valid = {
    model: 'gpt-4o-mini-tts',
    input: 'Once upon a time in a quiet village.',
    voice: 'alloy',
  }

  it.each([
    ['mp3', 'audio/mpeg', 'ff fb'],
    ['opus', 'audio/opus', '4f 67 67 53'],
    ['aac', 'audio/aac', 'ff f1'],
    ['flac', 'audio/flac', '66 4c 61 43'],
    ['wav', 'audio/wav', '52 49 46 46'],
  ])(
    'should return %s audio with content type %s starting with bytes %s',
    async (format, contentType, magic) => {
      const baseUrl = await start()

      const response = await speech(baseUrl, { ...valid, response_format: format })

      const bytes = Buffer.from(await response.arrayBuffer())
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(contentType)
      expect(bytes.subarray(0, magic.split(' ').length).toString('hex')).toBe(
        magic.replaceAll(' ', ''),
      )
    },
  )

  it('should return headerless 24 kHz 16-bit mono pcm', async () => {
    const baseUrl = await start()

    const response = await speech(baseUrl, { ...valid, response_format: 'pcm' })

    expect(response.headers.get('content-type')).toBe('audio/pcm')
    expect((await response.arrayBuffer()).byteLength).toBe(24000 * 2)
  })

  it('should default to mp3', async () => {
    const baseUrl = await start()

    const response = await speech(baseUrl, valid)

    expect(response.headers.get('content-type')).toBe('audio/mpeg')
  })

  it('should return a wav with a RIFF header', async () => {
    const baseUrl = await start()

    const response = await speech(baseUrl, { ...valid, response_format: 'wav' })

    const bytes = Buffer.from(await response.arrayBuffer())
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WAVE')
  })

  it.each(['model', 'input', 'voice'])('should reject a missing %s', async (field) => {
    const baseUrl = await start()
    const body: Record<string, unknown> = { ...valid }
    delete body[field]

    const response = await speech(baseUrl, body)

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe(field)
  })

  it('should reject an unsupported response_format', async () => {
    const baseUrl = await start()

    const response = await speech(baseUrl, { ...valid, response_format: 'ogg' })

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe('response_format')
  })
})
