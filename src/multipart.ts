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

export function parseMultipart(request: Request, maxFileBytes: number): Promise<MultipartForm> {
  return new Promise((resolve, reject) => {
    const form: MultipartForm = { fields: {}, files: {} }
    const parser = busboy({ headers: request.headers, limits: { fileSize: maxFileBytes } })

    parser.on('field', (name, value) => {
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
    })
    parser.on('error', reject)
    parser.on('close', () => resolve(form))
    request.pipe(parser)
  })
}
