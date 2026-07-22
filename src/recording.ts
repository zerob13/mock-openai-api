import { createHash, randomUUID, type Hash } from 'node:crypto';
import { once } from 'node:events';
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';

export const CAPTURE_SCHEMA = 'mock-openai-api.capture';
export const CAPTURE_SCHEMA_VERSION = 1;
export const REDACTED = '[REDACTED]';
export const MIN_CAPTURE_SECRET_BYTES = 8;
export const MAX_CAPTURE_SECRET_BYTES = 4096;
export const MAX_CAPTURE_SECRETS = 32;
export const MAX_CAPTURE_LINE_BYTES = 16 * 1024 * 1024;

export type CaptureProtocol =
  | 'openai-chat'
  | 'openai-responses'
  | 'anthropic-messages';

export type CaptureOutcome =
  | 'complete'
  | 'upstream_error'
  | 'aborted'
  | 'client_cancelled'
  | 'timeout'
  | 'recording_error'
  | 'capture_truncated';

export type HeaderPair = [string, string];
export type HeaderInput =
  | readonly HeaderPair[]
  | readonly string[]
  | Record<string, string | readonly string[] | number | undefined>;

export interface CaptureHeaderRecord {
  kind: 'capture';
  schema: typeof CAPTURE_SCHEMA;
  schemaVersion: typeof CAPTURE_SCHEMA_VERSION;
  id: string;
  createdAt: string;
  protocol: CaptureProtocol;
  source: 'record';
  downstreamUrl: string;
  upstreamUrl: string;
  recordingId?: string;
  recordingOrder?: number;
  redactions: string[];
}

export interface HeadRecord {
  kind:
    | 'request.head'
    | 'upstream.request.head'
    | 'upstream.response.head'
    | 'response.head';
  atUs: number;
  method?: string;
  url?: string;
  status?: number;
  statusText?: string;
  httpVersion: string;
  rawHeaders: HeaderPair[];
  source?: 'upstream' | 'gateway';
}

export interface BodyChunkRecord {
  kind: 'request.body_chunk' | 'response.body_chunk';
  seq: number;
  atUs: number;
  byteOffset: number;
  bytesBase64: string;
  upstreamObservedAtUs?: number;
}

export interface EndRecord {
  kind:
    | 'request.end'
    | 'upstream.request.end'
    | 'upstream.response.end'
    | 'response.end';
  atUs: number;
  bytes: number;
  sha256: string;
  complete?: boolean;
  eofObserved?: boolean;
  terminalMarker?: { kind: string; observed: boolean };
}

export interface TrailersRecord {
  kind:
    | 'request.trailers'
    | 'upstream.request.trailers'
    | 'upstream.response.trailers'
    | 'response.trailers';
  atUs: number;
  rawHeaders: HeaderPair[];
}

export interface UpstreamNetworkRecord {
  kind: 'upstream.network';
  atUs: number;
  event: 'socket' | 'lookup' | 'connect' | 'secureConnect';
  reusedSocket?: boolean;
  address?: string;
  family?: string | number;
}

export interface FailureRecord {
  kind: 'failure';
  atUs: number;
  scope: 'request' | 'upstream' | 'response' | 'recording';
  type: string;
  message: string;
}

export interface ClientDisconnectRecord {
  kind: 'client.disconnect';
  atUs: number;
}

export interface CaptureEndRecord {
  kind: 'capture.end';
  atUs: number;
  outcome: CaptureOutcome;
  requestBodyExact: boolean;
  requestHeadersSanitized: true;
  responseBodyExact: boolean;
  timingReplayable: boolean;
  downstreamBytesWritten: number;
}

export type CaptureRecord =
  | CaptureHeaderRecord
  | HeadRecord
  | BodyChunkRecord
  | EndRecord
  | TrailersRecord
  | UpstreamNetworkRecord
  | FailureRecord
  | ClientDisconnectRecord
  | CaptureEndRecord;

export interface CaptureRequestHead {
  method: string;
  httpVersion: string;
  headers: HeaderInput;
  url?: string;
}

export interface CaptureWriterOptions {
  directory: string;
  protocol: CaptureProtocol;
  downstreamUrl: string;
  upstreamUrl: string;
  request: CaptureRequestHead;
  id?: string;
  createdAt?: Date;
  startTimeNs?: bigint;
  clock?: () => bigint;
  credentialSecrets?: readonly (string | Uint8Array)[];
  recording?: { id: string; order: number };
}

export interface FinishCaptureOptions {
  outcome: CaptureOutcome;
  requestBodyExact?: boolean;
  responseBodyExact?: boolean;
  timingReplayable?: boolean;
  downstreamBytesWritten?: number;
}

export interface CaptureIntegrity {
  request: 'valid' | 'invalid' | 'unavailable';
  upstreamRequest: 'valid' | 'invalid' | 'unavailable';
  response: 'valid' | 'invalid' | 'unavailable';
}

export interface CaptureDetail {
  filename: string;
  partial: boolean;
  header: CaptureHeaderRecord;
  records: CaptureRecord[];
  responseHead?: HeadRecord;
  responseChunks: BodyChunkRecord[];
  responseEnd?: EndRecord;
  captureEnd?: CaptureEndRecord;
  requestMetadata?: CaptureRequestMetadata;
  integrity: CaptureIntegrity;
  parseWarning?: string;
}

export interface CaptureSummary {
  id: string;
  filename: string;
  partial: boolean;
  protocol?: CaptureProtocol;
  recordingId?: string;
  recordingOrder?: number;
  createdAt?: string;
  outcome?: CaptureOutcome;
  durationUs?: number;
  method?: string;
  downstreamUrl?: string;
  upstreamUrl?: string;
  status?: number;
  ttfbUs?: number;
  requestBytes?: number;
  responseBytes?: number;
  bodyExact?: boolean;
  timingReplayable?: boolean;
  stream?: boolean;
  includeUsage?: boolean;
  size: number;
  modifiedAt: string;
  valid: boolean;
  error?: string;
}

export interface CaptureRequestMetadata {
  stream: boolean;
  includeUsage: boolean;
}

export const MAX_CAPTURE_REQUEST_METADATA_BYTES = 1024 * 1024;

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'cookie',
  'set-cookie',
]);

const SENSITIVE_QUERY_KEYS = new Set([
  'key',
  'api_key',
  'access_token',
  'token',
]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'transfer-encoding',
  'upgrade',
]);

const CAPTURE_ID_PATTERN = /^cap_[A-Za-z0-9_-]{8,128}$/;
const RECORDING_ID_PATTERN = /^rec_[A-Za-z0-9_-]{8,128}$/;
const CAPTURE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,240}\.llmcap\.jsonl(?:\.partial)?$/;
const PROTOCOLS = new Set<CaptureProtocol>([
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
]);

function isHeaderPairs(input: HeaderInput): input is readonly HeaderPair[] {
  return Array.isArray(input) && (input.length === 0 || Array.isArray(input[0]));
}

export function normalizeHeaders(input: HeaderInput): HeaderPair[] {
  if (isHeaderPairs(input)) {
    return input.map(([name, value]) => [String(name), String(value)]);
  }

  if (Array.isArray(input)) {
    if (input.length % 2 !== 0) {
      throw new Error('Raw headers must contain name/value pairs');
    }
    const pairs: HeaderPair[] = [];
    for (let index = 0; index < input.length; index += 2) {
      pairs.push([String(input[index]), String(input[index + 1])]);
    }
    return pairs;
  }

  const pairs: HeaderPair[] = [];
  for (const [name, rawValue] of Object.entries(input)) {
    if (rawValue === undefined) continue;
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) pairs.push([name, String(value)]);
    } else {
      pairs.push([name, String(rawValue)]);
    }
  }
  return pairs;
}

export function sanitizeHeaders(input: HeaderInput): HeaderPair[] {
  return normalizeHeaders(input).map(([name, value]) => [
    name,
    SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value,
  ]);
}

