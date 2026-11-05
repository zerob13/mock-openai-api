import type { Request, Response } from 'express'
import {
  silentAac,
  silentFlac,
  silentMp3,
  silentOpus,
  silentPcm,
  silentWav,
} from './speech-audio.js'
import { sendOpenAiError } from './openai-error.js'

interface AudioFormat {
  contentType: string
  body: Buffer
}

const FORMATS: Record<string, AudioFormat> = {
  mp3: { contentType: 'audio/mpeg', body: silentMp3() },
  opus: { contentType: 'audio/opus', body: silentOpus() },
  aac: { contentType: 'audio/aac', body: silentAac() },
  flac: { contentType: 'audio/flac', body: silentFlac() },
  wav: { contentType: 'audio/wav', body: silentWav() },
  pcm: { contentType: 'audio/pcm', body: silentPcm() },
}

export function handleSpeech(request: Request, response: Response): void {
  const { model, input, voice, response_format: format = 'mp3' } = request.body ?? {}
  if (typeof model !== 'string' || model === '') {
    return sendOpenAiError(response, 400, "'model' is required", 'model')
  }
  if (typeof input !== 'string' || input === '') {
    return sendOpenAiError(response, 400, "'input' is required", 'input')
  }
  if (typeof voice !== 'string' || voice === '') {
    return sendOpenAiError(response, 400, "'voice' is required", 'voice')
  }
  if (typeof format !== 'string' || !Object.hasOwn(FORMATS, format)) {
    return sendOpenAiError(
      response,
      400,
      `Unsupported 'response_format': ${String(format)}. Supported: ${Object.keys(FORMATS).join(', ')}`,
      'response_format',
    )
  }

  const { contentType, body } = FORMATS[format]
  response.status(200)
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', body.length)
  response.end(body)
}
