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
import type {
  CaptureDetail,
  CaptureSummary,
  Protocol,
  RecordingSummary,
  ReplayLoop,
  ReplayOrder,
} from '../types'

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
const sourceCaptureIds = ref<string[]>([])
const draggedPlaylistIndex = ref<number | null>(null)
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
    || recordings.value[0]
})
const shownRequests = computed(() => {
  const requests = shownRecording.value?.requests ?? []
  return runtime.state.mode === 'record' ? requests : requests.filter(isGenerationCapture)
})
const capturesById = computed(() => new Map(recordings.value.flatMap(
  (recording) => recording.requests.map((capture) => [capture.id, capture] as const),
)))
const playlistCaptures = computed(() => runtime.state.replayPlaylist.flatMap((entry) => {
  const recording = recordings.value.find((candidate) => candidate.id === entry)
  if (recording) return recording.requests.filter(isGenerationCapture)
  const capture = capturesById.value.get(entry)
  return capture && isGenerationCapture(capture) ? [capture] : []
}))
const currentReplayId = computed(() => runtime.state.replaySequence[runtime.state.replayPosition])
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

function recordingOf(capture: CaptureSummary): RecordingSummary | undefined {
  return recordings.value.find((recording) => recording.id === capture.recordingId
    || recording.requests.some((request) => request.id === capture.id))
}