function uniqueCredentialSecrets(values: readonly (string | Uint8Array)[]): Buffer[] {
  const unique = new Map<string, Buffer>();
  for (const value of values) {
    const bytes = byteChunk(value);
    if (bytes.byteLength === 0) continue;
    unique.set(bytes.toString('base64'), bytes);
  }
  return [...unique.values()];
}

function prepareCredentialSecrets(
  values: readonly (string | Uint8Array)[],
): { secrets: Buffer[]; suppressBodies: boolean } {
  const unique = uniqueCredentialSecrets(values);
  const suppressBodies = unique.length > MAX_CAPTURE_SECRETS || unique.some((bytes) => (
    bytes.byteLength < MIN_CAPTURE_SECRET_BYTES || bytes.byteLength > MAX_CAPTURE_SECRET_BYTES
  ));
  return {
    secrets: suppressBodies
      ? []
      : unique.sort((left, right) => right.byteLength - left.byteLength),
    suppressBodies,
  };
}

function addHeaderCredentialCandidates(name: string, value: string, candidates: string[]): void {
  const lowerName = name.toLowerCase();
  if (!SENSITIVE_HEADERS.has(lowerName)) return;

  const trimmed = value.trim();
  if (!trimmed) return;
  if (lowerName === 'authorization' || lowerName === 'proxy-authorization') {
    const separator = trimmed.search(/\s/);
    candidates.push(separator === -1 ? trimmed : trimmed.slice(separator).trim());
    return;
  }
  if (lowerName === 'cookie' || lowerName === 'set-cookie') {
    for (const part of trimmed.split(';')) {
      const equals = part.indexOf('=');
      if (equals !== -1) candidates.push(part.slice(equals + 1).trim().replace(/^"|"$/g, ''));
    }
    return;
  }
  candidates.push(trimmed);
}

export function extractCredentialSecrets(headers: HeaderInput, rawUrl?: string): Buffer[] {
  const candidates: string[] = [];
  for (const [name, value] of normalizeHeaders(headers)) {
    addHeaderCredentialCandidates(name, value, candidates);
  }

  if (rawUrl) {
    try {
      const url = new URL(rawUrl, 'http://capture.invalid');
      if (url.username) candidates.push(decodeURIComponent(url.username));
      if (url.password) candidates.push(decodeURIComponent(url.password));
      for (const [name, value] of url.searchParams) {
        if (SENSITIVE_QUERY_KEYS.has(name.toLowerCase())) candidates.push(value);
      }
      for (const part of url.search.slice(1).split('&')) {
        if (!part) continue;
        const equals = part.indexOf('=');
        const rawName = equals === -1 ? part : part.slice(0, equals);
        const rawValue = equals === -1 ? '' : part.slice(equals + 1);
        let decodedName = rawName;
        try {
          decodedName = decodeURIComponent(rawName.replace(/\+/g, ' '));
        } catch {
          // Keep malformed query bytes out of the persisted URL; URL sanitation handles display.
        }
        if (SENSITIVE_QUERY_KEYS.has(decodedName.toLowerCase()) && rawValue) candidates.push(rawValue);
      }
    } catch {
      // URL validation is handled by the capture writer.
    }
  }

  return uniqueCredentialSecrets(candidates);
}

function hasContentEncoding(headers: HeaderInput): boolean {
  return normalizeHeaders(headers).some(([name, value]) => (
    name.toLowerCase() === 'content-encoding'
    && value.split(',').some((encoding) => encoding.trim() && encoding.trim().toLowerCase() !== 'identity')
  ));
}

export function sanitizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Capture URLs must be absolute');
  }

  url.username = '';
  url.password = '';
  const sensitiveNames = [...url.searchParams.keys()].filter((name) =>
    SENSITIVE_QUERY_KEYS.has(name.toLowerCase()),
  );
  for (const name of sensitiveNames) url.searchParams.set(name, REDACTED);
  return url.toString();
}

export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/https?:\/\/[^\s"']+/g, (candidate) => {
      try {
        return sanitizeUrl(candidate);
      } catch {
        return '[INVALID_URL]';
      }
    });
}

function assertCaptureId(id: string): void {
  if (!CAPTURE_ID_PATTERN.test(id)) throw new Error('Invalid capture id');
}

function assertRecording(id: string, order: number): void {
  if (!RECORDING_ID_PATTERN.test(id)) throw new Error('Invalid recording id');
  if (!Number.isSafeInteger(order) || order < 0) throw new Error('Invalid recording order');
}

function assertProtocol(protocol: string): asserts protocol is CaptureProtocol {
  if (!PROTOCOLS.has(protocol as CaptureProtocol)) {
    throw new Error('Unsupported capture protocol');
  }
}

function assertSafeFilename(filename: string): void {
  if (!CAPTURE_FILE_PATTERN.test(filename) || filename.includes('..')) {
    throw new Error('Invalid capture filename');
  }
}

async function ensureSecureDirectory(directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Capture directory must be a real directory');
  }
  await chmod(directory, 0o700);
  return realpath(directory);
}

function captureFilename(createdAt: Date, protocol: CaptureProtocol, id: string): string {
  const timestamp = createdAt
    .toISOString()
    .replace(/-/g, '')
    .replace(/:/g, '')
    .replace('Z', 'Z');
  return `${timestamp}_${protocol}_${id}.llmcap.jsonl`;
}

