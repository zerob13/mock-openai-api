import { randomUUID } from 'node:crypto'
import type { Request, RequestHandler, Response } from 'express'
import { parseMultipart } from './multipart.js'
import { sendOpenAiError } from './openai-error.js'

const MAX_AUDIO_SAMPLE_BYTES = 10 * 1024 * 1024
const AUDIO_SAMPLE_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/aac',
  'audio/flac',
  'audio/webm',
  'audio/mp4',
])
const VOICE_ID_PATTERN = /^voice_[A-Za-z0-9]+$/
const AUDIO_SAMPLE_FIELDS = ['type', 'name', 'audio_sample', 'consent']
const PROMPT_FIELDS = ['type', 'name', 'prompt', 'script_hint', 'model']

interface Voice {
  object: 'audio.voice'
  id: string
  type: 'audio_sample' | 'prompt'
  name: string
  created_at: number
  prompt?: string
}

interface VoiceRequest {
  fields: Record<string, unknown>
  files: Record<string, { mimeType: string; size: number; truncated: boolean }>
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

async function readRequest(request: Request): Promise<VoiceRequest> {
  if (request.is('multipart/form-data')) {
    // busboy flags a file as truncated once it reaches the limit, so allow one byte more to accept exactly 10 MiB.
    return parseMultipart(request, MAX_AUDIO_SAMPLE_BYTES + 1)
  }
  return { fields: request.body ?? {}, files: {} }
}

function validateLength(
  fields: Record<string, unknown>,
  name: string,
  max: number,
): string | undefined {
  const value = fields[name]
  if (isBlank(value)) return `'${name}' is required and must not be blank`
  if ((value as string).length > max) return `'${name}' must be at most ${max} characters`
}

function validateCommon(
  { fields, files }: VoiceRequest,
  allowed: string[],
): [string, string] | undefined {
  const unknown = [...Object.keys(fields), ...Object.keys(files)].find(
    (key) => !allowed.includes(key),
  )
  if (unknown) return [`Unrecognized request argument supplied: ${unknown}`, unknown]
  const nameError = validateLength(fields, 'name', 256)
  if (nameError) return [nameError, 'name']
}

function validateAudioSample(voiceRequest: VoiceRequest): [string, string] | undefined {
  const common = validateCommon(voiceRequest, AUDIO_SAMPLE_FIELDS)
  if (common) return common
  const sample = voiceRequest.files.audio_sample
  if (!sample) return ["'audio_sample' is required and must be uploaded as multipart/form-data", 'audio_sample']
  if (sample.truncated) return ["'audio_sample' must be at most 10 MiB", 'audio_sample']
  if (!AUDIO_SAMPLE_MIME_TYPES.has(sample.mimeType)) {
    return [`Unsupported 'audio_sample' MIME type: ${sample.mimeType}`, 'audio_sample']
  }
  if (isBlank(voiceRequest.fields.consent)) return ["'consent' is required", 'consent']
}

function validatePrompt(voiceRequest: VoiceRequest): [string, string] | undefined {
  const common = validateCommon(voiceRequest, PROMPT_FIELDS)
  if (common) return common
  const promptError = validateLength(voiceRequest.fields, 'prompt', 2000)
  if (promptError) return [promptError, 'prompt']
  if (voiceRequest.fields.script_hint !== undefined) {
    const hintError = validateLength(voiceRequest.fields, 'script_hint', 2000)
    if (hintError) return [hintError, 'script_hint']
  }
}

/**
 * @description function which returns the controllers for the voice creation and deletion.
 *
 * The reason we need it is to be able to store the voices and remove them
 */
export function createVoiceHandlers(): { create: RequestHandler; remove: RequestHandler } {
  const voices = new Map<string, Voice>()

  const create: RequestHandler = async (request: Request, response: Response) => {
    const voiceRequest = await readRequest(request).catch(() => undefined)
    if (!voiceRequest) {
      // The unread rest of the body may still be on the wire, so close the connection once the error is sent.
      response.set('Connection', 'close')
      return sendOpenAiError(response, 400, 'Malformed multipart/form-data body')
    }
    const type = voiceRequest.fields.type ?? 'audio_sample'
    if (type !== 'audio_sample' && type !== 'prompt') {
      return sendOpenAiError(response, 400, "'type' must be 'audio_sample' or 'prompt'", 'type')
    }
    if (type === 'audio_sample' && !request.is('multipart/form-data')) {
      return sendOpenAiError(
        response,
        400,
        "Voices of type 'audio_sample' require multipart/form-data",
        'audio_sample',
      )
    }

    const failure = type === 'prompt' ? validatePrompt(voiceRequest) : validateAudioSample(voiceRequest)
    if (failure) return sendOpenAiError(response, 400, failure[0], failure[1])

    const voice: Voice = {
      object: 'audio.voice',
      id: `voice_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      type,
      name: voiceRequest.fields.name as string,
      created_at: Math.floor(Date.now() / 1000),
    }
    if (type === 'prompt') voice.prompt = voiceRequest.fields.prompt as string
    voices.set(voice.id, voice)
    response.json(voice)
  }

  const remove: RequestHandler = (request: Request, response: Response) => {
    const id = String(request.params.voice_id)
    if (!VOICE_ID_PATTERN.test(id)) {
      return sendOpenAiError(response, 400, `Invalid voice ID: ${id}`, 'voice_id')
    }
    if (!voices.delete(id)) {
      return sendOpenAiError(response, 404, `Voice not found: ${id}`, 'voice_id')
    }
    response.json({ id, object: 'audio.voice.deleted', deleted: true })
  }

  return { create, remove }
}
