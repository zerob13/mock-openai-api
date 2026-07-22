import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, get } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CaptureStore,
  MAX_CAPTURE_LINE_BYTES,
  MAX_CAPTURE_SECRET_BYTES,
  REDACTED,
  captureExactReplayEligibility,
  createCaptureWriter,
  extractCredentialSecrets,
  replayCaptureResponse,
  replayResponseEvents,
  sanitizeHeaders,
  sanitizeUrl,
  type CaptureDetail,
  type ReplayEvent,
} from '../src/recording.js';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'mock-openai-recording-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function collectReplay(
  capture: CaptureDetail,
  speed: 'instant' | number = 'instant',
): Promise<{ events: ReplayEvent[]; body: Buffer }> {
  const events: ReplayEvent[] = [];
  const chunks: Buffer[] = [];
  for await (const event of replayResponseEvents(capture, { speed })) {
    events.push(event);
    if (event.type === 'chunk') chunks.push(event.bytes);
  }
  return { events, body: Buffer.concat(chunks) };
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function capturedBody(capture: CaptureDetail, kind: 'request.body_chunk' | 'response.body_chunk'): Buffer {
  return Buffer.concat(
    capture.records
      .filter((record) => record.kind === kind)
      .map((record) => Buffer.from(record.bytesBase64, 'base64')),
  );
}

async function completeCapture(directory: string): Promise<{ id: string; body: Buffer; path: string }> {
  let nowNs = 0n;
  const writer = await createCaptureWriter({
    directory,
    id: 'cap_recordingtest1',
    protocol: 'openai-chat',
    downstreamUrl: 'http://127.0.0.1:3000/v1/chat/completions?api_key=downstream-secret',
    upstreamUrl: 'https://upstream.example/v1/chat/completions?TOKEN=upstream-secret',
    request: {
      method: 'POST',
      httpVersion: '1.1',
      url: 'http://127.0.0.1:3000/v1/chat/completions?key=request-secret',
      headers: [
        ['Host', '127.0.0.1:3000'],
        ['Authorization', 'Bearer header-secret'],
        ['Content-Type', 'application/json'],
        ['X-Trace', 'visible'],
      ],
    },
    createdAt: new Date('2026-07-22T10:00:00.000Z'),
    startTimeNs: 0n,
    clock: () => nowNs,
  });

  const request = Buffer.from('{"stream":true,"stream_options":{"include_usage":true},"message":"hello"}');
  await writer.recordRequestChunk(request.subarray(0, 9), { atUs: 100 });
  await writer.recordRequestChunk(request.subarray(9), { atUs: 200 });
  await writer.endRequest({ atUs: 250 });
  await writer.recordUpstreamRequestHead(
    {
      method: 'POST',
      url: 'https://upstream.example/v1/chat/completions?access_token=another-secret',
      headers: {
        host: 'upstream.example',
        authorization: 'Bearer upstream-header-secret',
      },
    },
    300,
  );
  await writer.endUpstreamRequest({ atUs: 400 });
  await writer.recordUpstreamResponseHead(
    {
      status: 200,
      statusText: 'OK',
      headers: [
        ['Content-Type', 'text/event-stream'],
        ['Set-Cookie', 'session=response-secret'],
      ],
    },
    1_000,
  );
  await writer.recordResponseHead(
    {
      status: 200,
      statusText: 'OK',
      headers: [
        ['Content-Type', 'text/event-stream'],
        ['Connection', 'keep-alive, x-remove'],
        ['X-Remove', 'dynamic-hop-header'],
      ],
    },
    1_100,
  );

  const body = Buffer.from('data: {"text":"你"}\r\n\r\ndata: [DONE]\r\n\r\n');
  await writer.recordResponseChunk(body.subarray(0, 18), {
    upstreamObservedAtUs: 9_900,
    atUs: 10_000,
  });
  await writer.recordResponseChunk(body.subarray(18), {
    upstreamObservedAtUs: 29_900,
    atUs: 30_000,
  });
  await writer.endUpstreamResponse({ atUs: 31_000 });
  await writer.endResponse({
    atUs: 32_000,
    eofObserved: true,
    terminalMarker: { kind: 'openai-chat-done', observed: true },
  });
  nowNs = 33_000_000n;
  const path = await writer.finish({ outcome: 'complete' });
  return { id: writer.id, body, path };
}

describe('capture sanitization', () => {
  it('redacts credential headers, URL userinfo, and case-insensitive query keys', () => {
    expect(
      sanitizeHeaders([
        'Authorization',
        'Bearer secret',
        'X-API-Key',
        'secret',
        'X-Trace',
        'visible',
      ]),
    ).toEqual([
      ['Authorization', '[REDACTED]'],
      ['X-API-Key', '[REDACTED]'],
      ['X-Trace', 'visible'],
    ]);

    const sanitized = sanitizeUrl(
      'https://user:password@example.com/v1/messages?api_key=secret&TOKEN=other&model=test',
    );
    expect(sanitized).not.toContain('user');
    expect(sanitized).not.toContain('password');
    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('other');
    expect(sanitized).toContain('model=test');
    expect(sanitized).toContain('%5BREDACTED%5D');
  });
});

describe('CaptureWriter and CaptureStore', () => {
  it('writes one atomic JSONL capture with hashes, timing, and no API keys', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const contents = await readFile(completed.path, 'utf8');

    expect(contents).not.toContain('downstream-secret');
    expect(contents).not.toContain('upstream-secret');
    expect(contents).not.toContain('request-secret');
    expect(contents).not.toContain('header-secret');
    expect(contents).not.toContain('response-secret');
    expect(contents).toContain('[REDACTED]');

    const records = contents.trim().split('\n').map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      kind: 'capture',
      schema: 'mock-openai-api.capture',
      schemaVersion: 1,
      protocol: 'openai-chat',
    });
    expect(records.at(-1)).toMatchObject({
      kind: 'capture.end',
      outcome: 'complete',
      downstreamBytesWritten: completed.body.byteLength,
    });
    expect(records.filter((record) => record.kind === 'response.body_chunk')).toHaveLength(2);

    const store = new CaptureStore(directory);
    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: completed.id,
      protocol: 'openai-chat',
      outcome: 'complete',
      method: 'POST',
      status: 200,
      ttfbUs: 1_100,
      requestBytes: Buffer.byteLength('{"stream":true,"stream_options":{"include_usage":true},"message":"hello"}'),
      responseBytes: completed.body.byteLength,
      bodyExact: true,
      timingReplayable: true,
      stream: true,
      includeUsage: true,
      valid: true,
    });
    expect(list[0].downstreamUrl).toContain('%5BREDACTED%5D');
    expect(list[0].upstreamUrl).toContain('%5BREDACTED%5D');

    const detail = await store.read(completed.id);
    expect(detail.integrity).toMatchObject({ request: 'valid', response: 'valid' });
    expect(detail.responseChunks.map((chunk) => chunk.atUs)).toEqual([10_000, 30_000]);
    const replay = await collectReplay(detail);
    expect(replay.body).toEqual(completed.body);
    expect(replay.events.map((event) => event.type)).toEqual([
      'head',
      'chunk',
      'chunk',
      'end',
    ]);
  });

  it('keeps abandoned files recoverable as partial captures', async () => {
    const directory = await temporaryDirectory();
    const writer = await createCaptureWriter({
      directory,
      id: 'cap_partialtest1',
      protocol: 'anthropic-messages',
      downstreamUrl: 'http://127.0.0.1:3000/v1/messages',
      upstreamUrl: 'https://api.anthropic.com/v1/messages',
      request: { method: 'POST', httpVersion: '1.1', headers: {} },
    });
    await writer.recordRequestChunk('{"stream":true}');
    await writer.abandon();

    const store = new CaptureStore(directory);
    expect(await store.list()).toEqual([]);
    const partial = await store.list({ includePartial: true });
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({ id: writer.id, partial: true, valid: true });
    const detail = await store.read(writer.id);
    expect(detail.partial).toBe(true);
    expect(detail.captureEnd).toBeUndefined();
  });

  it('rejects traversal and symlink targets and deletes only selected captures', async () => {
    const directory = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const linkName = 'outside.llmcap.jsonl';
    await symlink(join(outside, 'missing'), join(directory, linkName));

    const store = new CaptureStore(directory);
    await expect(store.read('../outside.llmcap.jsonl')).rejects.toThrow();
    await expect(store.read(linkName)).rejects.toThrow('regular file');
    expect(await store.list()).toHaveLength(1);

    await store.delete(completed.id);
    expect(await store.list()).toEqual([]);
  });

  it('detects a response body hash mismatch before replay', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const lines = (await readFile(completed.path, 'utf8')).trimEnd().split('\n');
    const chunkIndex = lines.findIndex((line) => line.includes('"kind":"response.body_chunk"'));
    const chunk = JSON.parse(lines[chunkIndex]);
    const original = Buffer.from(chunk.bytesBase64, 'base64');
    chunk.bytesBase64 = Buffer.alloc(original.byteLength, 0x78).toString('base64');
    lines[chunkIndex] = JSON.stringify(chunk);
    await writeFile(completed.path, `${lines.join('\n')}\n`);

    const store = new CaptureStore(directory);
    expect((await store.list())[0]).toMatchObject({
      id: completed.id,
      valid: false,
      error: 'Capture response hash is invalid',
    });
    const detail = await store.read(basename(completed.path));
    expect(detail.integrity.response).toBe('invalid');
    await expect(collectReplay(detail)).rejects.toThrow('hash is invalid');
  });

  it('preserves chunk boundaries and timing when configured credentials are absent from bodies', async () => {
    const directory = await temporaryDirectory();
    const writer = await createCaptureWriter({
      directory,
      id: 'cap_boundarysafe1',
      protocol: 'openai-chat',
      downstreamUrl: 'http://127.0.0.1/v1/chat/completions',
      upstreamUrl: 'https://upstream.example/v1/chat/completions',
      request: { method: 'POST', httpVersion: '1.1', headers: {} },
      credentialSecrets: ['credential-never-present'],
    });
    await writer.recordUpstreamRequestHead({
      method: 'POST',
      url: 'https://upstream.example/v1/chat/completions',
      headers: {},
    });
    const requestChunks = [
      Buffer.from('{"text":"credential-'),
      Buffer.from('not-the-secret","stream":'),
      Buffer.from('true}'),
    ];
    const requestTimes = [101, 202, 303];
    for (let index = 0; index < requestChunks.length; index += 1) {
      await writer.recordRequestChunk(requestChunks[index], { atUs: requestTimes[index] });
    }
    await writer.endRequest({ atUs: 404 });
    await writer.endUpstreamRequest({ atUs: 505 });

    await writer.recordUpstreamResponseHead({ status: 200, headers: { 'content-type': 'text/event-stream' } });
    await writer.recordResponseHead({ status: 200, headers: { 'content-type': 'text/event-stream' } });
    const responseChunks = [
      Buffer.from('data: credential-'),
      Buffer.from('not-the-secret\n\n'),
      Buffer.from('data: [DONE]\n\n'),
    ];
    const responseTimes = [1_001, 2_002, 3_003];
    const observedTimes = [901, 1_902, 2_903];
    for (let index = 0; index < responseChunks.length; index += 1) {
      await writer.recordResponseChunk(responseChunks[index], {
        atUs: responseTimes[index],
        upstreamObservedAtUs: observedTimes[index],
      });
    }
    await writer.endUpstreamResponse({ atUs: 3_500 });
    await writer.endResponse({ atUs: 4_000 });
    await writer.finish({ outcome: 'complete' });

    const capture = await new CaptureStore(directory).read(writer.id);
    const requestRecords = capture.records.filter(
      (record) => record.kind === 'request.body_chunk',
    );
    const responseRecords = capture.records.filter(
      (record) => record.kind === 'response.body_chunk',
    );
    let requestOffset = 0;
    expect(requestRecords.map((record, index) => {
      const value = {
        seq: record.seq,
        atUs: record.atUs,
        byteOffset: record.byteOffset,
        bytes: Buffer.from(record.bytesBase64, 'base64'),
      };
      requestOffset += requestChunks[index].byteLength;
      return value;
    })).toEqual(requestChunks.map((bytes, index) => ({
      seq: index,
      atUs: requestTimes[index],
      byteOffset: requestChunks.slice(0, index).reduce((sum, chunk) => sum + chunk.byteLength, 0),
      bytes,
    })));
    expect(requestOffset).toBe(Buffer.concat(requestChunks).byteLength);

    expect(responseRecords.map((record) => ({
      seq: record.seq,
      atUs: record.atUs,
      upstreamObservedAtUs: record.upstreamObservedAtUs,
      byteOffset: record.byteOffset,
      bytes: Buffer.from(record.bytesBase64, 'base64'),
    }))).toEqual(responseChunks.map((bytes, index) => ({
      seq: index,
      atUs: responseTimes[index],
      upstreamObservedAtUs: observedTimes[index],
      byteOffset: responseChunks.slice(0, index).reduce((sum, chunk) => sum + chunk.byteLength, 0),
      bytes,
    })));
    expect(capture.captureEnd).toMatchObject({
      requestBodyExact: true,
      responseBodyExact: true,
    });
    expect(capture.integrity).toMatchObject({ request: 'valid', response: 'valid' });
  });

  it('redacts header credentials split across request and response chunks', async () => {
    const directory = await temporaryDirectory();
    const secret = 'cross-chunk-credential-123';
    const querySecret = 'query-credential-456';
    const credentials = extractCredentialSecrets(
      [['Authorization', `Bearer ${secret}`]],
      `http://127.0.0.1/v1/chat/completions?api_key=${querySecret}`,
    );
    expect(credentials.map((value) => value.toString())).toEqual([secret, querySecret]);

    const writer = await createCaptureWriter({
      directory,
      id: 'cap_bodyredact1',
      protocol: 'openai-chat',
      downstreamUrl: 'http://127.0.0.1/v1/chat/completions',
      upstreamUrl: 'https://upstream.example/v1/chat/completions',
      request: {
        method: 'POST',
        httpVersion: '1.1',
        headers: { authorization: `Bearer ${secret}` },
      },
      credentialSecrets: credentials,
    });
    await writer.recordUpstreamRequestHead({
      method: 'POST',
      url: 'https://upstream.example/v1/chat/completions',
      headers: { authorization: `Bearer ${secret}` },
    });

    const requestBody = Buffer.from(
      `{"credential":"${secret}","query":"${querySecret}"}`,
    );
    const requestSplit = requestBody.indexOf(secret) + 7;
    await writer.recordRequestChunk(requestBody.subarray(0, requestSplit), { atUs: 100 });
    await writer.recordRequestChunk(requestBody.subarray(requestSplit), { atUs: 200 });
    await writer.endRequest({ atUs: 300 });
    await writer.endUpstreamRequest({ atUs: 400 });

    await writer.recordUpstreamResponseHead(
      { status: 200, headers: { 'content-type': 'application/json' } },
      450,
    );
    await writer.recordResponseHead(
      { status: 200, headers: { 'content-type': 'application/json' } },
      460,
    );
    const responseBody = Buffer.from(`{"echo":"${secret}"}`);
    const responseSplit = responseBody.indexOf(secret) + 5;
    await writer.recordResponseChunk(responseBody.subarray(0, responseSplit), { atUs: 500 });
    await writer.recordResponseChunk(responseBody.subarray(responseSplit), { atUs: 600 });
    await writer.endUpstreamResponse({ atUs: 700 });
    await writer.endResponse({ atUs: 800 });
    const path = await writer.finish({
      outcome: 'complete',
      downstreamBytesWritten: responseBody.byteLength,
    });

    const file = await readFile(path, 'utf8');
    expect(file).not.toContain(secret);
    expect(file).not.toContain(querySecret);

    const capture = await new CaptureStore(directory).read(writer.id);
    const sanitizedRequest = Buffer.from(
      requestBody.toString().replace(secret, REDACTED).replace(querySecret, REDACTED),
    );
    const sanitizedResponse = Buffer.from(responseBody.toString().replace(secret, REDACTED));
    expect(capturedBody(capture, 'request.body_chunk')).toEqual(sanitizedRequest);
    expect(capturedBody(capture, 'response.body_chunk')).toEqual(sanitizedResponse);
    expect(capture.captureEnd).toMatchObject({
      requestBodyExact: false,
      responseBodyExact: false,
      timingReplayable: true,
      downstreamBytesWritten: responseBody.byteLength,
    });
    expect(capture.integrity).toMatchObject({ request: 'valid', response: 'valid' });

    const record = (kind: string) => capture.records.find((candidate) => candidate.kind === kind) as {
      bytes: number;
      sha256: string;
    };
    expect(record('request.end')).toMatchObject({
      bytes: sanitizedRequest.byteLength,
      sha256: sha256(sanitizedRequest),
    });
    expect(record('upstream.request.end')).toMatchObject({
      bytes: requestBody.byteLength,
      sha256: sha256(requestBody),
    });
    expect(record('response.end')).toMatchObject({
      bytes: sanitizedResponse.byteLength,
      sha256: sha256(sanitizedResponse),
    });
    expect(record('upstream.response.end')).toMatchObject({
      bytes: responseBody.byteLength,
      sha256: sha256(responseBody),
    });
    await expect(collectReplay(capture)).rejects.toThrow('body-exact');
  });

  it('redacts credential values in response metadata and suppresses encoded bodies', async () => {
    const directory = await temporaryDirectory();
    const secret = 'encoded/credential-123';
    const rawSecret = 'encoded%2Fcredential-123';
    const credentials = extractCredentialSecrets(
      { authorization: `Bearer ${secret}` },
      `http://127.0.0.1/v1/chat/completions?api_key=${rawSecret}`,
    );
    expect(credentials.map((value) => value.toString())).toEqual([secret, rawSecret]);

    const writer = await createCaptureWriter({
      directory,
      id: 'cap_encodedsecret1',
      protocol: 'openai-chat',
      downstreamUrl: 'http://127.0.0.1/v1/chat/completions',
      upstreamUrl: 'https://upstream.example/v1/chat/completions',
      request: {
        method: 'POST',
        httpVersion: '1.1',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-encoding': 'gzip',
        },
      },
      credentialSecrets: credentials,
    });
    const requestBody = gzipSync(Buffer.from(`{"key":"${secret}"}`));
    await writer.recordRequestChunk(requestBody);
    await writer.flushRequestBody(100);
    await writer.recordTrailers('request', { 'x-debug': secret }, 110);
    await writer.endRequest({ atUs: 120 });

    await writer.recordUpstreamRequestHead({
      method: 'POST',
      url: 'https://upstream.example/v1/chat/completions',
      headers: { authorization: `Bearer ${secret}` },
    });
    await writer.endUpstreamRequest();
    await writer.recordUpstreamResponseHead({
      status: 200,
      statusText: `OK ${secret}`,
      headers: { 'content-encoding': 'gzip', 'x-debug': secret },
    });
    await writer.recordResponseHead({
      status: 200,
      statusText: `OK ${secret}`,
      headers: { 'content-encoding': 'gzip', 'x-debug': secret },
    });
    const responseBody = gzipSync(Buffer.from(`{"echo":"${secret}"}`));
    await writer.recordResponseChunk(responseBody, { atUs: 200 });
    await writer.flushResponseBody(210);
    await writer.recordTrailers('response', { 'x-debug': secret }, 220);
    await writer.endUpstreamResponse({ atUs: 230 });
    await writer.endResponse({ atUs: 240 });
    const path = await writer.finish({ outcome: 'complete', downstreamBytesWritten: responseBody.byteLength });

    expect(await readFile(path, 'utf8')).not.toContain(secret);
    const capture = await new CaptureStore(directory).read(writer.id);
    expect(capturedBody(capture, 'request.body_chunk')).toEqual(Buffer.from(REDACTED));
    expect(capturedBody(capture, 'response.body_chunk')).toEqual(Buffer.from(REDACTED));
    expect(capture.captureEnd).toMatchObject({ requestBodyExact: false, responseBodyExact: false });
    expect(capture.records.find((record) => record.kind === 'response.head')).toMatchObject({
      statusText: `OK ${REDACTED}`,
      rawHeaders: expect.arrayContaining([['x-debug', REDACTED]]),
    });
    expect(capture.records.find((record) => record.kind === 'response.trailers')).toMatchObject({
      rawHeaders: [['x-debug', REDACTED]],
    });
  });

  it('suppresses bodies for credentials outside the scanner size bounds', async () => {
    const directory = await temporaryDirectory();
    const shortSecret = 'tiny';
    const oversizedSecret = 'x'.repeat(MAX_CAPTURE_SECRET_BYTES + 1);
    const credentials = extractCredentialSecrets(
      { 'x-api-key': shortSecret },
      `http://127.0.0.1/v1/chat/completions?token=${oversizedSecret}`,
    );
    expect(credentials.map((value) => value.byteLength)).toEqual([
      Buffer.byteLength(shortSecret),
      MAX_CAPTURE_SECRET_BYTES + 1,
    ]);

    const writer = await createCaptureWriter({
      directory,
      id: 'cap_bodysuppress1',
      protocol: 'openai-chat',
      downstreamUrl: 'http://127.0.0.1/v1/chat/completions',
      upstreamUrl: 'https://upstream.example/v1/chat/completions',
      request: { method: 'POST', httpVersion: '1.1', headers: { 'x-api-key': shortSecret } },
      credentialSecrets: credentials,
    });
    await writer.recordUpstreamRequestHead({
      method: 'POST',
      url: 'https://upstream.example/v1/chat/completions',
      headers: { 'x-api-key': shortSecret },
    });
    const requestBody = Buffer.from(`{"short":"${shortSecret}","long":"${oversizedSecret}"}`);
    await writer.recordRequestChunk(requestBody.subarray(0, 100));
    await writer.recordRequestChunk(requestBody.subarray(100));
    await writer.endRequest();
    await writer.endUpstreamRequest();

    await writer.recordUpstreamResponseHead({ status: 200, headers: {} });
    await writer.recordResponseHead({ status: 200, headers: {} });
    const responseBody = Buffer.from(`${shortSecret}:${oversizedSecret}`);
    await writer.recordResponseChunk(responseBody.subarray(0, 100));
    await writer.recordResponseChunk(responseBody.subarray(100));
    await writer.endUpstreamResponse();
    await writer.endResponse();
    await writer.finish({ outcome: 'complete', downstreamBytesWritten: responseBody.byteLength });

    const capture = await new CaptureStore(directory).read(writer.id);
    const marker = Buffer.from(REDACTED);
    expect(capturedBody(capture, 'request.body_chunk')).toEqual(marker);
    expect(capturedBody(capture, 'response.body_chunk')).toEqual(marker);
    expect(capture.records.filter((record) => record.kind === 'request.body_chunk')).toHaveLength(1);
    expect(capture.records.filter((record) => record.kind === 'response.body_chunk')).toHaveLength(1);
    expect(capture.captureEnd).toMatchObject({
      requestBodyExact: false,
      responseBodyExact: false,
      downstreamBytesWritten: responseBody.byteLength,
    });
    expect(capture.integrity).toMatchObject({ request: 'valid', response: 'valid' });

    const record = (kind: string) => capture.records.find((candidate) => candidate.kind === kind) as {
      bytes: number;
      sha256: string;
    };
    expect(record('request.end')).toMatchObject({ bytes: marker.byteLength, sha256: sha256(marker) });
    expect(record('response.end')).toMatchObject({ bytes: marker.byteLength, sha256: sha256(marker) });
    expect(record('upstream.request.end')).toMatchObject({
      bytes: requestBody.byteLength,
      sha256: sha256(requestBody),
    });
    expect(record('upstream.response.end')).toMatchObject({
      bytes: responseBody.byteLength,
      sha256: sha256(responseBody),
    });
  });

  it('rejects capture JSONL lines larger than 16 MiB', async () => {
    const directory = await temporaryDirectory();
    const filename = 'oversized.llmcap.jsonl';
    await writeFile(join(directory, filename), Buffer.alloc(MAX_CAPTURE_LINE_BYTES + 1, 0x20));

    const store = new CaptureStore(directory);
    expect(await store.list()).toEqual([
      expect.objectContaining({
        filename,
        valid: false,
        error: expect.stringContaining('line exceeds'),
      }),
    ]);
    await expect(store.read(filename)).rejects.toThrow('line exceeds');
  });
});

