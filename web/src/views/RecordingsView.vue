<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  captureToScenario,
  deleteCapture,
  getCapture,
  getRecordings,
  importCapture,
} from '../api'
import { useRuntimeStore } from '../stores/runtime'
import type { CaptureDetail, CaptureSummary, Protocol, RecordingSummary } from '../types'

const runtime = useRuntimeStore()
const recordings = ref<RecordingSummary[]>([])
const recordingProtocol = ref<Protocol>('openai-chat')
const selectedRecordingId = ref('')
const selectedCapture = ref<CaptureDetail | null>(null)
const loading = ref(true)
const switching = ref(false)
const importing = ref(false)
const detailLoading = ref(false)
const error = ref('')
const fileInput = ref<HTMLInputElement>()
let pollTimer: number | undefined
let refreshing = false

const protocols: Record<Protocol, { label: string; endpoint: string }> = {
  'openai-chat': { label: 'OpenAI Chat', endpoint: '/v1/chat/completions' },
  'openai-responses': { label: 'OpenAI Responses', endpoint: '/v1/responses' },
  'anthropic-messages': { label: 'Anthropic Messages', endpoint: '/v1/messages' },
}

const configuredUpstreams = computed(() => runtime.state.upstreams.filter((upstream) => upstream.baseUrl))
const selectedUpstream = computed(() => runtime.state.upstreams.find(
  (upstream) => upstream.protocol === recordingProtocol.value,
))
const recordingReady = computed(() => Boolean(selectedUpstream.value?.baseUrl)
  && runtime.state.enabledEndpoints.includes(recordingProtocol.value))
const activeRecording = computed(() => recordings.value.find(
  (recording) => recording.id === runtime.state.activeRecordingId,
))
const shownRecording = computed(() => {
  if (runtime.state.mode === 'record') return activeRecording.value
  return recordings.value.find((recording) => recording.id === selectedRecordingId.value)
    || recordings.value.find((recording) => recording.id === runtime.state.replayRecordingId)
    || recordings.value[0]
})
const replayingShownRecording = computed(() => runtime.state.mode === 'replay'
  && shownRecording.value?.id === runtime.state.replayRecordingId)
const shownRequests = computed(() => {
  const requests = shownRecording.value?.requests ?? []
  return runtime.state.mode === 'record' ? requests : requests.filter(isGenerationCapture)
})
const endpoint = computed(() => `${runtime.state.apiBaseUrl}${protocols[recordingProtocol.value].endpoint}`)

watch(configuredUpstreams, (upstreams) => {
  if (upstreams.length && !upstreams.some((upstream) => upstream.protocol === recordingProtocol.value)) {
    recordingProtocol.value = upstreams[0].protocol
  }
})

function pathOf(capture: CaptureSummary): string {
  try {
    const url = new URL(capture.downstreamUrl || '')
    return `${url.pathname}${url.search}`
  } catch {
    return capture.downstreamUrl || 'Captured request'
  }
}

function isGenerationCapture(capture: CaptureSummary): boolean {
  const path = pathOf(capture).split('?')[0]
  return Object.values(protocols).some((protocol) => protocol.endpoint === path)
    || path === '/chat/completions'
}

function replayRequestCount(recording: RecordingSummary): number {
  return recording.requests.filter(isGenerationCapture).length
}

function humanTime(value?: number): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value < 1000 ? `${value} µs` : `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} ms`
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2)
}

function parsedResponse(detail: CaptureDetail): unknown {
  if (!detail.response || typeof detail.response !== 'object') return detail.response
  const response = detail.response as Record<string, unknown>
  if (typeof response.bodyUtf8 !== 'string') return response
  try {
    return { ...response, body: JSON.parse(response.bodyUtf8) }
  } catch {
    return response
  }
}

async function refreshDeck(initial = false): Promise<void> {
  if (refreshing) return
  refreshing = true
  if (initial) loading.value = true
  try {
    await runtime.refresh()
    recordings.value = await getRecordings()
    const preferred = runtime.state.mode === 'record'
      ? runtime.state.activeRecordingId
      : runtime.state.replayRecordingId
    if (preferred) selectedRecordingId.value = preferred
    else if (!recordings.value.some((recording) => recording.id === selectedRecordingId.value)) {
      selectedRecordingId.value = recordings.value[0]?.id || ''
    }
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not refresh recordings'
  } finally {
    loading.value = false
    refreshing = false
  }
}

