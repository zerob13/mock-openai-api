import type { Request } from 'express'
import busboy from 'busboy'

export interface UploadedFile {
  mimeType: string
  size: number
  truncated: boolean
}

export interface MultipartForm {
  fields: Record<string, string>
  files: Record<string, UploadedFile>
}

const MAX_FILES = 1
const MAX_FIELDS = 10
const MAX_PARTS = MAX_FILES + MAX_FIELDS
const MAX_FIELD_BYTES = 16 * 1024
const BODY_OVERHEAD_BYTES = 1024 * 1024

export function parseMultipart(request: Request, maxFileBytes: number): Promise<MultipartForm> {
  return new Promise((resolve, reject) => {
    const form: MultipartForm = { fields: {}, files: {} }
    const parser = busboy({
      headers: request.headers,
      limits: {
        fileSize: maxFileBytes,
        files: MAX_FILES,
        fields: MAX_FIELDS,
        parts: MAX_PARTS,
        fieldSize: MAX_FIELD_BYTES,
      },
    })
    const maxBodyBytes = maxFileBytes + BODY_OVERHEAD_BYTES
    let receivedBytes = 0
    let rejected = false

    // Stops reading without destroying the request, so the socket stays usable for the error response.
    const rejectBody = (reason: string): void => {
      if (rejected) return
      rejected = true
      request.off('data', countBytes)
      request.unpipe(parser)
      parser.destroy()
      request.pause()
      reject(new Error(reason))
    }
    const countBytes = (chunk: Buffer): void => {
      receivedBytes += chunk.length
      if (receivedBytes > maxBodyBytes) rejectBody('Multipart body is too large')
    }

    parser.on('filesLimit', () => rejectBody('Too many files'))
    parser.on('fieldsLimit', () => rejectBody('Too many fields'))
    parser.on('partsLimit', () => rejectBody('Too many parts'))
    parser.on('field', (name, value, info) => {
      if (info.nameTruncated || info.valueTruncated) return rejectBody('Field is too large')
      form.fields[name] = value
    })
    parser.on('file', (name, stream, info) => {
      const file: UploadedFile = { mimeType: info.mimeType, size: 0, truncated: false }
      form.files[name] = file
      stream.on('data', (chunk: Buffer) => {
        file.size += chunk.length
      })
      stream.on('limit', () => {
        file.truncated = true
      })
      // Destroying the parser mid-upload destroys this stream with an error that nothing else would handle.
      stream.on('error', () => undefined)
    })
    parser.on('error', reject)
    parser.on('close', () => {
      if (!rejected) resolve(form)
    })

    request.on('data', countBytes)
    request.pipe(parser)
  })
}
