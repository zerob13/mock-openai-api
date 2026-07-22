<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { captureToScenario, deleteCapture, getCapture, getCaptures, importCapture } from '../api'
import type { CaptureDetail, CaptureSummary, Protocol } from '../types'

type DetailTab = 'summary' | 'request' | 'response' | 'parsed' | 'timeline' | 'raw'

const route = useRoute()
const router = useRouter()
const captures = ref<CaptureSummary[]>([])
const selected = ref<CaptureDetail | null>(null)
const loading = ref(true)
const detailLoading = ref(false)
const importing = ref(false)
const converting = ref(false)
const error = ref('')
const activeTab = ref<DetailTab>('summary')
const fileInput = ref<HTMLInputElement>()
const filters = ref({ protocol: '', outcome: '', stream: '', search: '', partial: '' })

const filtered = computed(() => {
  const query = filters.value.search.trim().toLowerCase()
  return captures.value.filter((item) => {
    if (filters.value.protocol && item.protocol !== filters.value.protocol) return false
    if (filters.value.outcome && item.outcome !== filters.value.outcome) return false
    if (filters.value.stream && String(item.stream) !== filters.value.stream) return false
    if (filters.value.partial === 'exact' && (item.partial || item.outcome !== 'complete' || item.bodyExact !== true)) return false
    if (filters.value.partial === 'inexact' && (item.partial || item.bodyExact !== false)) return false
    if (filters.value.partial === 'partial' && !item.partial) return false
    return !query || [item.id, item.title, item.downstreamUrl, item.upstreamUrl, item.protocol]
      .some((value) => String(value || '').toLowerCase().includes(query))
  })
})

const timeline = computed(() => selected.value?.timeline || selected.value?.records || [])
const parsedResponse = computed(() => {
  const response = selected.value?.response
  if (!response || typeof response !== 'object') return response
  const body = (response as Record<string, unknown>).bodyUtf8
  if (typeof body !== 'string') return response
  let parsed: unknown = body
  try {
    parsed = selected.value?.stream ? parseSse(body) : JSON.parse(body)
  } catch {
    // Keep non-JSON provider payloads visible as text.
  }
  return { ...(response as Record<string, unknown>), body: parsed }
})

function parseSse(value: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  let event = 'message'
  let data: string[] = []
  let id: string | undefined
  let retry: number | undefined
  const dispatch = (): void => {
    if (!data.length) {
      event = 'message'
      id = undefined
      retry = undefined
      return
    }
    const raw = data.join('\n')
    let payload: unknown = raw
    if (raw !== '[DONE]') {
      try { payload = JSON.parse(raw) } catch { /* Preserve opaque data. */ }
    }
    events.push({ event, data: payload, rawData: raw, ...(id ? { id } : {}), ...(retry != null ? { retry } : {}) })
    event = 'message'
    data = []
    id = undefined
    retry = undefined
  }
  for (const line of value.split(/\r\n|\r|\n/)) {
    if (!line) {
      dispatch()
      continue
    }
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    const fieldValue = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'event') event = fieldValue || 'message'
    else if (field === 'data') data.push(fieldValue)
    else if (field === 'id') id = fieldValue
    else if (field === 'retry' && /^\d+$/.test(fieldValue)) retry = Number(fieldValue)
  }
  dispatch()
  return events
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

function humanBytes(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 ** 2).toFixed(1)} MiB`
}

function humanTime(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value < 1000 ? `${value} µs` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} ms`
}

function recordValue(record: unknown, keys: string[]): unknown {
  if (!record || typeof record !== 'object') return '—'
  const candidate = record as Record<string, unknown>
  for (const key of keys) if (candidate[key] != null) return candidate[key]
  return '—'
}