async function toggleRecording(): Promise<void> {
  if (runtime.state.mode !== 'record' && !recordingReady.value) return
  switching.value = true
  try {
    if (runtime.state.mode === 'record') await runtime.update({ mode: 'replay' })
    else await runtime.update({ mode: 'record', recordingProtocol: recordingProtocol.value })
    selectedCapture.value = null
    await refreshDeck()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not change recorder state'
  } finally {
    switching.value = false
  }
}

async function replay(recording: RecordingSummary): Promise<void> {
  if (!replayRequestCount(recording)) return
  switching.value = true
  try {
    await runtime.update({ mode: 'replay', replayRecordingId: recording.id })
    selectedRecordingId.value = recording.id
    selectedCapture.value = null
    await refreshDeck()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start replay'
  } finally {
    switching.value = false
  }
}

async function selectCapture(capture: CaptureSummary): Promise<void> {
  if (capture.partial) return
  detailLoading.value = true
  try {
    selectedCapture.value = await getCapture(capture.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not read request'
  } finally {
    detailLoading.value = false
  }
}

async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importing.value = true
  try {
    const capture = await importCapture(file)
    await refreshDeck()
    selectedRecordingId.value = capture.recordingId || capture.id
    await selectCapture(capture)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Import failed'
  } finally {
    importing.value = false
    input.value = ''
  }
}

async function saveAsScenario(): Promise<void> {
  if (!selectedCapture.value) return
  try {
    await captureToScenario(selectedCapture.value.id)
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not create scenario'
  }
}

async function removeCapture(): Promise<void> {
  const capture = selectedCapture.value
  if (!capture || !window.confirm(`Move ${capture.id} to trash?`)) return
  try {
    await deleteCapture(capture.id)
    selectedCapture.value = null
    await refreshDeck()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not remove request'
  }
}

async function poll(): Promise<void> {
  await refreshDeck()
  pollTimer = window.setTimeout(poll, runtime.state.mode === 'record' ? 700 : 2_000)
}

onMounted(async () => {
  await refreshDeck(true)
  recordingProtocol.value = configuredUpstreams.value.some(
    (upstream) => upstream.protocol === runtime.state.recordingProtocol,
  ) ? runtime.state.recordingProtocol : configuredUpstreams.value[0]?.protocol || runtime.state.recordingProtocol
  pollTimer = window.setTimeout(poll, 700)
})

onBeforeUnmount(() => window.clearTimeout(pollTimer))
</script>