function jsonLine(record: CaptureRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function byteChunk(value: Uint8Array | string): Buffer {
  return typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
}

function validAtUs(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('atUs must be a non-negative integer');
  return value;
}

class HashState {
  private readonly hash: Hash = createHash('sha256');
  private digestValue?: string;
  bytes = 0;

  update(chunk: Buffer): void {
    if (this.digestValue) throw new Error('Cannot append bytes after stream end');
    this.hash.update(chunk);
    this.bytes += chunk.byteLength;
  }

  end(): { bytes: number; sha256: string } {
    this.digestValue ??= this.hash.digest('hex');
    return { bytes: this.bytes, sha256: this.digestValue };
  }
}

interface RedactedChunk {
  bytes: Buffer;
  redacted: boolean;
}

class ByteSecretRedactor {
  private pending = Buffer.alloc(0);
  private readonly maxSecretBytes: number;

  constructor(private readonly secrets: readonly Buffer[]) {
    this.maxSecretBytes = secrets[0]?.byteLength ?? 0;
  }

  write(chunk: Buffer): RedactedChunk {
    if (this.secrets.length === 0) return { bytes: chunk, redacted: false };
    const combined = this.pending.byteLength === 0
      ? chunk
      : Buffer.concat([this.pending, chunk]);
    const safeStartEnd = Math.max(0, combined.byteLength - this.maxSecretBytes + 1);
    return this.process(combined, safeStartEnd);
  }

  end(): RedactedChunk {
    if (this.secrets.length === 0 || this.pending.byteLength === 0) {
      return { bytes: Buffer.alloc(0), redacted: false };
    }
    return this.process(this.pending, this.pending.byteLength);
  }

  private process(input: Buffer, safeStartEnd: number): RedactedChunk {
    const output: Buffer[] = [];
    let cursor = 0;
    let redacted = false;

    while (cursor < safeStartEnd) {
      let matchAt = -1;
      let matchLength = 0;
      for (const secret of this.secrets) {
        const index = input.indexOf(secret, cursor);
        if (index === -1 || index >= safeStartEnd) continue;
        if (matchAt === -1 || index < matchAt || (index === matchAt && secret.byteLength > matchLength)) {
          matchAt = index;
          matchLength = secret.byteLength;
        }
      }

      if (matchAt === -1) {
        output.push(input.subarray(cursor, safeStartEnd));
        cursor = safeStartEnd;
        break;
      }
      if (matchAt > cursor) output.push(input.subarray(cursor, matchAt));
      output.push(Buffer.from(REDACTED));
      cursor = matchAt + matchLength;
      redacted = true;
    }

    this.pending = Buffer.from(input.subarray(cursor));
    return { bytes: Buffer.concat(output), redacted };
  }
}

interface TimedCaptureChunk<T> {
  bytes: Buffer;
  timing: T;
  preserveBoundary: boolean;
}

interface RedactedChunks<T> {
  chunks: TimedCaptureChunk<T>[];
  redacted: boolean;
}

class BoundaryPreservingSecretRedactor<T> {
  private readonly byteRedactor: ByteSecretRedactor;
  private readonly maxSecretBytes: number;
  private pending: Array<{ bytes: Buffer; timing: T }> = [];
  private pendingBytes = 0;
  private redacting = false;

  constructor(private readonly secrets: readonly Buffer[]) {
    this.byteRedactor = new ByteSecretRedactor(secrets);
    this.maxSecretBytes = secrets[0]?.byteLength ?? 0;
  }

  write(bytes: Buffer, timing: T): RedactedChunks<T> {
    if (this.secrets.length === 0) {
      return { chunks: [{ bytes, timing, preserveBoundary: true }], redacted: false };
    }
    if (this.redacting) return this.writeRedacted(bytes, timing);

    this.pending.push({ bytes, timing });
    this.pendingBytes += bytes.byteLength;
    const combined = Buffer.concat(this.pending.map((chunk) => chunk.bytes), this.pendingBytes);
    if (this.secrets.some((secret) => combined.includes(secret))) {
      this.redacting = true;
      const pending = this.pending;
      this.pending = [];
      this.pendingBytes = 0;
      const chunks: TimedCaptureChunk<T>[] = [];
      for (const chunk of pending) {
        chunks.push(...this.writeRedacted(chunk.bytes, chunk.timing).chunks);
      }
      return { chunks, redacted: true };
    }

    const chunks: TimedCaptureChunk<T>[] = [];
    const requiredLookahead = this.maxSecretBytes - 1;
    while (
      this.pending.length > 0
      && this.pendingBytes - this.pending[0].bytes.byteLength >= requiredLookahead
    ) {
      const chunk = this.pending.shift();
      if (!chunk) break;
      this.pendingBytes -= chunk.bytes.byteLength;
      chunks.push({ ...chunk, preserveBoundary: true });
    }
    return { chunks, redacted: false };
  }

  end(timing: T): RedactedChunks<T> {
    if (this.redacting) {
      const redacted = this.byteRedactor.end();
      return {
        chunks: redacted.bytes.byteLength > 0
          ? [{ bytes: redacted.bytes, timing, preserveBoundary: false }]
          : [],
        redacted: redacted.redacted,
      };
    }

    const chunks = this.pending.map((chunk) => ({ ...chunk, preserveBoundary: true }));
    this.pending = [];
    this.pendingBytes = 0;
    return { chunks, redacted: false };
  }

  private writeRedacted(bytes: Buffer, timing: T): RedactedChunks<T> {
    const redacted = this.byteRedactor.write(bytes);
    return {
      chunks: redacted.bytes.byteLength > 0
        ? [{ bytes: redacted.bytes, timing, preserveBoundary: false }]
        : [],
      redacted: redacted.redacted,
    };
  }
}

export class CaptureWriter {
  readonly id: string;
  readonly partialPath: string;
  readonly finalPath: string;
  readonly filename: string;

  private readonly file: FileHandle;
  private readonly clock: () => bigint;
  private readonly startTimeNs: bigint;
  private writeQueue: Promise<void> = Promise.resolve();
  private requestSeq = 0;
  private responseSeq = 0;
  private readonly requestHash = new HashState();
  private readonly upstreamRequestHash = new HashState();
  private readonly upstreamResponseHash = new HashState();
  private readonly responseHash = new HashState();
  private readonly requestRedactor: BoundaryPreservingSecretRedactor<{ atUs: number }>;
  private readonly responseRedactor: BoundaryPreservingSecretRedactor<{
    atUs: number;
    upstreamObservedAtUs?: number;
  }>;
  private readonly credentialSecrets: readonly Buffer[];
  private suppressRequestBody: boolean;
  private suppressResponseBody: boolean;
  private requestBodyRedacted = false;
  private responseBodyRedacted = false;
  private requestSuppressionWritten = false;
  private responseSuppressionWritten = false;
  private requestBodyFlushed = false;
  private responseBodyFlushed = false;
  private requestEnded = false;
  private upstreamRequestStarted = false;
  private upstreamRequestEnded = false;
  private upstreamResponseStarted = false;
  private upstreamResponseEnded = false;
  private responseStarted = false;
  private responseEnded = false;
  private lastResponseObservedAtUs?: number;
  private finishing = false;
  private closed = false;

  private constructor(
    file: FileHandle,
    filename: string,
    partialPath: string,
    finalPath: string,
    id: string,
    clock: () => bigint,
    startTimeNs: bigint,
    bodyCredentialSecrets: readonly Buffer[],
    credentialSecrets: readonly Buffer[],
    suppressBodies: boolean,
    suppressEncodedRequestBody: boolean,
  ) {
    this.file = file;
    this.filename = filename;
    this.partialPath = partialPath;
    this.finalPath = finalPath;
    this.id = id;
    this.clock = clock;
    this.startTimeNs = startTimeNs;
    this.requestRedactor = new BoundaryPreservingSecretRedactor(bodyCredentialSecrets);
    this.responseRedactor = new BoundaryPreservingSecretRedactor(bodyCredentialSecrets);
    this.credentialSecrets = credentialSecrets;
    this.suppressRequestBody = suppressBodies || suppressEncodedRequestBody;
    this.suppressResponseBody = suppressBodies;
    this.requestBodyRedacted = this.suppressRequestBody;
    this.responseBodyRedacted = this.suppressResponseBody;
  }

  static async create(options: CaptureWriterOptions): Promise<CaptureWriter> {
    const clock = options.clock ?? process.hrtime.bigint;
    const startTimeNs = options.startTimeNs ?? clock();
    const createdAt = options.createdAt ?? new Date();
    const id = options.id ?? `cap_${randomUUID().replace(/-/g, '')}`;
    assertCaptureId(id);
    assertProtocol(options.protocol);
    if (options.recording) assertRecording(options.recording.id, options.recording.order);
    const downstreamUrl = sanitizeUrl(options.downstreamUrl);
    const upstreamUrl = sanitizeUrl(options.upstreamUrl);
    const requestUrl = options.request.url ? sanitizeUrl(options.request.url) : undefined;
    const credentialPolicy = prepareCredentialSecrets(options.credentialSecrets ?? []);
    const credentialSecrets = uniqueCredentialSecrets(options.credentialSecrets ?? []);

    const directory = await ensureSecureDirectory(options.directory);
    const filename = captureFilename(createdAt, options.protocol, id);
    const finalPath = join(directory, filename);
    const partialPath = `${finalPath}.partial`;
    await Promise.all([
      access(finalPath).then(
        () => Promise.reject(new Error('Capture already exists')),
        () => undefined,
      ),
      access(partialPath).then(
        () => Promise.reject(new Error('Capture already exists')),
        () => undefined,
      ),
    ]);

    const file = await open(
      partialPath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const writer = new CaptureWriter(
      file,
      filename,
      partialPath,
      finalPath,
      id,
      clock,
      startTimeNs,
      credentialPolicy.secrets,
      credentialSecrets,
      credentialPolicy.suppressBodies,
      credentialSecrets.length > 0 && hasContentEncoding(options.request.headers),
    );

    const header: CaptureHeaderRecord = {
      kind: 'capture',
      schema: CAPTURE_SCHEMA,
      schemaVersion: CAPTURE_SCHEMA_VERSION,
      id,
      createdAt: createdAt.toISOString(),
      protocol: options.protocol,
      source: 'record',
      downstreamUrl,
      upstreamUrl,
      ...(options.recording ? {
        recordingId: options.recording.id,
        recordingOrder: options.recording.order,
      } : {}),
      redactions: [
        'request.headers',
        'upstream.request.headers',
        'response.headers',
        'url.query',
        ...(
          credentialPolicy.secrets.length > 0 || credentialPolicy.suppressBodies
            ? ['request.body.credentials', 'response.body.credentials']
            : []
        ),
      ],
    };

    try {
      await writer.append(header);
      await writer.recordRequestHead({ ...options.request, url: requestUrl }, 0);
      return writer;
    } catch (error) {
      await file.close().catch(() => undefined);
      throw error;
    }
  }

  elapsedUs(): number {
    return validAtUs(Number((this.clock() - this.startTimeNs) / 1_000n));
  }

  private assertWritable(): void {
    if (this.closed || this.finishing) throw new Error('Capture writer is closed');
  }

  private append(record: CaptureRecord): Promise<void> {
    const line = jsonLine(record);
    const next = this.writeQueue.then(async () => {
      await this.file.writeFile(line, 'utf8');
    });
    this.writeQueue = next;
    return next;
  }

  private at(atUs?: number): number {
    return validAtUs(atUs ?? this.elapsedUs());
  }

  private sanitizeKnownSecrets(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    let sanitized = value;
    for (const secret of this.credentialSecrets) {
      const text = secret.toString('utf8');
      if (text) sanitized = sanitized.replaceAll(text, REDACTED);
    }
    return sanitized;
  }

  private sanitizeCapturedHeaders(headers: HeaderInput): HeaderPair[] {
    return sanitizeHeaders(headers).map(([name, value]) => [
      name,
      this.sanitizeKnownSecrets(value) ?? value,
    ]);
  }

  private async appendRequestBodyChunk(
    chunk: Buffer,
    atUs: number,
    preserveBoundary = false,
  ): Promise<void> {
    if (chunk.byteLength === 0 && !preserveBoundary) return;
    const offset = this.requestHash.bytes;
    this.requestHash.update(chunk);
    await this.append({
      kind: 'request.body_chunk',
      seq: this.requestSeq++,
      atUs,
      byteOffset: offset,
      bytesBase64: chunk.toString('base64'),
    });
  }

  private async appendResponseBodyChunk(
    chunk: Buffer,
    atUs: number,
    upstreamObservedAtUs?: number,
    preserveBoundary = false,
  ): Promise<void> {
    if (chunk.byteLength === 0 && !preserveBoundary) return;
    const offset = this.responseHash.bytes;
    this.responseHash.update(chunk);
    await this.append({
      kind: 'response.body_chunk',
      seq: this.responseSeq++,
      atUs,
      upstreamObservedAtUs,
      byteOffset: offset,
      bytesBase64: chunk.toString('base64'),
    });
  }

  async recordRequestHead(head: CaptureRequestHead, atUs?: number): Promise<void> {
    this.assertWritable();
    await this.append({
      kind: 'request.head',
      atUs: this.at(atUs),
      method: head.method,
      url: head.url ? sanitizeUrl(head.url) : undefined,
      httpVersion: head.httpVersion,
      rawHeaders: this.sanitizeCapturedHeaders(head.headers),
    });
  }

  async recordRequestChunk(
    value: Uint8Array | string,
    options: { atUs?: number; forwarded?: boolean } = {},
  ): Promise<void> {
    this.assertWritable();
    if (this.requestEnded) throw new Error('Request body already ended');
    const chunk = byteChunk(value);
    if (options.forwarded !== false) this.upstreamRequestHash.update(chunk);
    if (this.suppressRequestBody) {
      if (chunk.byteLength > 0 && !this.requestSuppressionWritten) {
        this.requestSuppressionWritten = true;
        await this.appendRequestBodyChunk(Buffer.from(REDACTED), this.at(options.atUs));
      }
      return;
    }
    const redacted = this.requestRedactor.write(chunk, { atUs: this.at(options.atUs) });
    this.requestBodyRedacted ||= redacted.redacted;
    for (const captured of redacted.chunks) {
      await this.appendRequestBodyChunk(
        captured.bytes,
        captured.timing.atUs,
        captured.preserveBoundary,
      );
    }
  }

  async flushRequestBody(atUs?: number): Promise<void> {
    this.assertWritable();
    if (this.requestBodyFlushed) return;
    this.requestBodyFlushed = true;
    if (this.suppressRequestBody) return;
    const redacted = this.requestRedactor.end({ atUs: this.at(atUs) });
    this.requestBodyRedacted ||= redacted.redacted;
    for (const captured of redacted.chunks) {
      await this.appendRequestBodyChunk(
        captured.bytes,
        captured.timing.atUs,
        captured.preserveBoundary,
      );
    }
  }

  observeForwardedRequestChunk(value: Uint8Array | string): void {
    this.assertWritable();
    this.upstreamRequestHash.update(byteChunk(value));
  }

  async endRequest(options: { atUs?: number; complete?: boolean } = {}): Promise<void> {
    this.assertWritable();
    if (this.requestEnded) return;
    this.requestEnded = true;
    const atUs = this.at(options.atUs);
    await this.flushRequestBody(atUs);
    await this.append({
      kind: 'request.end',
      atUs,
      ...this.requestHash.end(),
      complete: options.complete ?? true,
    });
  }

  async recordUpstreamRequestHead(
    head: { method: string; url: string; httpVersion?: string; headers: HeaderInput },
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    this.upstreamRequestStarted = true;
    await this.append({
      kind: 'upstream.request.head',
      atUs: this.at(atUs),
      method: head.method,
      url: sanitizeUrl(head.url),
      httpVersion: head.httpVersion ?? '1.1',
      rawHeaders: this.sanitizeCapturedHeaders(head.headers),
    });
  }

  async endUpstreamRequest(options: { atUs?: number; complete?: boolean } = {}): Promise<void> {
    this.assertWritable();
    if (!this.upstreamRequestStarted || this.upstreamRequestEnded) return;
    this.upstreamRequestEnded = true;
    await this.append({
      kind: 'upstream.request.end',
      atUs: this.at(options.atUs),
      ...this.upstreamRequestHash.end(),
      complete: options.complete ?? true,
    });
  }

  async recordUpstreamResponseHead(
    head: {
      status: number;
      statusText?: string;
      httpVersion?: string;
      headers: HeaderInput;
    },
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    this.upstreamResponseStarted = true;
    if (this.credentialSecrets.length > 0 && hasContentEncoding(head.headers)) {
      this.suppressResponseBody = true;
      this.responseBodyRedacted = true;
    }
    await this.append({
      kind: 'upstream.response.head',
      atUs: this.at(atUs),
      status: head.status,
      statusText: this.sanitizeKnownSecrets(head.statusText),
      httpVersion: head.httpVersion ?? '1.1',
      rawHeaders: this.sanitizeCapturedHeaders(head.headers),
    });
  }

  async recordResponseHead(
    head: {
      status: number;
      statusText?: string;
      httpVersion?: string;
      headers: HeaderInput;
      source?: 'upstream' | 'gateway';
    },
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    this.responseStarted = true;
    if (this.credentialSecrets.length > 0 && hasContentEncoding(head.headers)) {
      this.suppressResponseBody = true;
      this.responseBodyRedacted = true;
    }
    await this.append({
      kind: 'response.head',
      atUs: this.at(atUs),
      status: head.status,
      statusText: this.sanitizeKnownSecrets(head.statusText),
      httpVersion: head.httpVersion ?? '1.1',
      rawHeaders: this.sanitizeCapturedHeaders(head.headers),
      source: head.source ?? 'upstream',
    });
  }

  async recordResponseChunk(
    value: Uint8Array | string,
    options: { atUs?: number; upstreamObservedAtUs?: number } = {},
  ): Promise<void> {
    this.assertWritable();
    if (!this.responseStarted || this.responseEnded) {
      throw new Error('Response head must be recorded before body chunks');
    }
    const chunk = byteChunk(value);
    this.upstreamResponseHash.update(chunk);
    const atUs = this.at(options.atUs);
    const upstreamObservedAtUs = options.upstreamObservedAtUs === undefined
      ? undefined
      : validAtUs(options.upstreamObservedAtUs);
    this.lastResponseObservedAtUs = upstreamObservedAtUs;
    if (this.suppressResponseBody) {
      if (chunk.byteLength > 0 && !this.responseSuppressionWritten) {
        this.responseSuppressionWritten = true;
        await this.appendResponseBodyChunk(Buffer.from(REDACTED), atUs, upstreamObservedAtUs);
      }
      return;
    }
    const redacted = this.responseRedactor.write(chunk, { atUs, upstreamObservedAtUs });
    this.responseBodyRedacted ||= redacted.redacted;
    for (const captured of redacted.chunks) {
      await this.appendResponseBodyChunk(
        captured.bytes,
        captured.timing.atUs,
        captured.timing.upstreamObservedAtUs,
        captured.preserveBoundary,
      );
    }
  }

  async flushResponseBody(atUs?: number): Promise<void> {
    this.assertWritable();
    if (this.responseBodyFlushed) return;
    this.responseBodyFlushed = true;
    if (this.suppressResponseBody) return;
    const redacted = this.responseRedactor.end({
      atUs: this.at(atUs),
      upstreamObservedAtUs: this.lastResponseObservedAtUs,
    });
    this.responseBodyRedacted ||= redacted.redacted;
    for (const captured of redacted.chunks) {
      await this.appendResponseBodyChunk(
        captured.bytes,
        captured.timing.atUs,
        captured.timing.upstreamObservedAtUs,
        captured.preserveBoundary,
      );
    }
  }

  async recordTrailers(
    scope: 'request' | 'upstream.request' | 'upstream.response' | 'response',
    headers: HeaderInput,
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    await this.append({
      kind: `${scope}.trailers` as TrailersRecord['kind'],
      atUs: this.at(atUs),
      rawHeaders: this.sanitizeCapturedHeaders(headers),
    });
  }

  async endUpstreamResponse(options: { atUs?: number; complete?: boolean } = {}): Promise<void> {
    this.assertWritable();
    if (!this.upstreamResponseStarted || this.upstreamResponseEnded) return;
    this.upstreamResponseEnded = true;
    await this.append({
      kind: 'upstream.response.end',
      atUs: this.at(options.atUs),
      ...this.upstreamResponseHash.end(),
      complete: options.complete ?? true,
    });
  }

  async endResponse(
    options: {
      atUs?: number;
      complete?: boolean;
      eofObserved?: boolean;
      terminalMarker?: { kind: string; observed: boolean };
    } = {},
  ): Promise<void> {
    this.assertWritable();
    if (!this.responseStarted || this.responseEnded) return;
    this.responseEnded = true;
    const atUs = this.at(options.atUs);
    await this.flushResponseBody(atUs);
    await this.append({
      kind: 'response.end',
      atUs,
      ...this.responseHash.end(),
      complete: options.complete ?? true,
      eofObserved: options.eofObserved ?? true,
      terminalMarker: options.terminalMarker,
    });
  }

  async recordNetwork(
    event: UpstreamNetworkRecord['event'],
    details: Omit<UpstreamNetworkRecord, 'kind' | 'event' | 'atUs'> = {},
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    await this.append({ kind: 'upstream.network', event, atUs: this.at(atUs), ...details });
  }

  async recordFailure(
    scope: FailureRecord['scope'],
    error: Error | { type: string; message: string },
    atUs?: number,
  ): Promise<void> {
    this.assertWritable();
    await this.append({
      kind: 'failure',
      scope,
      type: error instanceof Error ? error.name : error.type,
      message: this.sanitizeKnownSecrets(sanitizeErrorMessage(error.message)) ?? REDACTED,
      atUs: this.at(atUs),
    });
  }

  async recordClientDisconnect(atUs?: number): Promise<void> {
    this.assertWritable();
    await this.append({ kind: 'client.disconnect', atUs: this.at(atUs) });
  }

  async finish(options: FinishCaptureOptions): Promise<string> {
    this.assertWritable();
    if (!this.requestEnded) await this.endRequest({ complete: options.outcome === 'complete' });
    if (this.upstreamRequestStarted && !this.upstreamRequestEnded) {
      await this.endUpstreamRequest({ complete: options.outcome === 'complete' });
    }
    if (this.upstreamResponseStarted && !this.upstreamResponseEnded) {
      await this.endUpstreamResponse({ complete: options.outcome === 'complete' });
    }
    if (this.responseStarted && !this.responseEnded) {
      await this.endResponse({ complete: options.outcome === 'complete' });
    }
    if (options.outcome === 'complete' && (!this.responseStarted || !this.responseEnded)) {
      throw new Error('A complete capture requires a complete response');
    }

    this.finishing = true;
    const response = this.responseHash.end();
    await this.append({
      kind: 'capture.end',
      atUs: this.elapsedUs(),
      outcome: options.outcome,
      requestBodyExact: (options.requestBodyExact ?? true) && !this.requestBodyRedacted,
      requestHeadersSanitized: true,
      responseBodyExact: (options.responseBodyExact ?? true) && !this.responseBodyRedacted,
      timingReplayable: options.timingReplayable ?? true,
      downstreamBytesWritten: options.downstreamBytesWritten ?? response.bytes,
    });

    try {
      await this.writeQueue;
      await this.file.sync();
      await this.file.close();
      await rename(this.partialPath, this.finalPath);
      this.closed = true;
      return this.finalPath;
    } catch (error) {
      this.closed = true;
      await this.file.close().catch(() => undefined);
      throw error;
    }
  }

  async abandon(): Promise<void> {
    if (this.closed) return;
    this.finishing = true;
    await this.writeQueue.catch(() => undefined);
    await this.file.close().catch(() => undefined);
    this.closed = true;
  }
}

function isCaptureHeader(record: CaptureRecord): record is CaptureHeaderRecord {
  return record.kind === 'capture';
}

function isBodyChunk(record: CaptureRecord, kind: BodyChunkRecord['kind']): record is BodyChunkRecord {
  return record.kind === kind;
}

function isEndRecord(record: CaptureRecord, kind: EndRecord['kind']): record is EndRecord {
  return record.kind === kind;
}

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Capture contains invalid base64 data');
  }
  return Buffer.from(value, 'base64');
}