function recordBytes(record: unknown): number | undefined {
  const direct = Number(recordValue(record, ['size', 'bytes', 'length']))
  if (Number.isFinite(direct)) return direct
  if (!record || typeof record !== 'object') return undefined
  const encoded = (record as Record<string, unknown>).bytesBase64
  if (typeof encoded !== 'string') return undefined
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, encoded.length * 3 / 4 - padding)
}

async function load(): Promise<void> {
  loading.value = true
  try {
    captures.value = await getCaptures()
    error.value = ''
    const requested = String(route.query.id || '')
    if (requested && captures.value.some((item) => item.id === requested)) await selectCapture(requested)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not list recordings'
  } finally {
    loading.value = false
  }
}

async function selectCapture(id: string): Promise<void> {
  detailLoading.value = true
  activeTab.value = 'summary'
  try {
    selected.value = await getCapture(id)
    await router.replace({ query: { ...route.query, id } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not read recording'
  } finally {
    detailLoading.value = false
  }
}

async function remove(): Promise<void> {
  if (!selected.value || !window.confirm(`Move ${selected.value.id} to trash?`)) return
  try {
    await deleteCapture(selected.value.id)
    captures.value = captures.value.filter((item) => item.id !== selected.value?.id)
    selected.value = null
    await router.replace({ query: {} })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not remove recording'
  }
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  try {
    const imported = await importCapture(file)
    await load()
    await selectCapture(imported.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Import failed'
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function saveAsScenario(): Promise<void> {
  if (!selected.value) return
  converting.value = true
  try {
    const scenario = await captureToScenario(selected.value.id)
    await router.push({ name: 'scenarios', query: { id: scenario.id } })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not convert recording'
  } finally {
    converting.value = false
  }
}

function bindForReplay(): void {
  if (!selected.value) return
  void router.push({
    name: 'replay',
    query: {
      sourceType: 'capture',
      sourceId: selected.value.id,
      protocol: selected.value.protocol,
      stream: String(selected.value.stream),
    },
  })
}

onMounted(load)
</script>

<template>
  <section class="page recordings-page">
    <header class="page-heading">
      <div>
        <h1>Recordings</h1>
        <p>Inspect immutable request and response captures. API keys are removed before files reach this list.</p>
      </div>
      <div class="heading-actions">
        <input ref="fileInput" class="visually-hidden" type="file" accept=".jsonl,.json,application/json" @change="importFile" />
        <var-button outline :loading="importing" @click="fileInput?.click()">Import capture</var-button>
        <var-button :loading="loading" @click="load">Refresh</var-button>
      </div>
    </header>

    <div v-if="error" class="callout danger page-error" role="alert">{{ error }}</div>

    <article class="panel filters-panel">
      <div class="panel-body toolbar">
        <label class="field filter-search">
          <span>Search</span>
          <input v-model="filters.search" type="search" placeholder="ID, URL, or protocol" />
        </label>
        <label class="field">
          <span>Protocol</span>
          <select v-model="filters.protocol">
            <option value="">All protocols</option>
            <option value="openai-chat">OpenAI Chat</option>
            <option value="openai-responses">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
          </select>
        </label>
        <label class="field">
          <span>Outcome</span>
          <select v-model="filters.outcome">
            <option value="">All outcomes</option>
            <option value="complete">Complete</option>
            <option value="upstream_error">Upstream error</option>
            <option value="client_cancelled">Client cancelled</option>
            <option value="timeout">Timeout</option>
          </select>
        </label>
        <label class="field">
          <span>Transport</span>
          <select v-model="filters.stream">
            <option value="">Stream + non-stream</option>
            <option value="true">Streaming</option>
            <option value="false">Non-streaming</option>
          </select>
        </label>
        <label class="field">
          <span>Integrity</span>
          <select v-model="filters.partial">
            <option value="">Exact + partial</option>
            <option value="exact">Body exact</option>
            <option value="inexact">Sanitized / inexact</option>
            <option value="partial">Partial</option>
          </select>
        </label>
      </div>
    </article>

    <div class="recordings-grid">
      <article class="panel recordings-list">
        <header class="panel-header">
          <h2>{{ filtered.length }} recording{{ filtered.length === 1 ? '' : 's' }}</h2>
          <span class="panel-note">one file per request</span>
        </header>
        <div v-if="loading" class="loading-row"><var-loading size="small" /> Parsing capture index</div>
        <div v-else-if="!filtered.length" class="empty-state">
          <div><strong>No matching recordings</strong>Change the filters or import a capture file.</div>
        </div>
        <div v-else class="table-scroll">
          <table class="data-table capture-table">
            <thead><tr><th>Request</th><th>Protocol</th><th>Outcome</th><th>Latency</th><th>Size</th><th>Created</th></tr></thead>
            <tbody>
              <tr
                v-for="capture in filtered"
                :key="capture.id"
                :class="{ 'is-selected': selected?.id === capture.id }"
              >
                <td>
                  <button class="row-button" type="button" @click="selectCapture(capture.id)">
                    <strong class="mono">{{ capture.id }}</strong>
                    <span class="capture-url">{{ capture.downstreamUrl || capture.title || 'Captured request' }}</span>
                  </button>
                </td>
                <td>{{ capture.protocol }}</td>
                <td><span class="badge" :class="capture.outcome === 'complete' ? 'success' : 'danger'">{{ capture.outcome }}</span></td>
                <td>{{ humanTime(capture.durationUs) }}</td>
                <td>{{ humanBytes(capture.responseBytes) }}</td>
                <td class="nowrap">{{ new Date(capture.createdAt).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel recording-detail">
        <div v-if="detailLoading" class="loading-row"><var-loading size="small" /> Reading capture</div>
        <div v-else-if="!selected" class="empty-state">
          <div><strong>Select a recording</strong>Its request, response, timing, and raw records appear here.</div>
        </div>
        <template v-else>
          <header class="panel-header detail-header">
            <div class="detail-title">
              <div class="button-row">
                <span class="badge" :class="selected.outcome !== 'complete' || selected.bodyExact === false || selected.partial ? 'warning' : 'success'">
                  {{ selected.partial ? 'Partial' : selected.outcome !== 'complete' ? 'Incomplete' : selected.bodyExact === false ? 'Sanitized / inexact' : 'Body exact' }}
                </span>
                <span class="badge" :class="selected.timingReplayable === false ? 'warning' : 'plain'">{{ selected.timingReplayable === false ? 'Timing degraded' : 'Recorded timing' }}</span>
                <span class="badge info">{{ selected.protocol }}</span>
              </div>
              <h2 class="mono">{{ selected.id }}</h2>
            </div>
            <div class="button-row">
              <var-button size="small" outline :loading="converting" :disabled="selected.partial" @click="saveAsScenario">Save as scenario</var-button>
              <var-button size="small" outline :disabled="selected.partial" @click="bindForReplay">Bind to replay</var-button>
              <var-button size="small" text color="danger" @click="remove">Move to trash</var-button>
            </div>
          </header>
          <div class="detail-tabs">
            <div class="tab-list" role="tablist" aria-label="Recording details">
              <button v-for="tab in (['summary', 'request', 'response', 'parsed', 'timeline', 'raw'] as DetailTab[])" :key="tab" role="tab" :aria-selected="activeTab === tab" @click="activeTab = tab">
                {{ tab[0].toUpperCase() + tab.slice(1) }}
              </button>
            </div>
          </div>

          <div class="detail-content">
            <template v-if="activeTab === 'summary'">
              <dl class="detail-list summary-list">
                <dt>Protocol</dt><dd>{{ selected.protocol }}</dd>
                <dt>Method</dt><dd>{{ selected.method || 'POST' }}</dd>
                <dt>Downstream URL</dt><dd class="mono">{{ selected.downstreamUrl || '—' }}</dd>
                <dt>Upstream URL</dt><dd class="mono">{{ selected.upstreamUrl || '—' }}</dd>
                <dt>Status</dt><dd>{{ selected.status || '—' }}</dd>
                <dt>TTFB</dt><dd>{{ humanTime(selected.ttfbUs) }}</dd>
                <dt>Total duration</dt><dd>{{ humanTime(selected.durationUs) }}</dd>
                <dt>Timing replay</dt><dd>{{ selected.timingReplayable === false ? 'Degraded; instant only for raw replay' : 'Recorded offsets available' }}</dd>
                <dt>Request bytes</dt><dd>{{ humanBytes(selected.requestBytes) }}</dd>
                <dt>Response bytes</dt><dd>{{ humanBytes(selected.responseBytes) }}</dd>
                <dt>Created</dt><dd>{{ new Date(selected.createdAt).toLocaleString() }}</dd>
                <dt>Redactions</dt><dd>{{ selected.redactions?.join(', ') || 'No sensitive headers persisted' }}</dd>
              </dl>
              <div v-if="selected.hashes" class="hashes">
                <span class="eyebrow">Integrity hashes</span>
                <pre class="code-block">{{ pretty(selected.hashes) }}</pre>
              </div>
            </template>
            <pre v-else-if="activeTab === 'request'" class="code-block">{{ pretty(selected.request) }}</pre>
            <pre v-else-if="activeTab === 'response'" class="code-block">{{ pretty(selected.response) }}</pre>
            <pre v-else-if="activeTab === 'parsed'" class="code-block">{{ pretty(parsedResponse) }}</pre>
            <div v-else-if="activeTab === 'timeline'" class="timeline-table table-scroll">
              <table v-if="timeline.length" class="data-table">
                <thead><tr><th>#</th><th>Gateway time</th><th>Upstream read</th><th>Record</th><th>Event</th><th>Size</th></tr></thead>
                <tbody>
                  <tr v-for="(record, index) in timeline" :key="index">
                    <td>{{ index }}</td>
                    <td class="mono">{{ humanTime(Number(recordValue(record, ['atUs', 'offsetUs']))) }}</td>
                    <td class="mono">{{ humanTime(Number(recordValue(record, ['upstreamObservedAtUs']))) }}</td>
                    <td class="mono">{{ recordValue(record, ['type', 'kind']) }}</td>
                    <td class="mono">{{ recordValue(record, ['event', 'eventName']) }}</td>
                    <td>{{ humanBytes(recordBytes(record)) }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="empty-state"><div><strong>No derived timeline</strong>The raw capture is still available.</div></div>
            </div>
            <pre v-else class="code-block raw-block">{{ pretty(selected) }}</pre>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>

<style scoped>
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.page-error { margin-bottom: 14px; }
.filters-panel { margin-bottom: 16px; box-shadow: none; }
.filter-search { min-width: 240px; flex: 1; }
.recordings-grid { display: grid; grid-template-columns: minmax(520px, 1.2fr) minmax(380px, .8fr); gap: 16px; align-items: start; }
.recordings-list { min-width: 0; }
.capture-table { min-width: 760px; }
.capture-url { display: block; max-width: 260px; margin-top: 4px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recording-detail { position: sticky; top: 102px; min-width: 0; max-height: calc(100vh - 150px); overflow: auto; }
.detail-header { align-items: flex-start; }
.detail-title { min-width: 0; }
.detail-title h2 { margin: 9px 0 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; }
.detail-tabs { padding: 12px 16px 0; }
.detail-content { padding: 16px; }
.summary-list { grid-template-columns: 116px minmax(0, 1fr); }
.hashes { display: grid; gap: 8px; margin-top: 20px; }
.raw-block { max-height: 58vh; }
@media (max-width: 1400px) {
  .recordings-grid { grid-template-columns: 1fr; }
  .recording-detail { position: static; max-height: none; }
}
</style>
