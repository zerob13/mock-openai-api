export type Protocol = 'openai-chat' | 'openai-responses' | 'anthropic-messages'
export type RuntimeMode = 'record' | 'replay'
export type ReplayOrder = 'sequential' | 'random'
export type ReplayLoop = 'none' | 'one' | 'all'

export interface RuntimeState {
  mode: RuntimeMode
  recordingProtocol: Protocol
  activeRecordingId: string
  replayRecordingId: string
  replayPlaylist: string[]
  replayOrder: ReplayOrder
  replayLoop: ReplayLoop
  replaySequence: string[]
  replaySpeed: number | 'instant'
  replayPosition: number
  replayTotal: number
  revision: number
  activeRequests: number
  apiBaseUrl: string
  adminBaseUrl: string
  dataDir: string
  enabledEndpoints: Protocol[]
  captureCount: number
  scenarioCount: number
  errorCount: number
  partialCount: number
  upstreams: UpstreamConfig[]
}

export interface UpstreamConfig {
  protocol: Protocol
  baseUrl: string
  allowPrivateNetwork: boolean
  status?: 'ready' | 'unchecked' | 'error'
  message?: string
}

export interface CaptureSummary {
  id: string
  protocol: Protocol
  recordingId?: string
  recordingOrder?: number
  createdAt: string
  outcome: string
  stream: boolean
  method?: string
  downstreamUrl?: string
  upstreamUrl?: string
  status?: number
  durationUs?: number
  ttfbUs?: number
  requestBytes?: number
  responseBytes?: number
  bodyExact?: boolean
  timingReplayable?: boolean
  includeUsage?: boolean
  valid?: boolean
  partial?: boolean
  title?: string
}

export interface RecordingSummary {
  id: string
  createdAt: string
  protocol: Protocol
  requestCount: number
  completeCount: number
  active: boolean
  requests: CaptureSummary[]
}

export interface CaptureDetail extends CaptureSummary {
  request?: unknown
  response?: unknown
  timeline?: unknown[]
  records?: unknown[]
  hashes?: Record<string, string>
  redactions?: string[]
}

export type ScenarioEventType =
  | 'message.start'
  | 'text.start'
  | 'text.delta'
  | 'text.end'
  | 'tool.start'
  | 'tool.arguments.delta'
  | 'tool.end'
  | 'usage'
  | 'finish'
  | 'error'
  | 'ping'

export interface ScenarioEvent {
  type: ScenarioEventType
  atUs: number
  messageId?: string
  role?: 'assistant'
  textId?: string
  format?: 'plain' | 'markdown'
  delta?: string
  toolCallId?: string
  name?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reason?: string
  code?: string
  message?: string
}

export interface Scenario {
  schema: 'mock-openai-api.scenario'
  kind: 'scenario'
  schemaVersion: 1
  id: string
  title: string
  description: string
  source: {
    kind: 'builtin' | 'capture' | 'editor'
    protocol?: Protocol
    captureId?: string
  }
  match: {
    protocols: Protocol[]
    stream: boolean
  }
  response: {
    status: number
    headers: Record<string, string>
  }
  timeline: ScenarioEvent[]
  updatedAt?: string
}

export interface ReplayBinding {
  protocol: Protocol
  stream: boolean
  sourceType: 'capture' | 'scenario'
  sourceId: string
  speed: number | 'instant'
  sourceTitle?: string
  compatible?: boolean
  diagnostics?: string[]
}

export interface PreviewResult {
  protocol: Protocol
  status?: number
  headers?: Record<string, string>
  body?: unknown
  frames?: Array<{ atUs?: number; event?: string; data?: unknown; raw?: string }>
  diagnostics?: string[]
}