function decodedBase64Length(value: unknown): number {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Capture contains invalid base64 data');
  }
  if (!value) return 0;
  return value.length * 3 / 4 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0);
}

export function parseCaptureRequestMetadata(body: Uint8Array): CaptureRequestMetadata | undefined {
  if (body.byteLength > MAX_CAPTURE_REQUEST_METADATA_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(Buffer.from(body).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') return undefined;
    const request = value as { stream?: unknown; stream_options?: unknown };
    const streamOptions = request.stream_options && !Array.isArray(request.stream_options)
      && typeof request.stream_options === 'object'
      ? request.stream_options as { include_usage?: unknown }
      : undefined;
    return {
      stream: request.stream === true,
      includeUsage: streamOptions?.include_usage === true,
    };
  } catch {
    return undefined;
  }
}

function requestMetadataFromRecords(records: CaptureRecord[]): CaptureRequestMetadata | undefined {
  const chunks = records.filter((record): record is BodyChunkRecord => record.kind === 'request.body_chunk');
  let bytes = 0;
  for (const chunk of chunks) {
    bytes += decodedBase64Length(chunk.bytesBase64);
    if (bytes > MAX_CAPTURE_REQUEST_METADATA_BYTES) return undefined;
  }
  return parseCaptureRequestMetadata(Buffer.concat(chunks.map((chunk) => decodeBase64(chunk.bytesBase64)), bytes));
}

function parseRecord(value: unknown): CaptureRecord {
  if (!value || typeof value !== 'object' || typeof (value as { kind?: unknown }).kind !== 'string') {
    throw new Error('Capture record must be an object with a kind');
  }
  return value as CaptureRecord;
}

function validateCaptureHeader(record: CaptureRecord | undefined): CaptureHeaderRecord {
  if (!record || !isCaptureHeader(record)) throw new Error('Capture header is missing');
  if (record.schema !== CAPTURE_SCHEMA || record.schemaVersion !== CAPTURE_SCHEMA_VERSION) {
    throw new Error('Unsupported capture schema');
  }
  assertCaptureId(record.id);
  assertProtocol(record.protocol);
  if (typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt))) {
    throw new Error('Capture createdAt is invalid');
  }
  if (typeof record.downstreamUrl !== 'string' || typeof record.upstreamUrl !== 'string') {
    throw new Error('Capture URLs are invalid');
  }
  if (record.recordingId !== undefined || record.recordingOrder !== undefined) {
    if (typeof record.recordingId !== 'string' || typeof record.recordingOrder !== 'number') {
      throw new Error('Capture recording metadata is incomplete');
    }
    assertRecording(record.recordingId, record.recordingOrder);
  }
  return record;
}

