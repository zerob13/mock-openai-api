import type {
  CaptureDetail,
  CaptureSummary,
  PreviewResult,
  Protocol,
  ReplayBinding,
  RuntimeState,
  Scenario,
} from './types'

const ADMIN_API = import.meta.env.VITE_ADMIN_API_BASE || '/admin/api'
let adminToken = ''

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export function setAdminToken(token: string): void {
  adminToken = token.trim()
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${ADMIN_API}${path}`, { ...init, headers })
  const contentType = response.headers.get('content-type') || ''
  const payload: unknown = contentType.includes('json')
    ? await response.json()
    : await response.text()
  if (!response.ok) {
    const details = payload as { message?: string; error?: string }
    throw new ApiError(details?.message || details?.error || response.statusText, response.status, payload)
  }
  return payload as T
}

function listFrom<T>(payload: T[] | { items?: T[]; data?: T[] }): T[] {
  return Array.isArray(payload) ? payload : payload.items || payload.data || []
}

export async function getRuntime(): Promise<RuntimeState> {
  const payload = await request<RuntimeState | { runtime: RuntimeState }>('/runtime')
  return 'runtime' in payload ? payload.runtime : payload
}

export async function patchRuntime(patch: Partial<RuntimeState> & { revision: number }): Promise<RuntimeState> {
  const payload = await request<RuntimeState | { runtime: RuntimeState }>('/runtime', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return 'runtime' in payload ? payload.runtime : payload
}

export async function getCaptures(): Promise<CaptureSummary[]> {
  return listFrom(await request<CaptureSummary[] | { items?: CaptureSummary[] }>('/captures'))
}

export function getCapture(id: string): Promise<CaptureDetail> {
  return request(`/captures/${encodeURIComponent(id)}`)
}

export function deleteCapture(id: string): Promise<void> {
  return request(`/captures/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function importCapture(file: File): Promise<CaptureSummary> {
  return request('/captures/import', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-ndjson',
      'X-Capture-Filename': file.name,
    },
    body: file,
  })
}

export function captureToScenario(id: string): Promise<Scenario> {
  return request(`/captures/${encodeURIComponent(id)}/to-scenario`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function getScenarios(): Promise<Scenario[]> {
  return listFrom(await request<Scenario[] | { items?: Scenario[] }>('/scenarios'))
}

export function getScenario(id: string): Promise<Scenario> {
  return request(`/scenarios/${encodeURIComponent(id)}`)
}

export function putScenario(scenario: Scenario): Promise<Scenario> {
  return request(`/scenarios/${encodeURIComponent(scenario.id)}`, {
    method: 'PUT',
    body: JSON.stringify(scenario),
  })
}

export function deleteScenario(id: string): Promise<void> {
  return request(`/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function previewScenario(protocol: Protocol, scenario: Scenario): Promise<PreviewResult> {
  return request(`/scenarios/preview/${protocol}`, {
    method: 'POST',
    body: JSON.stringify(scenario),
  })
}

export async function getBindings(): Promise<ReplayBinding[]> {
  return listFrom(await request<ReplayBinding[] | { items?: ReplayBinding[] }>('/bindings'))
}

export async function putBinding(binding: ReplayBinding): Promise<ReplayBinding[]> {
  const payload = await request<ReplayBinding[] | { items?: ReplayBinding[] }>('/bindings', {
    method: 'PUT',
    body: JSON.stringify(binding),
  })
  return listFrom(payload)
}

export function checkUpstream(upstream: unknown): Promise<{ ok: boolean; latencyMs?: number; message?: string }> {
  return request('/upstreams/check', { method: 'POST', body: JSON.stringify(upstream) })
}
