import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseUpstreamBaseUrl } from './network.js'

export type GatewayProtocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
export type RuntimeMode = 'record' | 'replay'
export type ReplaySpeed = number | 'instant'

export interface ReplaySource {
  kind: 'scenario' | 'capture'
  id: string
  speed: ReplaySpeed
}

export interface ReplayBindings {
  stream: ReplaySource
  nonstream: ReplaySource
}

export interface UpstreamConfig {
  protocol: GatewayProtocol
  baseUrl: string
  allowPrivateNetwork: boolean
}

export interface RuntimeConfig {
  mode: RuntimeMode
  recordingProtocol: GatewayProtocol
  activeRecordingId: string
  replayRecordingId: string
  replaySpeed: ReplaySpeed
  revision: number
  enabledEndpoints: GatewayProtocol[]
  upstreams: Record<GatewayProtocol, UpstreamConfig>
  bindings: Record<GatewayProtocol, ReplayBindings>
}

const PROTOCOLS: GatewayProtocol[] = [
  'openai-chat',
  'openai-responses',
  'anthropic-messages',
]

function defaultSource(): ReplaySource {
  return { kind: 'scenario', id: 'builtin-markdown', speed: 1 }
}

function defaultUpstream(protocol: GatewayProtocol): UpstreamConfig {
  return {
    protocol,
    baseUrl: '',
    allowPrivateNetwork: false,
  }
}

function defaultConfig(): RuntimeConfig {
  return {
    mode: 'replay',
    recordingProtocol: 'openai-chat',
    activeRecordingId: '',
    replayRecordingId: '',
    replaySpeed: 1,
    revision: 1,
    enabledEndpoints: [...PROTOCOLS],
    upstreams: Object.fromEntries(PROTOCOLS.map((protocol) => [protocol, defaultUpstream(protocol)])) as RuntimeConfig['upstreams'],
    bindings: Object.fromEntries(PROTOCOLS.map((protocol) => [protocol, {
      stream: defaultSource(),
      nonstream: defaultSource(),
    }])) as RuntimeConfig['bindings'],
  }
}

function normalizeSpeed(value: unknown): ReplaySpeed {
  if (value === 'instant') return value
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 10
    ? value
    : 1
}

function normalizeSource(value: unknown, fallback = defaultSource()): ReplaySource {
  if (!value || typeof value !== 'object') return structuredClone(fallback)
  const raw = value as Partial<ReplaySource>
  if ((raw.kind !== 'capture' && raw.kind !== 'scenario') || typeof raw.id !== 'string' || !raw.id) {
    return structuredClone(fallback)
  }
  return { kind: raw.kind, id: raw.id, speed: normalizeSpeed(raw.speed) }
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  try {
    return parseUpstreamBaseUrl(value).toString()
  } catch {
    return ''
  }
}

function normalizeRecordingId(value: unknown, active = false): string {
  if (typeof value !== 'string') return ''
  const pattern = active ? /^rec_[A-Za-z0-9_-]{8,128}$/ : /^(?:rec|cap)_[A-Za-z0-9_-]{8,128}$/
  return pattern.test(value) ? value : ''
}

function normalizeConfig(value: unknown): RuntimeConfig {
  const raw = value && typeof value === 'object' ? value as Partial<RuntimeConfig> & {
    speed?: unknown
    upstreams?: Record<string, unknown>
    bindings?: Record<string, unknown>
  } : {}
  const config = defaultConfig()
  const rawMode = (raw as { mode?: unknown }).mode
  if (rawMode === 'record' || rawMode === 'replay') config.mode = rawMode
  // Built-in used to be a separate mode. Built-in scenarios are now replay sources.
  if (rawMode === 'builtin') config.mode = 'replay'
  if (typeof raw.recordingProtocol === 'string'
    && PROTOCOLS.includes(raw.recordingProtocol as GatewayProtocol)) {
    config.recordingProtocol = raw.recordingProtocol as GatewayProtocol
  }
  config.activeRecordingId = normalizeRecordingId(raw.activeRecordingId, true)
  config.replayRecordingId = normalizeRecordingId(raw.replayRecordingId)
  config.replaySpeed = normalizeSpeed(raw.replaySpeed)
  if (config.mode === 'record' && !config.activeRecordingId) {
    config.activeRecordingId = `rec_${randomUUID().replace(/-/g, '')}`
  }
  if (typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0) {
    config.revision = raw.revision
  }
  if (Array.isArray(raw.enabledEndpoints)) {
    config.enabledEndpoints = raw.enabledEndpoints.filter(
      (value): value is GatewayProtocol => typeof value === 'string' && PROTOCOLS.includes(value as GatewayProtocol),
    )
  }

  for (const protocol of PROTOCOLS) {
    const upstream = raw.upstreams?.[protocol]
    if (typeof upstream === 'string') {
      config.upstreams[protocol].baseUrl = normalizeBaseUrl(upstream)
    } else if (upstream && typeof upstream === 'object') {
      const candidate = upstream as Partial<UpstreamConfig>
      config.upstreams[protocol] = {
        protocol,
        baseUrl: normalizeBaseUrl(candidate.baseUrl),
        allowPrivateNetwork: candidate.allowPrivateNetwork === true,
      }
    }

    const binding = raw.bindings?.[protocol]
    if (binding && typeof binding === 'object' && ('stream' in binding || 'nonstream' in binding)) {
      const pair = binding as Partial<ReplayBindings>
      config.bindings[protocol] = {
        stream: normalizeSource(pair.stream, config.bindings[protocol].stream),
        nonstream: normalizeSource(pair.nonstream, config.bindings[protocol].nonstream),
      }
    } else if (binding) {
      // Migration from the first record/replay preview, which stored one source per protocol.
      const source = normalizeSource(binding)
      source.speed = normalizeSpeed(raw.speed)
      config.bindings[protocol] = {
        stream: structuredClone(source),
        nonstream: structuredClone(source),
      }
    }
  }
  return config
}