function integrityFor(
  records: CaptureRecord[],
  chunkKind: BodyChunkRecord['kind'],
  endKind: EndRecord['kind'],
): 'valid' | 'invalid' | 'unavailable' {
  const chunks = records.filter((record) => isBodyChunk(record, chunkKind));
  const end = records.find((record) => isEndRecord(record, endKind));
  if (!end) return 'unavailable';

  const hash = createHash('sha256');
  let bytes = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (
      chunk.seq !== index ||
      chunk.byteOffset !== bytes ||
      !Number.isSafeInteger(chunk.atUs) ||
      chunk.atUs < 0
    ) {
      return 'invalid';
    }
    const decoded = decodeBase64(chunk.bytesBase64);
    hash.update(decoded);
    bytes += decoded.byteLength;
  }
  return bytes === end.bytes && hash.digest('hex') === end.sha256 ? 'valid' : 'invalid';
}

async function* captureLines(file: FileHandle): AsyncGenerator<string> {
  const pending: Buffer[] = [];
  let pendingBytes = 0;

  const add = (segment: Buffer): void => {
    pendingBytes += segment.byteLength;
    if (pendingBytes > MAX_CAPTURE_LINE_BYTES) {
      throw new Error(`Capture JSONL line exceeds ${MAX_CAPTURE_LINE_BYTES} bytes`);
    }
    if (segment.byteLength > 0) pending.push(segment);
  };

  for await (const value of file.createReadStream({ autoClose: false })) {
    const chunk = Buffer.from(value as Uint8Array);
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf(0x0a, start);
      if (newline === -1) {
        add(chunk.subarray(start));
        break;
      }
      add(chunk.subarray(start, newline));
      let line = pending.length === 1
        ? pending[0]
        : Buffer.concat(pending, pendingBytes);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      yield line.toString('utf8');
      pending.length = 0;
      pendingBytes = 0;
      start = newline + 1;
    }
  }

  if (pendingBytes > 0) {
    let line = pending.length === 1
      ? pending[0]
      : Buffer.concat(pending, pendingBytes);
    if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
    yield line.toString('utf8');
  }
}

