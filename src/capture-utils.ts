import type {
  BodyChunkRecord,
  CaptureDetail,
  CaptureRecord,
  CaptureRequestMetadata,
  EndRecord,
  HeadRecord,
} from './recording.js'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import {
  MAX_CAPTURE_REQUEST_METADATA_BYTES,
  parseCaptureRequestMetadata,
} from './recording.js'
import { parseCaptureBody, type ScenarioEvent, type ScenarioV1 } from './scenario.js'

export const MAX_CAPTURE_BODY_BYTES = 64 * 1024 * 1024
export const MAX_SEMANTIC_CAPTURE_BYTES = 16 * 1024 * 1024

function base64ByteLength(value: string): number {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Capture contains invalid base64 data')
  }
  if (!value) return 0
  return value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
}

function headRecord(detail: CaptureDetail, kind: HeadRecord['kind']): HeadRecord | undefined {
  return detail.records.find((record): record is HeadRecord => record.kind === kind)
}

function endRecord(detail: CaptureDetail, kind: 'request.end' | 'response.end'): EndRecord | undefined {
  return detail.records.find((record): record is EndRecord => record.kind === kind)
}

function chunksByKind(detail: CaptureDetail, kind: BodyChunkRecord['kind']): BodyChunkRecord[] {
  return detail.records.filter((record): record is BodyChunkRecord => record.kind === kind)
}

export function captureBody(
  detail: CaptureDetail,
  kind: BodyChunkRecord['kind'],
  maxBytes = MAX_CAPTURE_BODY_BYTES,
): Buffer {
  const chunks = chunksByKind(detail, kind)
  let bytes = 0
  for (const chunk of chunks) {
    bytes += base64ByteLength(chunk.bytesBase64)
    if (bytes > maxBytes) throw new Error(`Capture ${kind} exceeds the ${maxBytes} byte materialization limit`)
  }
  return Buffer.concat(chunks.map((record) => Buffer.from(record.bytesBase64, 'base64')), bytes)
}

function responseEncodings(detail: CaptureDetail): string[] {
  return (headerValue(detail.responseHead, 'content-encoding') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== 'identity')
    .reverse()
}

