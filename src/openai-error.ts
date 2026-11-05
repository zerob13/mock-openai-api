import type { Response } from 'express'

export function sendOpenAiError(
  response: Response,
  status: number,
  message: string,
  param: string | null = null,
): void {
  response.status(status).json({
    error: { message, type: 'invalid_request_error', param, code: null },
  })
}