async function parseCaptureFile(
  path: string,
  filename: string,
  partial: boolean,
): Promise<CaptureDetail> {
  const file = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  const records: CaptureRecord[] = [];
  let parseWarning: string | undefined;
  try {
    for await (const line of captureLines(file)) {
      if (!line.trim()) continue;
      try {
        records.push(parseRecord(JSON.parse(line)));
      } catch (error) {
        if (!partial) throw error;
        parseWarning = 'Partial capture ends with an incomplete JSONL record';
        break;
      }
    }
  } finally {
    await file.close();
  }

  const header = validateCaptureHeader(records[0]);

  const captureEnd = records.find((record): record is CaptureEndRecord => record.kind === 'capture.end');
  if (!partial && !captureEnd) throw new Error('Complete capture is missing capture.end');
  const responseHead = records.find(
    (record): record is HeadRecord => record.kind === 'response.head',
  );
  const responseEnd = records.find(
    (record): record is EndRecord => record.kind === 'response.end',
  );
  const responseChunks = records.filter(
    (record): record is BodyChunkRecord => record.kind === 'response.body_chunk',
  );

  return {
    filename,
    partial,
    header,
    records,
    responseHead,
    responseChunks,
    responseEnd,
    captureEnd,
    requestMetadata: requestMetadataFromRecords(records),
    integrity: {
      request: integrityFor(records, 'request.body_chunk', 'request.end'),
      upstreamRequest: 'unavailable',
      response: integrityFor(records, 'response.body_chunk', 'response.end'),
    },
    parseWarning,
  };
}

async function scanCaptureSummary(
  filePath: string,
  filename: string,
  partial: boolean,
  metadata: { size: number; modifiedAt: string },
): Promise<CaptureSummary> {
  const file = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let header: CaptureHeaderRecord | undefined;
  let requestHead: HeadRecord | undefined;
  let responseHead: HeadRecord | undefined;
  let requestEnd: EndRecord | undefined;
  let responseEnd: EndRecord | undefined;
  let captureEnd: CaptureEndRecord | undefined;
  let requestChunkBytes = 0;
  let responseChunkBytes = 0;
  const requestHash = createHash('sha256');
  const responseHash = createHash('sha256');
  let requestSeq = 0;
  let responseSeq = 0;
  let requestMetadataTooLarge = false;
  const requestMetadataChunks: Buffer[] = [];
  let parseWarning: string | undefined;
  let structuralError: string | undefined;

  try {
    for await (const line of captureLines(file)) {
      if (!line.trim()) continue;
      let record: CaptureRecord;
      try {
        record = parseRecord(JSON.parse(line));
      } catch (error) {
        if (!partial) throw error;
        parseWarning = 'Partial capture ends with an incomplete JSONL record';
        break;
      }
      if (!header) header = validateCaptureHeader(record);

      if (record.kind === 'request.head') requestHead = record;
      else if (record.kind === 'response.head') responseHead = record;
      else if (record.kind === 'request.body_chunk') {
        const decoded = decodeBase64(record.bytesBase64);
        const length = decoded.byteLength;
        requestHash.update(decoded);
        if (record.seq !== requestSeq++ || record.byteOffset !== requestChunkBytes
          || !Number.isSafeInteger(record.atUs) || record.atUs < 0) {
          structuralError ??= 'Capture request chunks are invalid';
          requestSeq = Number.isInteger(record.seq) ? record.seq + 1 : requestSeq;
          requestChunkBytes = Number.isSafeInteger(record.byteOffset) && record.byteOffset >= 0
            ? record.byteOffset
            : requestChunkBytes;
          requestMetadataTooLarge = true;
          requestMetadataChunks.length = 0;
        }
        requestChunkBytes += length;
        if (!requestMetadataTooLarge && requestChunkBytes <= MAX_CAPTURE_REQUEST_METADATA_BYTES) {
          requestMetadataChunks.push(decoded);
        } else {
          requestMetadataTooLarge = true;
          requestMetadataChunks.length = 0;
        }
      } else if (record.kind === 'response.body_chunk') {
        const decoded = decodeBase64(record.bytesBase64);
        const length = decoded.byteLength;
        responseHash.update(decoded);
        if (record.seq !== responseSeq++ || record.byteOffset !== responseChunkBytes
          || !Number.isSafeInteger(record.atUs) || record.atUs < 0) {
          structuralError ??= 'Capture response chunks are invalid';
          responseSeq = Number.isInteger(record.seq) ? record.seq + 1 : responseSeq;
          responseChunkBytes = Number.isSafeInteger(record.byteOffset) && record.byteOffset >= 0
            ? record.byteOffset
            : responseChunkBytes;
        }
        responseChunkBytes += length;
      } else if (record.kind === 'request.end') requestEnd = record;
      else if (record.kind === 'response.end') responseEnd = record;
      else if (record.kind === 'capture.end') captureEnd = record;
    }
  } finally {
    await file.close();
  }

  header = validateCaptureHeader(header);
  if (!partial && !captureEnd) throw new Error('Complete capture is missing capture.end');
  if (!partial && (!requestEnd || !responseEnd)) structuralError ??= 'Complete capture is missing a body end record';
  if (requestEnd && requestEnd.bytes !== requestChunkBytes) structuralError ??= 'Capture request byte count is invalid';
  if (responseEnd && responseEnd.bytes !== responseChunkBytes) structuralError ??= 'Capture response byte count is invalid';
  const requestDigest = requestHash.digest('hex');
  const responseDigest = responseHash.digest('hex');
  if (requestEnd && requestEnd.sha256 !== requestDigest) structuralError ??= 'Capture request hash is invalid';
  if (responseEnd && responseEnd.sha256 !== responseDigest) structuralError ??= 'Capture response hash is invalid';
  const requestMetadata = requestMetadataTooLarge
    ? undefined
    : parseCaptureRequestMetadata(Buffer.concat(requestMetadataChunks, requestChunkBytes));
  const responseContentType = responseHead?.rawHeaders.find(
    ([name]) => name.toLowerCase() === 'content-type',
  )?.[1];

  return {
    id: header.id,
    filename,
    partial,
    protocol: header.protocol,
    recordingId: header.recordingId,
    recordingOrder: header.recordingOrder,
    createdAt: header.createdAt,
    outcome: captureEnd?.outcome,
    durationUs: captureEnd?.atUs ?? responseEnd?.atUs,
    method: requestHead?.method,
    downstreamUrl: header.downstreamUrl,
    upstreamUrl: header.upstreamUrl,
    status: responseHead?.status,
    ttfbUs: responseHead?.atUs,
    requestBytes: requestEnd?.bytes ?? requestChunkBytes,
    responseBytes: responseEnd?.bytes ?? responseChunkBytes,
    bodyExact: captureEnd?.responseBodyExact ?? false,
    timingReplayable: captureEnd?.timingReplayable ?? false,
    stream: requestMetadata?.stream ?? responseContentType?.toLowerCase().includes('text/event-stream'),
    includeUsage: requestMetadata?.includeUsage,
    ...metadata,
    valid: structuralError === undefined,
    error: structuralError ?? parseWarning,
  };
}