<template>
  <section class="page recorder-page">
    <header class="page-heading">
      <div>
        <h1>Recorder</h1>
        <p>Press record, send API requests, then replay the same responses in the same order.</p>
      </div>
      <div class="heading-actions">
        <input ref="fileInput" class="visually-hidden" type="file" accept=".jsonl,.json,application/json" @change="importFile" />
        <var-button text :loading="importing" @click="fileInput?.click()">Import</var-button>
      </div>
    </header>

    <div v-if="error" class="callout danger page-error" role="alert">{{ error }}</div>

    <article class="panel recorder" :class="{ recording: runtime.state.mode === 'record' }">
      <button
        class="record-button"
        :class="{ stop: runtime.state.mode === 'record' }"
        type="button"
        :disabled="switching || (runtime.state.mode !== 'record' && !recordingReady)"
        :aria-label="runtime.state.mode === 'record' ? 'Stop recording' : 'Start recording'"
        @click="toggleRecording"
      >
        <span aria-hidden="true">{{ runtime.state.mode === 'record' ? '■' : '●' }}</span>
      </button>

      <div class="recorder-copy">
        <span class="eyebrow">{{ runtime.state.mode === 'record' ? 'Recording' : 'Ready' }}</span>
        <h2>{{ runtime.state.mode === 'record' ? `${activeRecording?.requestCount || 0} requests captured` : 'New recording' }}</h2>
        <p v-if="runtime.state.mode === 'record'" class="mono">{{ endpoint }}</p>
        <p v-else>Each press starts a fresh ordered recording.</p>
      </div>

      <label class="field source-field">
        <span>Upstream</span>
        <select v-model="recordingProtocol" :disabled="runtime.state.mode === 'record' || switching || !configuredUpstreams.length">
          <option v-for="upstream in configuredUpstreams" :key="upstream.protocol" :value="upstream.protocol">
            {{ protocols[upstream.protocol].label }}
          </option>
        </select>
        <small v-if="!configuredUpstreams.length" class="error-text">Add an upstream in Settings first.</small>
        <small v-else-if="!recordingReady" class="error-text">Enable this API in Settings first.</small>
        <small v-else class="field-help truncate">{{ selectedUpstream?.baseUrl }}</small>
      </label>
    </article>

    <article class="panel queue-panel">
      <header class="panel-header queue-header">
        <div>
          <h2>{{ runtime.state.mode === 'record' ? 'Live requests' : 'Replay queue' }}</h2>
          <span v-if="shownRecording" class="panel-note mono">{{ shownRecording.id }}</span>
        </div>
        <div v-if="shownRecording" class="queue-status">
          <span v-if="runtime.state.mode === 'record'" class="badge danger">Live</span>
          <template v-else>
            <span v-if="replayingShownRecording" class="badge" :class="runtime.state.replayPosition >= runtime.state.replayTotal ? 'success' : 'warning'">
              {{ runtime.state.replayPosition >= runtime.state.replayTotal ? 'Finished' : `${runtime.state.replayPosition}/${runtime.state.replayTotal}` }}
            </span>
            <var-button size="small" :loading="switching" :disabled="!replayRequestCount(shownRecording)" @click="replay(shownRecording)">
              {{ replayingShownRecording && runtime.state.replayPosition > 0 ? 'Replay again' : 'Replay' }}
            </var-button>
          </template>
        </div>
      </header>

      <div v-if="loading" class="loading-row"><var-loading size="small" /> Reading recordings</div>
      <div v-else-if="!shownRecording" class="empty-state">
        <div><strong>Nothing recorded yet</strong>Choose an upstream and press the red button.</div>
      </div>
      <div v-else-if="!shownRequests.length" class="empty-state compact">
        <div><strong>No generation requests</strong>Model discovery is replayed separately from this queue.</div>
      </div>
      <div v-else class="table-scroll">
        <table class="data-table request-table">
          <thead><tr><th>#</th><th>Request</th><th>Response</th><th>Time</th></tr></thead>
          <tbody>
            <tr
              v-for="(capture, index) in shownRequests"
              :key="capture.id"
              :class="{
                'is-selected': selectedCapture?.id === capture.id,
                consumed: replayingShownRecording && index < runtime.state.replayPosition,
                next: replayingShownRecording && index === runtime.state.replayPosition,
              }"
            >
              <td class="request-index">{{ index + 1 }}</td>
              <td>
                <button class="row-button" type="button" :disabled="capture.partial" @click="selectCapture(capture)">
                  <strong>{{ capture.method || 'POST' }}</strong>
                  <span class="mono request-path">{{ pathOf(capture) }}</span>
                </button>
              </td>
              <td>
                <span v-if="capture.partial" class="badge danger">Recording</span>
                <span v-else class="badge" :class="capture.outcome === 'complete' ? 'success' : 'warning'">
                  {{ capture.status || capture.outcome }}
                </span>
              </td>
              <td class="nowrap">{{ humanTime(capture.durationUs) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="panel library-panel">
      <header class="panel-header"><h2>Recordings</h2><span class="panel-note">{{ recordings.length }} saved</span></header>
      <div v-if="!recordings.length" class="empty-state compact"><div>No saved recordings.</div></div>
      <div v-else class="recording-list">
        <button
          v-for="recording in recordings"
          :key="recording.id"
          type="button"
          class="recording-row"
          :class="{ selected: shownRecording?.id === recording.id }"
          @click="selectedRecordingId = recording.id; selectedCapture = null"
        >
          <span><strong>{{ new Date(recording.createdAt).toLocaleString() }}</strong><small class="mono">{{ recording.id }}</small></span>
          <span>{{ protocols[recording.protocol].label }}</span>
          <span>{{ recording.requestCount }} request{{ recording.requestCount === 1 ? '' : 's' }}</span>
          <span v-if="recording.active" class="badge danger">Live</span>
          <span v-else-if="runtime.state.replayRecordingId === recording.id" class="badge warning">Loaded</span>
          <span v-else class="recording-open">Open</span>
        </button>
      </div>
    </article>

    <article v-if="detailLoading || selectedCapture" class="panel request-detail">
      <div v-if="detailLoading" class="loading-row"><var-loading size="small" /> Reading request</div>
      <template v-else-if="selectedCapture">
        <header class="panel-header">
          <div><h2>{{ selectedCapture.method }} {{ pathOf(selectedCapture) }}</h2><span class="panel-note mono">{{ selectedCapture.id }}</span></div>
          <div class="button-row">
            <var-button size="small" text @click="saveAsScenario">Save as scenario</var-button>
            <var-button size="small" text color="danger" @click="removeCapture">Move to trash</var-button>
          </div>
        </header>
        <div class="detail-body">
          <dl class="detail-list request-facts">
            <dt>Status</dt><dd>{{ selectedCapture.status || selectedCapture.outcome }}</dd>
            <dt>TTFB</dt><dd>{{ humanTime(selectedCapture.ttfbUs) }}</dd>
            <dt>Total</dt><dd>{{ humanTime(selectedCapture.durationUs) }}</dd>
            <dt>Upstream</dt><dd class="mono">{{ selectedCapture.upstreamUrl }}</dd>
          </dl>
          <div class="payload-grid">
            <details open><summary>Request</summary><pre class="code-block">{{ pretty(selectedCapture.request) }}</pre></details>
            <details open><summary>Response</summary><pre class="code-block">{{ pretty(parsedResponse(selectedCapture)) }}</pre></details>
          </div>
          <details><summary>Timing and raw capture</summary><pre class="code-block raw-block">{{ pretty(selectedCapture) }}</pre></details>
        </div>
      </template>
    </article>
  </section>
</template>

<style scoped>
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.page-error { margin-bottom: 16px; }
.recorder-page { width: min(1120px, 100%); }
.recorder { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(260px, 340px); gap: 24px; align-items: center; padding: 24px; }
.recorder.recording { border-color: color-mix(in srgb, var(--danger) 52%, var(--border)); background: color-mix(in srgb, var(--danger-soft) 30%, var(--surface)); }
.record-button { display: grid; width: 78px; height: 78px; place-items: center; border: 4px solid var(--danger); border-radius: 50%; background: var(--surface); color: var(--danger); box-shadow: 0 0 0 8px color-mix(in srgb, var(--danger) 13%, transparent); font-size: 31px; line-height: 1; }
.record-button:hover { transform: scale(1.03); }
.record-button.stop { background: var(--danger); color: #fff; }
.record-button.stop span { font-size: 21px; }
.record-button:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.recorder-copy h2 { margin: 5px 0 6px; font-size: 20px; letter-spacing: -.02em; }
.recorder-copy p { margin: 0; color: var(--muted); font-size: 11px; }
.source-field { align-self: stretch; justify-content: center; }
.queue-panel, .library-panel, .request-detail { margin-top: 18px; overflow: hidden; }
.queue-header > div:first-child { min-width: 0; }
.queue-header .panel-note { display: block; max-width: 520px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; }
.queue-status { display: flex; align-items: center; gap: 10px; }
.request-table { min-width: 620px; }
.request-table tr.consumed { opacity: .55; }
.request-table tr.next { background: var(--warning-soft); }
.request-index { width: 54px; color: var(--muted); font-variant-numeric: tabular-nums; }
.request-path { display: block; max-width: 640px; margin-top: 3px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recording-list { display: grid; }
.recording-row { display: grid; width: 100%; min-height: 66px; grid-template-columns: minmax(260px, 1.5fr) minmax(140px, .8fr) 110px 76px; align-items: center; gap: 18px; padding: 10px 18px; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: inherit; text-align: left; }
.recording-row:last-child { border-bottom: 0; }
.recording-row:hover, .recording-row.selected { background: var(--surface-soft); }
.recording-row > span:first-child { min-width: 0; }
.recording-row strong, .recording-row small { display: block; }
.recording-row small { margin-top: 5px; overflow: hidden; color: var(--muted); text-overflow: ellipsis; }
.recording-open { color: var(--accent-strong); font-weight: 700; }
.empty-state.compact { min-height: 90px; }
.detail-body { display: grid; gap: 18px; padding: 18px; }
.request-facts { grid-template-columns: 70px minmax(0, 1fr); }
.payload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
details { min-width: 0; }
summary { margin-bottom: 9px; color: var(--muted); cursor: pointer; font-size: 11px; font-weight: 700; }
.raw-block { max-height: 460px; }
@media (max-width: 900px) {
  .recorder { grid-template-columns: auto 1fr; }
  .source-field { grid-column: 1 / -1; }
  .payload-grid { grid-template-columns: 1fr; }
  .recording-row { grid-template-columns: 1fr auto; }
  .recording-row > span:nth-child(2), .recording-row > span:nth-child(3) { display: none; }
}
@media (max-width: 560px) {
  .recorder { grid-template-columns: 1fr; text-align: center; }
  .record-button { margin: 0 auto; }
  .source-field { text-align: left; }
  .queue-header { align-items: flex-start; flex-direction: column; }
}
</style>
