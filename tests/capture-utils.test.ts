import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  MAX_SEMANTIC_CAPTURE_BYTES,
  captureBody,
  captureRequestIncludeUsage,
  captureRequestMetadata,
  captureRequestStream,
  captureToScenario,
} from '../src/capture-utils.js'
import type {
  BodyChunkRecord,
  CaptureDetail,
  CaptureHeaderRecord,
  HeadRecord,
} from '../src/recording.js'

function chunks(kind: BodyChunkRecord['kind'], values: Array<{ body: Buffer; atUs: number }>): BodyChunkRecord[] {
  let byteOffset = 0
  return values.map(({ body, atUs }, seq) => {
    const record: BodyChunkRecord = {
      kind,
      seq,
      atUs,
      byteOffset,
      bytesBase64: body.toString('base64'),
    }
    byteOffset += body.byteLength
    return record
  })
}

function detail(
  responseValues: Array<{ body: Buffer; atUs: number }>,
  responseHeaders: Array<[string, string]>,
  requestBody = Buffer.from('{"stream":true,"stream_options":{"include_usage":true}}'),
): CaptureDetail {
  const header: CaptureHeaderRecord = {
    kind: 'capture',
    schema: 'mock-openai-api.capture',
    schemaVersion: 1,
    id: 'cap_captureutilstest',
    createdAt: '2026-07-22T00:00:00.000Z',
    protocol: 'openai-chat',
    source: 'record',
    downstreamUrl: 'http://127.0.0.1:3000/v1/chat/completions',
    upstreamUrl: 'https://api.openai.com/v1/chat/completions',
    redactions: [],
  }
  const responseHead: HeadRecord = {
    kind: 'response.head',
    atUs: 1_000,
    status: 200,
    statusText: 'OK',
    httpVersion: '1.1',
    rawHeaders: responseHeaders,
    source: 'upstream',
  }
  const requestChunks = chunks('request.body_chunk', [{ body: requestBody, atUs: 100 }])
  const responseChunks = chunks('response.body_chunk', responseValues)
  const responseBody = Buffer.concat(responseValues.map(({ body }) => body))
  const records = [header, ...requestChunks, responseHead, ...responseChunks] as CaptureDetail['records']
  return {
    filename: 'capture.llmcap.jsonl',
    partial: false,
    header,
    records,
    responseHead,
    responseChunks,
    responseEnd: {
      kind: 'response.end',
      atUs: responseValues.at(-1)?.atUs ?? 1_000,
      bytes: responseBody.byteLength,
      sha256: createHash('sha256').update(responseBody).digest('hex'),
    },
    captureEnd: {
      kind: 'capture.end',
      atUs: responseValues.at(-1)?.atUs ?? 1_000,
      outcome: 'complete',
      requestBodyExact: true,
      requestHeadersSanitized: true,
      responseBodyExact: true,
      timingReplayable: true,
      downstreamBytesWritten: responseBody.byteLength,
    },
    integrity: { request: 'valid', upstreamRequest: 'unavailable', response: 'valid' },
  }
}

describe('capture semantic conversion', () => {
  it('bounds capture body materialization before decoding chunks', () => {
    const capture = detail([{ body: Buffer.from('1234'), atUs: 10_000 }], [
      ['content-type', 'application/json'],
    ])
    expect(() => captureBody(capture, 'response.body_chunk', 3)).toThrow(/3 byte materialization limit/)
  })

  it('exports request stream controls used by exact replay eligibility', () => {
    const capture = detail([], [['content-type', 'application/json']])
    expect(captureRequestMetadata(capture)).toEqual({ stream: true, includeUsage: true })
    expect(captureRequestStream(capture)).toBe(true)
    expect(captureRequestIncludeUsage(capture)).toBe(true)
  })

  it('maps an SSE event to the chunk containing its final delimiter byte', () => {
    const textEvent = Buffer.from(
      'data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"A"},"finish_reason":null}]}\r\n\r\n',
    )
    const finishEvent = Buffer.from(
      'data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\r\n\r\n',
    )
    const doneEvent = Buffer.from('data: [DONE]\r\n\r\n')
    const first = textEvent.subarray(0, -1)
    const second = Buffer.concat([textEvent.subarray(-1), finishEvent.subarray(0, 20)])
    const third = Buffer.concat([finishEvent.subarray(20), doneEvent])
    const capture = detail([
      { body: first, atUs: 10_000 },
      { body: second, atUs: 20_000 },
      { body: third, atUs: 50_000 },
    ], [['content-type', 'text/event-stream']])

    const scenario = captureToScenario(capture)
    expect(scenario.timeline.find((event) => event.type === 'message.start')?.atUs).toBe(20_000)
    const textStart = scenario.timeline.find((event) => event.type === 'text.start')
    const textDelta = scenario.timeline.find((event) => event.type === 'text.delta')
    const textEnd = scenario.timeline.find((event) => event.type === 'text.end')
    expect(textStart).toMatchObject({ atUs: 20_000, textId: 'text_0' })
    expect(textDelta).toMatchObject({
      delta: 'A',
      atUs: 20_000,
      textId: 'text_0',
    })
    expect(textEnd).toMatchObject({ atUs: 50_000, textId: 'text_0' })
    expect(scenario.timeline.find((event) => event.type === 'finish')?.atUs).toBe(50_000)
  })

  it('rejects compressed semantic output above the configured limit', () => {
    const compressed = gzipSync(Buffer.alloc(MAX_SEMANTIC_CAPTURE_BYTES + 1, 0x61))
    const capture = detail([{ body: compressed, atUs: 10_000 }], [
      ['content-type', 'application/json'],
      ['content-encoding', 'gzip'],
    ])
    expect(() => captureToScenario(capture)).toThrow(/Semantic capture output exceeds/)
  })
})
