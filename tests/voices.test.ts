import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startServer, type RunningServers } from '../src/server.js'

const directories: string[] = []
const servers: RunningServers[] = []

async function start(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mock-openai-voices-'))
  directories.push(dataDir)
  const running = await startServer({
    apiHost: '127.0.0.1',
    apiPort: 0,
    adminHost: '127.0.0.1',
    adminPort: 0,
    adminToken: 'voices-admin-token',
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

const promptVoice = {
  type: 'prompt',
  name: 'Warm narrator',
  prompt: 'A warm, calm narrator with a clear, measured delivery.',
}

function createJson(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/v1/audio/voices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createMultipart(
  baseUrl: string,
  fields: Record<string, string>,
  sample?: { bytes: Uint8Array; mimeType: string },
): Promise<Response> {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  if (sample) {
    form.append('audio_sample', new Blob([sample.bytes], { type: sample.mimeType }), 'sample')
  }
  return fetch(`${baseUrl}/v1/audio/voices`, { method: 'POST', body: form })
}

function deleteVoice(baseUrl: string, id: string): Promise<Response> {
  return fetch(`${baseUrl}/v1/audio/voices/${id}`, { method: 'DELETE' })
}

describe('POST /v1/audio/voices', () => {
  const audioSample = { bytes: new Uint8Array([0xff, 0xfb, 0x90, 0xc4]), mimeType: 'audio/mpeg' }
  const consentedVoice = { name: 'Narrator', consent: 'cons_1234' }

  it('should create a voice from a JSON prompt', async () => {
    const baseUrl = await start()

    const response = await createJson(baseUrl, promptVoice)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      object: 'audio.voice',
      id: expect.stringMatching(/^voice_[a-z0-9]{24}$/),
      type: 'prompt',
      name: 'Warm narrator',
      prompt: promptVoice.prompt,
      created_at: expect.any(Number),
    })
  })

  it('should create a voice from a multipart prompt', async () => {
    const baseUrl = await start()

    const response = await createMultipart(baseUrl, {
      ...promptVoice,
      script_hint: 'Once upon a time.',
      model: 'auto',
    })

    expect(response.status).toBe(200)
    expect((await response.json()).type).toBe('prompt')
  })

  it('should create a voice from an audio sample and omit the prompt', async () => {
    const baseUrl = await start()

    const response = await createMultipart(baseUrl, consentedVoice, audioSample)

    const voice = await response.json()
    expect(response.status).toBe(200)
    expect(voice).toEqual({
      object: 'audio.voice',
      id: expect.stringMatching(/^voice_/),
      type: 'audio_sample',
      name: 'Narrator',
      created_at: expect.any(Number),
    })
  })

  it('should give every voice a distinct id', async () => {
    const baseUrl = await start()

    const first = await (await createJson(baseUrl, promptVoice)).json()
    const second = await (await createJson(baseUrl, promptVoice)).json()

    expect(first.id).not.toBe(second.id)
  })

  it.each([
    ['a missing name', { ...promptVoice, name: undefined }, 'name'],
    ['a blank name', { ...promptVoice, name: ' ' }, 'name'],
    ['a name over 256 characters', { ...promptVoice, name: 'a'.repeat(257) }, 'name'],
    ['a missing prompt', { ...promptVoice, prompt: undefined }, 'prompt'],
    ['a whitespace-only prompt', { ...promptVoice, prompt: '   ' }, 'prompt'],
    ['a prompt over 2000 characters', { ...promptVoice, prompt: 'a'.repeat(2001) }, 'prompt'],
    ['a blank script_hint', { ...promptVoice, script_hint: ' ' }, 'script_hint'],
    ['an unknown type', { ...promptVoice, type: 'clone' }, 'type'],
    ['an unrecognized field', { ...promptVoice, language: 'en' }, 'language'],
  ])('should reject %s', async (_label, body, param) => {
    const baseUrl = await start()

    const response = await createJson(baseUrl, body)

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe(param)
  })

  it('should reject an audio_sample voice sent as JSON', async () => {
    const baseUrl = await start()

    const response = await createJson(baseUrl, { name: 'Narrator', consent: 'cons_1234' })

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe('audio_sample')
  })

  it('should default the type to audio_sample', async () => {
    const baseUrl = await start()

    const response = await createMultipart(baseUrl, consentedVoice, audioSample)

    expect((await response.json()).type).toBe('audio_sample')
  })

  it.each([
    ['audio_sample', { name: 'Narrator', consent: 'cons_1234' }, undefined],
    ['consent', { name: 'Narrator' }, audioSample],
    ['name', { consent: 'cons_1234' }, audioSample],
  ])('should reject an audio sample voice missing %s', async (param, fields, sample) => {
    const baseUrl = await start()

    const response = await createMultipart(baseUrl, fields, sample)

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe(param)
  })

  it('should reject an unsupported audio sample MIME type', async () => {
    const baseUrl = await start()

    const response = await createMultipart(baseUrl, consentedVoice, {
      ...audioSample,
      mimeType: 'text/plain',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error.param).toBe('audio_sample')
  })

  it('should accept an audio sample of exactly 10 MiB', async () => {
    const baseUrl = await start()
    const atLimit = { ...audioSample, bytes: new Uint8Array(10 * 1024 * 1024) }

    const response = await createMultipart(baseUrl, consentedVoice, atLimit)

    expect(response.status).toBe(200)
  })

  it('should reject an audio sample over 10 MiB', async () => {
    const baseUrl = await start()
    const oversized = { ...audioSample, bytes: new Uint8Array(10 * 1024 * 1024 + 1) }

    const response = await createMultipart(baseUrl, consentedVoice, oversized)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('10 MiB')
  })
})

describe('DELETE /v1/audio/voices/{voice_id}', () => {
  it('should delete a created voice', async () => {
    const baseUrl = await start()
    const { id } = await (await createJson(baseUrl, promptVoice)).json()

    const response = await deleteVoice(baseUrl, id)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id, object: 'audio.voice.deleted', deleted: true })
  })

  it('should return 404 when deleting the same voice twice', async () => {
    const baseUrl = await start()
    const { id } = await (await createJson(baseUrl, promptVoice)).json()
    await deleteVoice(baseUrl, id)

    const response = await deleteVoice(baseUrl, id)

    expect(response.status).toBe(404)
  })

  it('should return 404 for a voice that never existed', async () => {
    const baseUrl = await start()

    const response = await deleteVoice(baseUrl, 'voice_1234')

    expect(response.status).toBe(404)
    expect((await response.json()).error.param).toBe('voice_id')
  })

  it('should return 400 for a malformed voice id', async () => {
    const baseUrl = await start()

    const response = await deleteVoice(baseUrl, 'not-a-voice')

    expect(response.status).toBe(400)
  })

  it('should not share voices between servers', async () => {
    const first = await start()
    const second = await start()
    const { id } = await (await createJson(first, promptVoice)).json()

    const response = await deleteVoice(second, id)

    expect(response.status).toBe(404)
  })
})