function recordingInPlaylist(recording: RecordingSummary): boolean {
  const ids = recording.requests.filter(isGenerationCapture).map((capture) => capture.id)
  return runtime.state.replayPlaylist.includes(recording.id)
    || (ids.length > 0 && ids.every((id) => runtime.state.replayPlaylist.includes(id)))
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
    if (runtime.state.mode === 'record' && runtime.state.activeRecordingId) {
      selectedRecordingId.value = runtime.state.activeRecordingId
    } else if (!recordings.value.some((recording) => recording.id === selectedRecordingId.value)) {
      const firstEntry = runtime.state.replayPlaylist[0]
      selectedRecordingId.value = recordings.value.find((recording) => recording.id === firstEntry
        || recording.requests.some((capture) => capture.id === firstEntry))?.id
        || recordings.value[0]?.id
        || ''
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

async function updatePlaylist(ids: string[], patch: { replayOrder?: ReplayOrder; replayLoop?: ReplayLoop } = {}): Promise<void> {
  switching.value = true
  try {
    await runtime.update({ mode: 'replay', replayPlaylist: ids, ...patch })
    selectedCapture.value = null
    await refreshDeck()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not update replay playlist'
  } finally {
    switching.value = false
  }
}

function appendCaptures(captures: CaptureSummary[]): Promise<void> {
  const ids = captures.filter((capture) => !capture.partial && isGenerationCapture(capture)).map((capture) => capture.id)
  if (!ids.length) return Promise.resolve()
  return updatePlaylist([...playlistCaptures.value.map((capture) => capture.id), ...ids])
}

function appendRecording(recording: RecordingSummary): Promise<void> {
  selectedRecordingId.value = recording.id
  return appendCaptures(recording.requests)
}

function removePlaylistItem(index: number): Promise<void> {
  const ids = playlistCaptures.value.map((capture) => capture.id)
  ids.splice(index, 1)
  return updatePlaylist(ids)
}

function movePlaylistItem(from: number, to: number): Promise<void> {
  const ids = playlistCaptures.value.map((capture) => capture.id)
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length || from === to) return Promise.resolve()
  const [id] = ids.splice(from, 1)
  ids.splice(to, 0, id)
  return updatePlaylist(ids)
}

function clearPlaylist(): Promise<void> {
  return updatePlaylist([])
}

function restartPlayback(): Promise<void> {
  return updatePlaylist(playlistCaptures.value.map((capture) => capture.id))
}

function changeOrder(event: Event): Promise<void> {
  return updatePlaylist(
    playlistCaptures.value.map((capture) => capture.id),
    { replayOrder: (event.target as HTMLSelectElement).value as ReplayOrder },
  )
}

function changeLoop(event: Event): Promise<void> {
  return updatePlaylist(
    playlistCaptures.value.map((capture) => capture.id),
    { replayLoop: (event.target as HTMLSelectElement).value as ReplayLoop },
  )
}

function beginSourceDrag(captures: CaptureSummary[], event: DragEvent): void {
  sourceCaptureIds.value = captures.filter((capture) => !capture.partial && isGenerationCapture(capture)).map((capture) => capture.id)
  draggedPlaylistIndex.value = null
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
}

function beginPlaylistDrag(index: number, event: DragEvent): void {
  draggedPlaylistIndex.value = index
  sourceCaptureIds.value = []
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

async function dropOnPlaylist(): Promise<void> {
  if (draggedPlaylistIndex.value != null) {
    const ids = playlistCaptures.value.map((capture) => capture.id)
    const [id] = ids.splice(draggedPlaylistIndex.value, 1)
    ids.push(id)
    draggedPlaylistIndex.value = null
    await updatePlaylist(ids)
    return
  }
  if (!sourceCaptureIds.value.length) return
  const ids = [...playlistCaptures.value.map((capture) => capture.id), ...sourceCaptureIds.value]
  sourceCaptureIds.value = []
  await updatePlaylist(ids)
}

async function dropPlaylistAt(index: number): Promise<void> {
  const from = draggedPlaylistIndex.value
  const ids = playlistCaptures.value.map((capture) => capture.id)
  if (from == null) {
    if (!sourceCaptureIds.value.length) return
    ids.splice(index, 0, ...sourceCaptureIds.value)
    sourceCaptureIds.value = []
    await updatePlaylist(ids)
    return
  }
  if (from === index) return
  draggedPlaylistIndex.value = null
  await movePlaylistItem(from, index)
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

    <div v-if="error" class="message danger page-error" role="alert">{{ error }}</div>

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

    <article class="panel playlist-panel" @dragover.prevent @drop.prevent="dropOnPlaylist">
      <header class="panel-header playlist-header">
        <div>
          <h2>Replay playlist</h2>
          <span class="panel-note">{{ playlistCaptures.length }} request{{ playlistCaptures.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="playlist-controls">
          <label class="compact-field">
            <span>Order</span>
            <select :value="runtime.state.replayOrder" :disabled="switching" @change="changeOrder">
              <option value="sequential">Sequential</option>
              <option value="random">Shuffle</option>
            </select>
          </label>
          <label class="compact-field">
            <span>Repeat</span>
            <select :value="runtime.state.replayLoop" :disabled="switching" @change="changeLoop">
              <option value="none">Off</option>
              <option value="one">One</option>
              <option value="all">All</option>
            </select>
          </label>
          <var-button size="small" outline :disabled="switching || !playlistCaptures.length" @click="restartPlayback">Restart</var-button>
          <var-button size="small" text :disabled="switching || !playlistCaptures.length" @click="clearPlaylist">Clear</var-button>
        </div>
      </header>

      <div v-if="!playlistCaptures.length" class="playlist-empty">
        <strong>Drop recording requests here</strong>
        <span>Drag a recording or individual request below. Incoming API calls consume this list automatically.</span>
      </div>
      <div v-else class="table-scroll">
        <table class="data-table playlist-table">
          <thead><tr><th>#</th><th>Request</th><th>Recording</th><th>State</th><th></th></tr></thead>
          <tbody>
            <tr
              v-for="(capture, index) in playlistCaptures"
              :key="`${capture.id}-${index}`"
              draggable="true"
              tabindex="0"
              :class="{
                consumed: runtime.state.replayOrder === 'sequential' && index < runtime.state.replayPosition,
                next: capture.id === currentReplayId,
              }"
              @dragstart="beginPlaylistDrag(index, $event)"
              @dragover.prevent
              @drop.prevent.stop="dropPlaylistAt(index)"
              @keydown.up.prevent="movePlaylistItem(index, index - 1)"
              @keydown.down.prevent="movePlaylistItem(index, index + 1)"
            >
              <td class="request-index">{{ index + 1 }}</td>
              <td><strong>{{ capture.method || 'POST' }}</strong><span class="mono request-path">{{ pathOf(capture) }}</span></td>
              <td class="mono playlist-source">{{ recordingOf(capture)?.id || capture.recordingId || capture.id }}</td>
              <td>
                <span v-if="capture.id === currentReplayId" class="badge warning">Next</span>
                <span v-else-if="runtime.state.replayOrder === 'random'" class="panel-note">Shuffled</span>
                <span v-else-if="index < runtime.state.replayPosition" class="panel-note">Played</span>
                <span v-else class="panel-note">Queued</span>
              </td>
              <td><var-button size="small" text :disabled="switching" @click="removePlaylistItem(index)">Remove</var-button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="playlistCaptures.length" class="playlist-footer">
        <span>{{ runtime.state.replayPosition }}/{{ runtime.state.replayTotal }} served</span>
        <span v-if="runtime.state.replayOrder === 'random'">Shuffle creates a new order when playback starts.</span>
        <span v-if="runtime.state.replayLoop === 'one'">Repeat one keeps serving the current request.</span>
        <span v-else-if="runtime.state.replayLoop === 'all'">Repeat all restarts after the last request.</span>
      </footer>
    </article>

    <article class="panel queue-panel">
      <header class="panel-header queue-header">
        <div>
          <h2>{{ runtime.state.mode === 'record' ? 'Live requests' : 'Recording requests' }}</h2>
          <span v-if="shownRecording" class="panel-note mono">{{ shownRecording.id }}</span>
        </div>
        <div v-if="shownRecording" class="queue-status">
          <span v-if="runtime.state.mode === 'record'" class="badge danger">Live</span>
          <var-button v-else size="small" :loading="switching" :disabled="!replayRequestCount(shownRecording)" @click="appendRecording(shownRecording)">Add all</var-button>
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
          <thead><tr><th>#</th><th>Request</th><th>Response</th><th>Time</th><th></th></tr></thead>
          <tbody>
            <tr
              v-for="(capture, index) in shownRequests"
              :key="capture.id"
              :draggable="runtime.state.mode !== 'record' && !capture.partial && isGenerationCapture(capture)"
              :class="{ 'is-selected': selectedCapture?.id === capture.id }"
              @dragstart="beginSourceDrag([capture], $event)"
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
              <td><var-button v-if="runtime.state.mode !== 'record'" size="small" text :disabled="capture.partial" @click="appendCaptures([capture])">Add</var-button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>

    <article class="panel library-panel">
      <header class="panel-header"><h2>Recordings</h2><span class="panel-note">{{ recordings.length }} saved</span></header>
      <div v-if="!recordings.length" class="empty-state compact"><div>No saved recordings.</div></div>
      <div v-else class="recording-list">
        <div
          v-for="recording in recordings"
          :key="recording.id"
          class="recording-row"
          :class="{ selected: shownRecording?.id === recording.id }"
          :draggable="!recording.active && replayRequestCount(recording) > 0"
          @dragstart="beginSourceDrag(recording.requests, $event)"
        >
          <button class="recording-select" type="button" @click="selectedRecordingId = recording.id; selectedCapture = null">
            <span><strong>{{ new Date(recording.createdAt).toLocaleString() }}</strong><small class="mono">{{ recording.id }}</small></span>
            <span>{{ protocols[recording.protocol].label }}</span>
            <span>{{ recording.requestCount }} request{{ recording.requestCount === 1 ? '' : 's' }}</span>
          </button>
          <span v-if="recording.active" class="badge danger">Live</span>
          <span v-else-if="recordingInPlaylist(recording)" class="badge warning">Added</span>
          <var-button v-else size="small" text :disabled="!replayRequestCount(recording)" @click.stop="appendRecording(recording)">Add</var-button>
        </div>
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
.recorder.recording { border-color: var(--border-strong); }
/* deslop-ignore-next-line 19 -- The circular control follows the physical record-button convention. */
.record-button { display: grid; width: 72px; height: 72px; place-items: center; border: 2px solid var(--danger); border-radius: 50%; background: var(--surface); color: var(--danger); font-size: 28px; line-height: 1; }
.record-button.stop { background: var(--danger); color: #fff; }
.record-button.stop span { font-size: 21px; }
.record-button:disabled { opacity: .45; cursor: not-allowed; }
.recorder-copy h2 { margin: 5px 0 6px; font-size: 20px; letter-spacing: -.02em; }
.recorder-copy p { margin: 0; color: var(--muted); font-size: 11px; }
.source-field { align-self: stretch; justify-content: center; }
.playlist-panel, .queue-panel, .library-panel, .request-detail { margin-top: 18px; overflow: hidden; }
.playlist-header { align-items: flex-end; }
.playlist-header > div:first-child .panel-note { display: block; margin-top: 4px; }
.playlist-controls { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: flex-end; gap: 8px; }
.compact-field { display: grid; gap: 4px; color: var(--muted); font-size: 10px; }
.compact-field select { width: 112px; min-height: 31px; padding: 4px 8px; font-size: 11px; }
.playlist-empty { display: grid; min-height: 120px; place-content: center; gap: 5px; padding: 24px; color: var(--muted); text-align: center; }
.playlist-empty strong { color: var(--text); }
.playlist-table { min-width: 760px; }
.playlist-table tbody tr { cursor: grab; }
.playlist-table tr.consumed { opacity: .55; }
.playlist-table tr.next { background: var(--surface-soft); font-weight: 650; }
.playlist-source { max-width: 230px; overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.playlist-footer { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 10px 18px; border-top: 1px solid var(--border); color: var(--muted); font-size: 10px; }
.queue-header > div:first-child { min-width: 0; }
.queue-header .panel-note { display: block; max-width: 520px; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; }
.queue-status { display: flex; align-items: center; gap: 10px; }
.request-table { min-width: 620px; }
.request-index { width: 54px; color: var(--muted); font-variant-numeric: tabular-nums; }
.request-path { display: block; max-width: 640px; margin-top: 3px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recording-list { display: grid; }
.recording-row { display: grid; width: 100%; min-height: 66px; grid-template-columns: minmax(0, 1fr) 76px; align-items: center; gap: 18px; padding: 10px 18px; border-bottom: 1px solid var(--border); color: inherit; }
.recording-row { cursor: pointer; }
.recording-row:last-child { border-bottom: 0; }
.recording-row:hover, .recording-row.selected { background: var(--surface-soft); }
.recording-select { display: grid; min-width: 0; grid-template-columns: minmax(260px, 1.5fr) minmax(140px, .8fr) 110px; align-items: center; gap: 18px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.recording-select > span:first-child { min-width: 0; }
.recording-select strong, .recording-select small { display: block; }
.recording-select small { margin-top: 5px; overflow: hidden; color: var(--muted); text-overflow: ellipsis; }
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
  .recording-select { grid-template-columns: 1fr; }
  .recording-select > span:nth-child(2), .recording-select > span:nth-child(3) { display: none; }
}
@media (max-width: 560px) {
  .recorder { grid-template-columns: 1fr; text-align: center; }
  .record-button { margin: 0 auto; }
  .source-field { text-align: left; }
  .playlist-header, .queue-header { align-items: flex-start; flex-direction: column; }
  .playlist-controls { width: 100%; justify-content: flex-start; }
}
</style>