describe('raw replay', () => {
  it('requires complete EOF and protocol terminal markers only for SSE captures', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const capture = await new CaptureStore(directory).read(completed.id);
    const responseEnd = capture.responseEnd!;
    const responseHead = capture.responseHead!;

    expect(captureExactReplayEligibility(capture)).toEqual({ eligible: true });

    responseEnd.complete = false;
    expect(captureExactReplayEligibility(capture).reason).toContain('response.end.complete');
    responseEnd.complete = true;

    responseEnd.eofObserved = false;
    expect(captureExactReplayEligibility(capture).reason).toContain('response.end.eofObserved');
    responseEnd.eofObserved = true;

    responseEnd.terminalMarker = { kind: 'openai-chat-done', observed: false };
    expect(captureExactReplayEligibility(capture).reason).toContain('SSE terminal marker');

    responseHead.rawHeaders = [['Content-Type', 'application/json; charset=utf-8']];
    responseEnd.terminalMarker = undefined;
    expect(captureExactReplayEligibility(capture)).toEqual({ eligible: true });

    responseHead.rawHeaders = [['Content-Type', 'text/event-stream']];
    responseEnd.complete = false;
    responseEnd.terminalMarker = { kind: 'openai-chat-done', observed: false };
    capture.captureEnd!.outcome = 'capture_truncated';
    await expect(async () => {
      for await (const _event of replayResponseEvents(capture, {
        speed: 'instant',
        allowIncomplete: true,
      })) {
        // Consume the generator so its validation runs.
      }
    }).rejects.toThrow('response.end.complete');
  });

  it('replays the original chunks on their absolute recorded schedule', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const capture = await new CaptureStore(directory).read(completed.id);
    const startedAt = process.hrtime.bigint();
    const replay = await collectReplay(capture, 1);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    expect(replay.body).toEqual(completed.body);
    expect(elapsedMs).toBeGreaterThanOrEqual(25);
    expect(elapsedMs).toBeLessThan(1_000);
  });

  it('rejects cross-protocol raw replay', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const capture = await new CaptureStore(directory).read(completed.id);

    await expect(async () => {
      for await (const _event of replayResponseEvents(capture, {
        speed: 'instant',
        targetProtocol: 'anthropic-messages',
      })) {
        // Consume the generator so its validation runs.
      }
    }).rejects.toThrow('same protocol');
  });

  it('writes a body-exact replay through a real ServerResponse', async () => {
    const directory = await temporaryDirectory();
    const completed = await completeCapture(directory);
    const capture = await new CaptureStore(directory).read(completed.id);
    const server = createServer((_request, response) => {
      void replayCaptureResponse(capture, response, {
        speed: 'instant',
        targetProtocol: 'openai-chat',
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind');

    try {
      const result = await new Promise<{ body: Buffer; headers: Record<string, unknown> }>(
        (resolve, reject) => {
          get(`http://127.0.0.1:${address.port}`, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            response.on('end', () => resolve({ body: Buffer.concat(chunks), headers: response.headers }));
          }).on('error', reject);
        },
      );
      expect(result.body).toEqual(completed.body);
      expect(result.headers['content-type']).toBe('text/event-stream');
      expect(result.headers['x-remove']).toBeUndefined();
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