async function fileMetadata(path: string): Promise<{ size: number; modifiedAt: string }> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Capture path is not a regular file');
  return { size: stat.size, modifiedAt: stat.mtime.toISOString() };
}

export class CaptureStore {
  private directory?: string;

  constructor(private readonly configuredDirectory: string) {}

  async init(): Promise<string> {
    this.directory = await ensureSecureDirectory(this.configuredDirectory);
    return this.directory;
  }

  private async root(): Promise<string> {
    const directory = this.directory ?? (await this.init());
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('Capture directory is no longer safe');
    }
    return directory;
  }

  async list(options: { includePartial?: boolean } = {}): Promise<CaptureSummary[]> {
    const directory = await this.root();
    const entries = await readdir(directory, { withFileTypes: true });
    const filenames = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          CAPTURE_FILE_PATTERN.test(entry.name) &&
          (options.includePartial || !entry.name.endsWith('.partial')),
      )
      .map((entry) => entry.name)
      .sort()
      .reverse();

    // ponytail: one sequential streaming pass is cheaper than an index until directory scans become measurable.
    const captures: CaptureSummary[] = [];
    for (const filename of filenames) {
      const filePath = join(directory, filename);
      const partial = filename.endsWith('.partial');
      let metadata: Awaited<ReturnType<typeof fileMetadata>> | undefined;
      try {
        metadata = await fileMetadata(filePath);
        captures.push(await scanCaptureSummary(filePath, filename, partial, metadata));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        metadata ??= await fileMetadata(filePath);
        captures.push({
          id: filename,
          filename,
          partial,
          ...metadata,
          valid: false,
          error: sanitizeErrorMessage(error instanceof Error ? error.message : 'Invalid capture'),
        });
      }
    }
    return captures;
  }

  private async resolve(identifier: string): Promise<{ path: string; filename: string; partial: boolean }> {
    const directory = await this.root();
    if (CAPTURE_FILE_PATTERN.test(identifier) && !identifier.includes('..')) {
      const path = join(directory, identifier);
      await fileMetadata(path);
      return { path, filename: identifier, partial: identifier.endsWith('.partial') };
    }

    assertCaptureId(identifier);
    const matches = (await this.list({ includePartial: true })).filter(
      (capture) => capture.id === identifier,
    );
    if (matches.length === 0) throw new Error('Capture not found');
    if (matches.length > 1) throw new Error('Duplicate capture id');
    const filename = matches[0].filename;
    assertSafeFilename(filename);
    const path = join(directory, filename);
    await fileMetadata(path);
    return { path, filename, partial: filename.endsWith('.partial') };
  }

  async read(identifier: string): Promise<CaptureDetail> {
    const resolved = await this.resolve(identifier);
    return parseCaptureFile(resolved.path, resolved.filename, resolved.partial);
  }

  async listRecording(recordingId: string, options: { includePartial?: boolean } = {}): Promise<CaptureSummary[]> {
    const captures = await this.list(options);
    return captures
      .filter((capture) => capture.recordingId === recordingId
        || (capture.recordingId === undefined && capture.id === recordingId))
      .sort((left, right) => (left.recordingOrder ?? 0) - (right.recordingOrder ?? 0)
        || String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  async delete(identifier: string): Promise<void> {
    const resolved = await this.resolve(identifier);
    await unlink(resolved.path);
  }
}

export async function createCaptureWriter(options: CaptureWriterOptions): Promise<CaptureWriter> {
  return CaptureWriter.create(options);
}

export async function listCaptures(
  directory: string,
  options?: { includePartial?: boolean },
): Promise<CaptureSummary[]> {
  return new CaptureStore(directory).list(options);
}

export async function readCapture(directory: string, identifier: string): Promise<CaptureDetail> {
  return new CaptureStore(directory).read(identifier);
}

export async function deleteCapture(directory: string, identifier: string): Promise<void> {
  return new CaptureStore(directory).delete(identifier);
}

export interface ReplayOptions {
  speed?: 'instant' | number;
  signal?: AbortSignal;
  targetProtocol?: CaptureProtocol;
  allowIncomplete?: boolean;
  startTimeNs?: bigint;
}

export interface CaptureExactReplayEligibility {
  eligible: boolean;
  reason?: string;
}

export interface CaptureExactReplayEligibilityOptions {
  targetProtocol?: CaptureProtocol;
  allowIncompleteOutcome?: boolean;
}

export type ReplayEvent =
  | {
      type: 'head';
      atUs: number;
      status: number;
      statusText?: string;
      headers: HeaderPair[];
    }
  | { type: 'chunk'; atUs: number; seq: number; bytes: Buffer }
  | { type: 'trailers'; atUs: number; headers: HeaderPair[] }
  | { type: 'end'; atUs: number; complete: boolean; outcome: CaptureOutcome };

function replaySpeed(speed: ReplayOptions['speed']): number | 'instant' {
  if (speed === undefined || speed === 'instant') return 'instant';
  if (!Number.isFinite(speed) || speed < 0.1 || speed > 10) {
    throw new Error('Replay speed must be between 0.1 and 10');
  }
  return speed;
}

function abortError(): Error {
  const error = new Error('Replay aborted');
  error.name = 'AbortError';
  return error;
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      signal?.removeEventListener('abort', aborted);
      resolve();
    }
    function aborted(): void {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', aborted, { once: true });
  });
}

async function waitUntil(
  originNs: bigint,
  atUs: number,
  speed: number | 'instant',
  signal?: AbortSignal,
): Promise<void> {
  if (speed === 'instant') {
    if (signal?.aborted) throw abortError();
    return;
  }
  const scaledUs = Math.round(atUs / speed);
  const targetNs = originNs + BigInt(scaledUs) * 1_000n;
  while (true) {
    if (signal?.aborted) throw abortError();
    const remainingNs = targetNs - process.hrtime.bigint();
    if (remainingNs <= 0n) return;
    await delay(Math.max(1, Math.ceil(Number(remainingNs) / 1_000_000)), signal);
  }
}

const TERMINAL_MARKER_KINDS: Record<CaptureProtocol, string> = {
  'openai-chat': 'openai-chat-done',
  'openai-responses': 'openai-response-terminal',
  'anthropic-messages': 'anthropic-stream-terminal',
};

function responseIsEventStream(capture: CaptureDetail): boolean {
  return capture.responseHead?.rawHeaders.some(([name, value]) => (
    name.toLowerCase() === 'content-type'
    && value.split(';', 1)[0].trim().toLowerCase() === 'text/event-stream'
  )) === true;
}