export class RuntimeState {
  #config: RuntimeConfig = defaultConfig()
  #mutationQueue: Promise<void> = Promise.resolve()
  #lastRecordingOrder = 0
  #replayRecordingId = ''
  #replayCursor = 0
  readonly dataDir: string
  readonly runtimeFile: string

  constructor(dataDir: string) {
    this.dataDir = path.resolve(dataDir)
    this.runtimeFile = path.join(this.dataDir, 'runtime.json')
  }

  async load(): Promise<void> {
    await this.#serialize(async () => {
      await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
      try {
        const normalized = normalizeConfig(JSON.parse(await readFile(this.runtimeFile, 'utf8')))
        await this.#persist(normalized)
        this.#config = normalized
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const initial = defaultConfig()
        await this.#persist(initial)
        this.#config = initial
      }
    })
  }

  snapshot(): RuntimeConfig {
    return structuredClone(this.#config)
  }

  async update(patch: {
    mode?: RuntimeMode
    recordingProtocol?: GatewayProtocol
    replayRecordingId?: string
    replaySpeed?: ReplaySpeed
    enabledEndpoints?: GatewayProtocol[]
    upstreams?: Partial<Record<GatewayProtocol, Partial<UpstreamConfig>>>
  }, expectedRevision?: number): Promise<RuntimeConfig> {
    const input = structuredClone(patch)
    return this.#serialize(async () => {
      this.#assertRevision(expectedRevision)
      const next = this.snapshot()
      if (input.recordingProtocol) next.recordingProtocol = input.recordingProtocol
      if (input.replaySpeed !== undefined) next.replaySpeed = normalizeSpeed(input.replaySpeed)
      if (input.replayRecordingId !== undefined) {
        const id = normalizeRecordingId(input.replayRecordingId)
        if (input.replayRecordingId && !id) throw new Error('Invalid replay recording id')
        next.replayRecordingId = id
      }
      if (input.mode === 'record') {
        const startsNewRecording = this.#config.mode !== 'record'
          || this.#config.recordingProtocol !== next.recordingProtocol
          || !this.#config.activeRecordingId
        next.mode = 'record'
        if (startsNewRecording) next.activeRecordingId = `rec_${randomUUID().replace(/-/g, '')}`
      } else if (input.mode === 'replay') {
        next.mode = 'replay'
        if (input.replayRecordingId === undefined && this.#config.mode === 'record') {
          next.replayRecordingId = this.#config.activeRecordingId
        }
      }
      if (input.enabledEndpoints) next.enabledEndpoints = [...input.enabledEndpoints]
      for (const protocol of PROTOCOLS) {
        const upstream = input.upstreams?.[protocol]
        if (upstream) next.upstreams[protocol] = { ...next.upstreams[protocol], ...upstream, protocol }
      }
      next.revision += 1
      const persisted = normalizeConfig(next)
      await this.#persist(persisted)
      this.#config = persisted
      if (input.mode === 'replay') this.resetReplay()
      return this.snapshot()
    })
  }

  claimRecording(): { id: string; order: number; protocol: GatewayProtocol } | undefined {
    if (this.#config.mode !== 'record' || !this.#config.activeRecordingId) return undefined
    this.#lastRecordingOrder = Math.max(Date.now() * 1000, this.#lastRecordingOrder + 1)
    return {
      id: this.#config.activeRecordingId,
      order: this.#lastRecordingOrder,
      protocol: this.#config.recordingProtocol,
    }
  }

  claimReplay(recordingId: string, captureIds: string[]): { id: string; index: number; total: number } | undefined {
    if (this.#config.mode !== 'replay' || this.#config.replayRecordingId !== recordingId) return undefined
    if (this.#replayRecordingId !== recordingId) {
      this.#replayRecordingId = recordingId
      this.#replayCursor = 0
    }
    const index = this.#replayCursor
    const id = captureIds[index]
    if (!id) return undefined
    this.#replayCursor += 1
    return { id, index, total: captureIds.length }
  }

  replayPosition(recordingId = this.#config.replayRecordingId): number {
    return this.#replayRecordingId === recordingId ? this.#replayCursor : 0
  }

  private resetReplay(): void {
    this.#replayRecordingId = this.#config.replayRecordingId
    this.#replayCursor = 0
  }

  async updateBinding(
    protocol: GatewayProtocol,
    stream: boolean,
    source: ReplaySource,
    expectedRevision?: number,
  ): Promise<RuntimeConfig> {
    const input = structuredClone(source)
    return this.#serialize(async () => {
      this.#assertRevision(expectedRevision)
      const next = this.snapshot()
      next.bindings[protocol][stream ? 'stream' : 'nonstream'] = normalizeSource(input)
      next.revision += 1
      const persisted = normalizeConfig(next)
      await this.#persist(persisted)
      this.#config = persisted
      return this.snapshot()
    })
  }

  async save(): Promise<void> {
    await this.#serialize(async () => this.#persist(this.#config))
  }

  #assertRevision(expectedRevision: number | undefined): void {
    if (expectedRevision === undefined) return
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new Error('Expected runtime revision must be a positive integer')
    }
    if (this.#config.revision !== expectedRevision) {
      throw new Error('Runtime changed; refresh and try again')
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation)
    this.#mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async #persist(config: RuntimeConfig): Promise<void> {
    const temporary = `${this.runtimeFile}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      await rename(temporary, this.runtimeFile)
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }
}

export const GATEWAY_PROTOCOLS = PROTOCOLS