function decodedResponseBody(detail: CaptureDetail): Buffer {
  let body = captureBody(detail, 'response.body_chunk', MAX_SEMANTIC_CAPTURE_BYTES)
  for (const encoding of responseEncodings(detail)) {
    try {
      const options = { maxOutputLength: MAX_SEMANTIC_CAPTURE_BYTES }
      if (encoding === 'gzip' || encoding === 'x-gzip') body = gunzipSync(body, options)
      else if (encoding === 'deflate') body = inflateSync(body, options)
      else if (encoding === 'br') body = brotliDecompressSync(body, options)
      else throw new Error(`Cannot semantically replay content-encoding: ${encoding}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
        || /maxOutputLength|larger than/i.test((error as Error).message)) {
        throw new Error(`Semantic capture output exceeds ${MAX_SEMANTIC_CAPTURE_BYTES} bytes`)
      }
      throw error
    }
  }
  return body
}

function headerValue(head: HeadRecord | undefined, name: string): string | undefined {
  return head?.rawHeaders.find(([header]) => header.toLowerCase() === name.toLowerCase())?.[1]
}

export function captureIsStream(detail: CaptureDetail): boolean {
  return headerValue(detail.responseHead, 'content-type')?.toLowerCase().includes('text/event-stream') === true
}

export function captureRequestMetadata(detail: CaptureDetail): CaptureRequestMetadata | undefined {
  if (detail.requestMetadata) return { ...detail.requestMetadata }
  const chunks = chunksByKind(detail, 'request.body_chunk')
  const bytes = chunks.reduce((total, chunk) => total + base64ByteLength(chunk.bytesBase64), 0)
  if (bytes > MAX_CAPTURE_REQUEST_METADATA_BYTES) return undefined
  return parseCaptureRequestMetadata(captureBody(
    detail,
    'request.body_chunk',
    MAX_CAPTURE_REQUEST_METADATA_BYTES,
  ))
}

export function captureRequestStream(detail: CaptureDetail): boolean | undefined {
  return captureRequestMetadata(detail)?.stream
}

export function captureRequestIncludeUsage(detail: CaptureDetail): boolean | undefined {
  return captureRequestMetadata(detail)?.includeUsage
}

function sseEventEndOffsets(body: Buffer): number[] {
  const offsets: number[] = []
  let position = 0
  let hasData = false
  let firstLine = true

  while (position < body.length) {
    const lineStart = position
    while (position < body.length && body[position] !== 0x0a && body[position] !== 0x0d) position += 1
    const lineEnd = position
    if (position < body.length && body[position] === 0x0d && body[position + 1] === 0x0a) position += 2
    else if (position < body.length) position += 1

    let fieldStart = lineStart
    if (firstLine && lineEnd - lineStart >= 3
      && body[lineStart] === 0xef && body[lineStart + 1] === 0xbb && body[lineStart + 2] === 0xbf) {
      fieldStart += 3
    }
    firstLine = false
    if (fieldStart === lineEnd) {
      if (hasData) offsets.push(position)
      hasData = false
      continue
    }
    if (lineEnd - fieldStart >= 4
      && body[fieldStart] === 0x64
      && body[fieldStart + 1] === 0x61
      && body[fieldStart + 2] === 0x74
      && body[fieldStart + 3] === 0x61
      && (fieldStart + 4 === lineEnd || body[fieldStart + 4] === 0x3a)) {
      hasData = true
    }
  }
  if (hasData) offsets.push(body.length)
  return offsets
}

function recordedSseEventTimes(detail: CaptureDetail, body: Buffer): number[] {
  const chunks = chunksByKind(detail, 'response.body_chunk')
  const chunkEnds: Array<{ end: number; atUs: number }> = []
  let end = 0
  for (const chunk of chunks) {
    end += base64ByteLength(chunk.bytesBase64)
    chunkEnds.push({ end, atUs: chunk.atUs })
  }
  return sseEventEndOffsets(body).map((offset) => {
    const chunk = chunkEnds.find((candidate) => candidate.end >= offset)
    if (!chunk) throw new Error('SSE event extends beyond recorded response chunks')
    return chunk.atUs
  })
}

function normalizeTextBlocks(events: ScenarioEvent[]): ScenarioEvent[] {
  const normalized: ScenarioEvent[] = []
  let activeTextId: string | undefined
  let textIndex = 0

  const startText = (atUs: number, textId?: string, format?: 'plain' | 'markdown'): string => {
    const id = textId ?? `text_${textIndex++}`
    normalized.push({ type: 'text.start', atUs, textId: id, ...(format ? { format } : {}) })
    activeTextId = id
    return id
  }

  for (const event of events) {
    if (event.type === 'text.start') {
      if (activeTextId) normalized.push({ type: 'text.end', atUs: event.atUs, textId: activeTextId })
      startText(event.atUs, event.textId, event.format)
      continue
    }
    if (event.type === 'text.delta') {
      if (event.textId && activeTextId && event.textId !== activeTextId) {
        normalized.push({ type: 'text.end', atUs: event.atUs, textId: activeTextId })
        activeTextId = undefined
      }
      const textId = activeTextId ?? startText(event.atUs, event.textId, event.format)
      normalized.push({ ...event, textId })
      continue
    }
    if (event.type === 'text.end') {
      const textId = activeTextId ?? startText(event.atUs, event.textId)
      normalized.push({ ...event, textId })
      activeTextId = undefined
      continue
    }
    if ((event.type === 'finish' || event.type === 'error') && activeTextId) {
      normalized.push({ type: 'text.end', atUs: event.atUs, textId: activeTextId })
      activeTextId = undefined
    }
    normalized.push(event)
  }
  return normalized
}

export function captureToScenario(detail: CaptureDetail, id?: string, title?: string): ScenarioV1 {
  const body = decodedResponseBody(detail)
  const contentType = headerValue(detail.responseHead, 'content-type')
  const scenario = parseCaptureBody(detail.header.protocol, body, {
    id,
    title,
    captureId: detail.header.id,
    contentType,
    status: detail.responseHead?.status,
  })

  const responseHead = headRecord(detail, 'response.head')
  const responseEnd = endRecord(detail, 'response.end')
  const lastChunkAtUs = detail.responseChunks.at(-1)?.atUs
  if (contentType?.toLowerCase().includes('text/event-stream') && responseEncodings(detail).length === 0) {
    const eventTimes = recordedSseEventTimes(detail, body)
    scenario.timeline = scenario.timeline.map((event) => ({
      ...event,
      atUs: eventTimes[Math.trunc(event.atUs / 1000)] ?? lastChunkAtUs ?? responseEnd?.atUs ?? responseHead?.atUs ?? 0,
    }))
  } else {
    const completedAtUs = lastChunkAtUs ?? responseEnd?.atUs ?? responseHead?.atUs ?? 0
    scenario.timeline = scenario.timeline.map((event) => ({ ...event, atUs: completedAtUs }))
  }
  scenario.timeline = normalizeTextBlocks(scenario.timeline)
  return scenario
}

export function captureView(detail: CaptureDetail): Record<string, unknown> {
  const requestHead = headRecord(detail, 'request.head')
  const upstreamHead = headRecord(detail, 'upstream.request.head')
  const requestEnd = endRecord(detail, 'request.end')
  const responseEnd = endRecord(detail, 'response.end')
  const firstResponseAtUs = detail.responseHead?.atUs ?? detail.responseChunks[0]?.atUs
  const requestBody = captureBody(detail, 'request.body_chunk')
  const responseBody = captureBody(detail, 'response.body_chunk')
  const requestMetadata = captureRequestMetadata(detail)

  return {
    id: detail.header.id,
    filename: detail.filename,
    partial: detail.partial,
    protocol: detail.header.protocol,
    recordingId: detail.header.recordingId,
    recordingOrder: detail.header.recordingOrder,
    createdAt: detail.header.createdAt,
    outcome: detail.captureEnd?.outcome ?? 'capture_truncated',
    stream: requestMetadata?.stream ?? captureIsStream(detail),
    includeUsage: requestMetadata?.includeUsage,
    method: requestHead?.method ?? 'POST',
    downstreamUrl: detail.header.downstreamUrl,
    upstreamUrl: detail.header.upstreamUrl,
    status: detail.responseHead?.status,
    durationUs: detail.captureEnd?.atUs ?? responseEnd?.atUs,
    ttfbUs: firstResponseAtUs,
    requestBytes: requestEnd?.bytes ?? requestBody.byteLength,
    responseBytes: responseEnd?.bytes ?? responseBody.byteLength,
    bodyExact: detail.captureEnd?.responseBodyExact ?? false,
    requestBodyExact: detail.captureEnd?.requestBodyExact ?? false,
    timingReplayable: detail.captureEnd?.timingReplayable ?? false,
    request: {
      head: requestHead,
      upstreamHead,
      bodyUtf8: requestBody.toString('utf8'),
    },
    response: {
      head: detail.responseHead,
      bodyUtf8: responseBody.toString('utf8'),
      end: responseEnd,
    },
    records: detail.records,
    timeline: detail.records.filter((record) => 'atUs' in record),
    hashes: {
      request: requestEnd?.sha256,
      response: responseEnd?.sha256,
      integrity: detail.integrity,
    },
    redactions: detail.header.redactions,
    parseWarning: detail.parseWarning,
  }
}