function responseStructureError(capture: CaptureDetail): string | undefined {
  const records = capture.records.filter((record) => (
    record.kind === 'response.head'
    || record.kind === 'response.body_chunk'
    || record.kind === 'response.trailers'
    || record.kind === 'response.end'
  ));
  let phase: 'before-head' | 'body' | 'trailers' | 'ended' = 'before-head';
  let previousAtUs = -1;
  let heads = 0;
  let ends = 0;

  for (const record of records) {
    if (!('atUs' in record)) return 'Capture response record is missing a timestamp';
    if (!Number.isSafeInteger(record.atUs) || record.atUs < previousAtUs) {
      return 'Capture response records do not have monotonic timestamps';
    }
    previousAtUs = record.atUs;
    if (record.kind === 'response.head') {
      heads += 1;
      if (phase !== 'before-head' || !Number.isInteger(record.status)
        || record.status! < 100 || record.status! > 999) {
        return 'Capture response head is invalid or out of order';
      }
      try {
        normalizeHeaders(record.rawHeaders);
      } catch {
        return 'Capture response headers are invalid';
      }
      phase = 'body';
    } else if (record.kind === 'response.body_chunk') {
      if (phase !== 'body') return 'Capture response body chunks are out of order';
    } else if (record.kind === 'response.trailers') {
      if (phase === 'before-head' || phase === 'ended') return 'Capture response trailers are out of order';
      phase = 'trailers';
    } else {
      ends += 1;
      if (phase === 'before-head' || phase === 'ended') return 'Capture response end is out of order';
      phase = 'ended';
    }
  }
  if (heads !== 1 || ends !== 1 || phase !== 'ended') {
    return 'Capture must contain exactly one ordered response head and end';
  }
  if (capture.captureEnd && capture.responseEnd
    && capture.captureEnd.atUs < capture.responseEnd.atUs) {
    return 'Capture end occurs before the response end';
  }
  return undefined;
}

export function captureExactReplayEligibility(
  capture: CaptureDetail,
  options: CaptureExactReplayEligibilityOptions = {},
): CaptureExactReplayEligibility {
  const fail = (reason: string): CaptureExactReplayEligibility => ({ eligible: false, reason });
  if (options.targetProtocol && options.targetProtocol !== capture.header.protocol) {
    return fail('Raw capture replay requires the same protocol');
  }
  if (capture.partial || !capture.responseHead || !capture.responseEnd || !capture.captureEnd) {
    return fail('Capture does not contain a complete response');
  }
  const structuralError = responseStructureError(capture);
  if (structuralError) return fail(structuralError);
  if (capture.responseEnd.complete !== true) {
    return fail('Capture is not complete: response.end.complete is not true');
  }
  if (capture.responseEnd.eofObserved !== true) {
    return fail('Capture is not complete: response.end.eofObserved is not true');
  }
  if (responseIsEventStream(capture)) {
    const expectedKind = TERMINAL_MARKER_KINDS[capture.header.protocol];
    if (capture.responseEnd.terminalMarker?.kind !== expectedKind
      || capture.responseEnd.terminalMarker.observed !== true) {
      return fail(`Capture is not complete: SSE terminal marker ${expectedKind} was not observed`);
    }
  }
  if (!options.allowIncompleteOutcome && capture.captureEnd.outcome !== 'complete') {
    return fail(`Capture is not complete: outcome is ${capture.captureEnd.outcome}`);
  }
  if (capture.integrity.response !== 'valid') {
    return fail('Capture response hash is invalid');
  }
  if (!capture.captureEnd.responseBodyExact) {
    return fail('Capture response is not body-exact');
  }
  if (capture.captureEnd.downstreamBytesWritten !== capture.responseEnd.bytes) {
    return fail('Capture downstream byte count does not match the recorded response');
  }
  return { eligible: true };
}

function assertReplayable(capture: CaptureDetail, options: ReplayOptions): void {
  const eligibility = captureExactReplayEligibility(capture, {
    targetProtocol: options.targetProtocol,
    allowIncompleteOutcome: options.allowIncomplete === true,
  });
  if (!eligibility.eligible) throw new Error(eligibility.reason);
}

function replayRecords(capture: CaptureDetail): CaptureRecord[] {
  return capture.records.filter((record) =>
    ['response.head', 'response.body_chunk', 'response.trailers', 'response.end'].includes(record.kind),
  );
}

export async function* replayResponseEvents(
  capture: CaptureDetail,
  options: ReplayOptions = {},
): AsyncGenerator<ReplayEvent> {
  assertReplayable(capture, options);
  const speed = replaySpeed(options.speed);
  const originNs = options.startTimeNs ?? process.hrtime.bigint();
  let previousAtUs = -1;

  for (const record of replayRecords(capture)) {
    if (!('atUs' in record) || record.atUs < previousAtUs) {
      throw new Error('Response replay timestamps must be monotonic');
    }
    previousAtUs = record.atUs;
    await waitUntil(originNs, record.atUs, speed, options.signal);

    if (record.kind === 'response.head') {
      if (record.status === undefined) throw new Error('Response status is missing');
      yield {
        type: 'head',
        atUs: record.atUs,
        status: record.status,
        statusText: record.statusText,
        headers: record.rawHeaders,
      };
    } else if (record.kind === 'response.body_chunk') {
      yield {
        type: 'chunk',
        atUs: record.atUs,
        seq: record.seq,
        bytes: decodeBase64(record.bytesBase64),
      };
    } else if (record.kind === 'response.trailers') {
      yield { type: 'trailers', atUs: record.atUs, headers: record.rawHeaders };
    } else if (record.kind === 'response.end') {
      yield {
        type: 'end',
        atUs: record.atUs,
        complete: record.complete !== false && record.eofObserved !== false,
        outcome: capture.captureEnd!.outcome,
      };
    }
  }
}

export function filterReplayHeaders(headers: HeaderInput, responseBytes?: number): HeaderPair[] {
  const pairs = normalizeHeaders(headers);
  const connectionTokens = new Set(
    pairs
      .filter(([name]) => name.toLowerCase() === 'connection')
      .flatMap(([, value]) => value.split(','))
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean),
  );

  return pairs.filter(([name, value]) => {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || connectionTokens.has(lower)) return false;
    if (value === REDACTED || SENSITIVE_HEADERS.has(lower)) return false;
    if (lower === 'content-length' && responseBytes !== undefined) {
      return Number(value) === responseBytes;
    }
    return true;
  });
}

function outgoingHeaders(pairs: HeaderPair[]): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of pairs) {
    const key = name.toLowerCase();
    const existing = headers[key];
    if (existing === undefined) headers[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else headers[key] = [existing, value];
  }
  return headers;
}

async function waitForDrain(response: ServerResponse, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  const drain = once(response, 'drain').then(() => undefined);
  if (!signal) return drain;
  await Promise.race([
    drain,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }),
  ]);
}

export interface ReplayResult {
  bytes: number;
  chunks: number;
  outcome: CaptureOutcome;
}

export async function replayCaptureResponse(
  capture: CaptureDetail,
  response: ServerResponse,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  let bytes = 0;
  let chunks = 0;
  let outcome: CaptureOutcome = capture.captureEnd?.outcome ?? 'capture_truncated';

  for await (const event of replayResponseEvents(capture, options)) {
    if (event.type === 'head') {
      const headers = outgoingHeaders(filterReplayHeaders(event.headers, capture.responseEnd?.bytes));
      if (event.statusText) response.writeHead(event.status, event.statusText, headers);
      else response.writeHead(event.status, headers);
    } else if (event.type === 'chunk') {
      bytes += event.bytes.byteLength;
      chunks += 1;
      if (!response.write(event.bytes)) await waitForDrain(response, options.signal);
    } else if (event.type === 'trailers') {
      response.addTrailers(outgoingHeaders(filterReplayHeaders(event.headers)));
    } else {
      outcome = event.outcome;
      if (event.complete && event.outcome === 'complete') response.end();
      else response.destroy();
    }
  }

  return { bytes, chunks, outcome };
}
