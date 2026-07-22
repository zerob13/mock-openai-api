<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave, useRoute } from 'vue-router'
import { deleteScenario, getScenario, getScenarios, previewScenario, putScenario } from '../api'
import type { PreviewResult, Protocol, Scenario, ScenarioEvent, ScenarioEventType } from '../types'

type PaletteKind = 'text' | 'markdown' | 'tool' | 'usage' | 'finish' | 'error' | 'ping'

const protocols: Array<{ id: Protocol; label: string }> = [
  { id: 'openai-chat', label: 'OpenAI Chat' },
  { id: 'openai-responses', label: 'OpenAI Responses' },
  { id: 'anthropic-messages', label: 'Anthropic' },
]
const route = useRoute()

const scenarios = ref<Scenario[]>([])
const draft = ref<Scenario>(newScenario())
const savedSnapshot = ref('')
const selectedIndex = ref(0)
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const headersText = ref('{}')
const headersError = ref('')
const preview = ref<PreviewResult | null>(null)
const previewing = ref<Protocol | ''>('')
const previewProtocol = ref<Protocol>('openai-chat')
const draggedIndex = ref<number | null>(null)

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value)
const isBuiltin = computed(() => draft.value.source.kind === 'builtin')
const selectedEvent = computed(() => draft.value.timeline[selectedIndex.value])
const validationErrors = computed(() => validate(draft.value))
const previewText = computed(() => preview.value ? JSON.stringify(preview.value, null, 2) : 'Choose a protocol to compile this draft on the server.')

function newScenario(): Scenario {
  const id = `scn_${Date.now().toString(36)}`
  return {
    schema: 'mock-openai-api.scenario',
    kind: 'scenario',
    schemaVersion: 1,
    id,
    title: 'Untitled scenario',
    description: '',
    source: { kind: 'editor' },
    match: { protocols: ['openai-chat', 'openai-responses', 'anthropic-messages'], stream: true },
    response: { status: 200, headers: { 'cache-control': 'no-cache' } },
    timeline: [
      { type: 'message.start', atUs: 0, messageId: 'msg_1', role: 'assistant' },
      { type: 'text.start', atUs: 1000, textId: 'text_1', format: 'plain' },
      { type: 'text.delta', atUs: 10000, textId: 'text_1', format: 'plain', delta: 'Hello from the mock API.' },
      { type: 'text.end', atUs: 20000, textId: 'text_1' },
      { type: 'finish', atUs: 22000, reason: 'stop' },
    ],
  }
}

function validate(scenario: Scenario): string[] {
  const problems: string[] = []
  if (!scenario.id.trim()) problems.push('Scenario ID is required.')
  if (!scenario.title.trim()) problems.push('Title is required.')
  if (!Number.isInteger(scenario.response.status) || scenario.response.status < 100 || scenario.response.status > 599) problems.push('Response status must be 100–599.')
  if (!scenario.match.protocols.length) problems.push('Select at least one compatible protocol.')
  let previous = -1
  const toolIds = new Set<string>()
  const textIds = new Set<string>()
  let finishes = 0
  scenario.timeline.forEach((event, index) => {
    if (!Number.isInteger(event.atUs) || event.atUs < 0) problems.push(`Event ${index + 1} has an invalid timestamp.`)
    if (event.atUs < previous) problems.push(`Event ${index + 1} occurs before the previous event.`)
    previous = event.atUs
    if (event.type === 'tool.start' && event.toolCallId) toolIds.add(event.toolCallId)
    if ((event.type === 'tool.arguments.delta' || event.type === 'tool.end') && (!event.toolCallId || !toolIds.has(event.toolCallId))) problems.push(`Event ${index + 1} references an unknown tool call.`)
    if ((event.type === 'text.start' || event.type === 'text.delta') && event.textId) textIds.add(event.textId)
    if (event.type === 'text.end' && event.textId && !textIds.has(event.textId)) problems.push(`Event ${index + 1} references an unknown text block.`)
    if (event.type === 'finish') finishes += 1
  })
  if (finishes > 1) problems.push('Only one finish event is allowed.')
  if (!scenario.timeline.length) problems.push('Add at least one timeline event.')
  return [...new Set(problems)]
}

function uniqueId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}`
}

function add(kind: PaletteKind): void {
  if (kind === 'finish' || kind === 'error') {
    draft.value.timeline = draft.value.timeline.filter((event) => event.type !== 'finish' && event.type !== 'error')
  }
  if (kind === 'usage') {
    draft.value.timeline = draft.value.timeline.filter((event) => event.type !== 'usage')
  }
  const isContent = kind === 'text' || kind === 'markdown' || kind === 'tool' || kind === 'usage' || kind === 'ping'
  const insertIndex = isContent
    ? draft.value.timeline.findIndex((event) => event.type === 'usage' || event.type === 'finish' || event.type === 'error')
    : draft.value.timeline.length
  const targetIndex = insertIndex < 0 ? draft.value.timeline.length : insertIndex
  const start = (draft.value.timeline[targetIndex - 1]?.atUs ?? 0) + 10000
  let events: ScenarioEvent[] = []
  if (kind === 'text' || kind === 'markdown') {
    const textId = uniqueId('text')
    const format = kind === 'markdown' ? 'markdown' : 'plain'
    events = [
      { type: 'text.start', atUs: start, textId, format },
      { type: 'text.delta', atUs: start + 10000, textId, format, delta: kind === 'markdown' ? '**Markdown text**' : 'Text chunk' },
      { type: 'text.end', atUs: start + 20000, textId },
    ]
  } else if (kind === 'tool') {
    const toolCallId = uniqueId('call')
    events = [
      { type: 'tool.start', atUs: start, toolCallId, name: 'get_weather' },
      { type: 'tool.arguments.delta', atUs: start + 10000, toolCallId, delta: '{"city":"Shanghai"}' },
      { type: 'tool.end', atUs: start + 20000, toolCallId },
    ]
  } else if (kind === 'usage') {
    events = [{ type: 'usage', atUs: start, inputTokens: 12, outputTokens: 8, totalTokens: 20 }]
  } else if (kind === 'finish') {
    events = [{ type: 'finish', atUs: start, reason: 'stop' }]
  } else if (kind === 'error') {
    events = [{ type: 'error', atUs: start, code: 'mock_error', message: 'Simulated provider error' }]
  } else {
    events = [{ type: 'ping', atUs: start }]
  }
  const firstEditable = kind === 'text' || kind === 'markdown' || kind === 'tool' ? 1 : 0
  const eventEnd = events.at(-1)?.atUs ?? start
  const tail = draft.value.timeline.splice(targetIndex)
  if (tail.length && tail[0].atUs <= eventEnd) {
    const shift = eventEnd + 10000 - tail[0].atUs
    tail.forEach((event) => { event.atUs += shift })
  }
  selectedIndex.value = targetIndex + firstEditable
  draft.value.timeline.push(...events, ...tail)
}

function eventLabel(event: ScenarioEvent): string {
  if (event.type === 'text.delta') return event.delta || 'Empty text delta'
  if (event.type === 'tool.start') return `${event.name || 'unnamed'} · ${event.toolCallId || 'no ID'}`
  if (event.type === 'tool.arguments.delta') return event.delta || 'Empty arguments delta'
  if (event.type === 'usage') return `${event.inputTokens || 0} in · ${event.outputTokens || 0} out`
  if (event.type === 'finish') return event.reason || 'stop'
  if (event.type === 'error') return `${event.code || 'error'} · ${event.message || ''}`
  return event.textId || event.toolCallId || event.messageId || event.type
}

function normalizeAfterMove(): void {
  const times = draft.value.timeline.map((event) => event.atUs).sort((a, b) => a - b)
  draft.value.timeline.forEach((event, index) => { event.atUs = times[index] })
}

function move(from: number, to: number): void {
  if (to < 0 || to >= draft.value.timeline.length || from === to) return
  const [event] = draft.value.timeline.splice(from, 1)
  draft.value.timeline.splice(to, 0, event)
  normalizeAfterMove()
  selectedIndex.value = to
}

function removeEvent(): void {
  draft.value.timeline.splice(selectedIndex.value, 1)
  selectedIndex.value = Math.max(0, Math.min(selectedIndex.value, draft.value.timeline.length - 1))
}

function drop(index: number): void {
  if (draggedIndex.value != null) move(draggedIndex.value, index)
  draggedIndex.value = null
}

function toggleProtocol(protocol: Protocol): void {
  const index = draft.value.match.protocols.indexOf(protocol)
  if (index >= 0) draft.value.match.protocols.splice(index, 1)
  else draft.value.match.protocols.push(protocol)
}

function syncHeaders(): boolean {
  try {
    const parsed = JSON.parse(headersText.value) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Headers must be an object')
    draft.value.response.headers = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
    headersError.value = ''
    return true
  } catch (cause) {
    headersError.value = cause instanceof Error ? cause.message : 'Invalid headers JSON'
    return false
  }
}

function applyScenario(scenario: Scenario): void {
  draft.value = structuredClone(scenario)
  draft.value.response.headers ||= {}
  headersText.value = JSON.stringify(draft.value.response.headers || {}, null, 2)
  headersError.value = ''
  selectedIndex.value = 0
  preview.value = null
  savedSnapshot.value = JSON.stringify(draft.value)
}

async function loadList(selectId?: string): Promise<void> {
  loading.value = true
  try {
    scenarios.value = await getScenarios()
    const id = selectId || scenarios.value[0]?.id
    if (id) applyScenario(await getScenario(id))
    else applyScenario(newScenario())
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Scenarios unavailable'
  } finally {
    loading.value = false
  }
}

async function selectScenario(id: string): Promise<void> {
  if (dirty.value && !window.confirm('Discard unsaved scenario changes?')) return
  try {
    applyScenario(await getScenario(id))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load scenario'
  }
}

function createScenario(): void {
  if (dirty.value && !window.confirm('Discard unsaved scenario changes?')) return
  applyScenario(newScenario())
  savedSnapshot.value = ''
}

async function save(): Promise<void> {
  if (!syncHeaders() || validationErrors.value.length) return
  saving.value = true
  try {
    applyScenario(await putScenario(draft.value))
    scenarios.value = await getScenarios()
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Scenario save failed'
  } finally {
    saving.value = false
  }
}

async function removeScenario(): Promise<void> {
  if (!window.confirm(`Delete scenario ${draft.value.id}?`)) return
  try {
    await deleteScenario(draft.value.id)
    await loadList()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Scenario delete failed'
  }
}

async function compile(protocol: Protocol): Promise<void> {
  if (!syncHeaders() || validationErrors.value.length) return
  previewing.value = protocol
  previewProtocol.value = protocol
  try {
    preview.value = await previewScenario(protocol, draft.value)
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Preview failed'
  } finally {
    previewing.value = ''
  }
}

onBeforeRouteLeave(() => !dirty.value || window.confirm('Leave without saving this scenario?'))
onMounted(() => loadList(typeof route.query.id === 'string' ? route.query.id : undefined))
</script>

<template>
  <section class="page editor-page">
    <header class="page-heading editor-heading">
      <div>
        <h1>Scenario Editor <span v-if="dirty" class="dirty-mark" aria-label="Unsaved changes">●</span></h1>
        <p>Build a protocol-neutral response timeline, then compile it through the same server code used by replay.</p>
      </div>
      <div class="heading-actions">
        <var-button outline @click="createScenario">New scenario</var-button>
        <var-button text color="danger" :disabled="isBuiltin || !scenarios.some((item) => item.id === draft.id)" @click="removeScenario">Delete</var-button>
        <var-button :loading="saving" :disabled="isBuiltin || Boolean(validationErrors.length || headersError)" @click="save">Save scenario</var-button>
      </div>
    </header>

    <div v-if="error" class="message danger page-error" role="alert">{{ error }}</div>
    <div v-if="validationErrors.length" class="message warning validation-message" role="status">
      <strong>Draft needs attention:</strong> {{ validationErrors[0] }}<span v-if="validationErrors.length > 1"> (+{{ validationErrors.length - 1 }} more)</span>
    </div>

    <div class="editor-layout">
      <aside class="panel editor-sidebar">
        <header class="panel-header"><h2>Scenarios</h2><span class="panel-note">{{ scenarios.length }}</span></header>
        <div v-if="loading" class="loading-row"><var-loading size="small" /></div>
        <div v-else class="scenario-list">
          <button v-for="scenario in scenarios" :key="scenario.id" type="button" :class="{ active: scenario.id === draft.id }" @click="selectScenario(scenario.id)">
            <strong>{{ scenario.title }}</strong><small>{{ scenario.id }}</small>
          </button>
          <div v-if="!scenarios.length" class="empty-state scenario-empty"><div><strong>No saved scenarios</strong>Start with the draft.</div></div>
        </div>
        <div class="palette">
          <h3 class="palette-heading">Add response block</h3>
          <div class="palette-grid">
            <button type="button" @click="add('text')">Text</button>
            <button type="button" @click="add('markdown')">Markdown</button>
            <button type="button" @click="add('tool')">Tool call</button>
            <button type="button" @click="add('usage')">Usage</button>
            <button type="button" @click="add('finish')">Finish</button>
            <button type="button" @click="add('error')">Error</button>
            <button type="button" @click="add('ping')">Ping</button>
          </div>
        </div>
      </aside>

      <main class="panel timeline-panel">
        <header class="panel-header scenario-meta-header">
          <div class="scenario-title-fields">
            <label class="field"><span>Scenario name</span><input v-model="draft.title" /></label>
            <label class="field"><span>ID</span><input v-model="draft.id" class="mono" :disabled="scenarios.some((item) => item.id === draft.id)" /></label>
          </div>
        </header>
        <div class="meta-grid">
          <label class="field description-field"><span>Description</span><input v-model="draft.description" placeholder="What this response demonstrates" /></label>
          <label class="field"><span>Response status</span><input v-model.number="draft.response.status" type="number" min="100" max="599" /></label>
          <label class="check-row stream-check"><input v-model="draft.match.stream" type="checkbox" /> Streaming scenario</label>
          <fieldset class="protocol-checks">
            <legend>Compatible protocols</legend>
            <label v-for="protocol in protocols" :key="protocol.id"><input type="checkbox" :checked="draft.match.protocols.includes(protocol.id)" @change="toggleProtocol(protocol.id)" /> {{ protocol.label }}</label>
          </fieldset>
        </div>

        <div class="timeline-heading">
          <div><strong>Timeline</strong><span class="panel-note">{{ draft.timeline.length }} events</span></div>
          <span class="panel-note">Drag or use keyboard controls to reorder</span>
        </div>
        <ol class="timeline-list" aria-label="Scenario timeline">
          <li
            v-for="(event, index) in draft.timeline"
            :key="`${event.type}:${index}`"
            :class="{ selected: selectedIndex === index }"
            draggable="true"
            @dragstart="draggedIndex = index"
            @dragover.prevent
            @drop="drop(index)"
          >
            <button type="button" @click="selectedIndex = index">
              <span class="timeline-handle" aria-hidden="true">⠿</span>
              <time>{{ (event.atUs / 1000).toFixed(event.atUs % 1000 ? 1 : 0) }} ms</time>
              <span class="event-type">{{ event.type }}</span>
              <span class="event-value">{{ eventLabel(event) }}</span>
            </button>
          </li>
        </ol>
      </main>

      <aside class="panel properties-panel">
        <header class="panel-header"><h2>Properties</h2><code v-if="selectedEvent" class="panel-note">{{ selectedEvent.type }}</code></header>
        <div v-if="!selectedEvent" class="empty-state"><div><strong>No event selected</strong>Add or select a timeline event.</div></div>
        <div v-else class="properties-body">
          <label class="field"><span>Timestamp (µs)</span><input v-model.number="selectedEvent.atUs" type="number" min="0" step="1000" /></label>

          <template v-if="selectedEvent.type === 'message.start'">
            <label class="field"><span>Message ID</span><input v-model="selectedEvent.messageId" class="mono" /></label>
            <label class="field"><span>Role</span><select v-model="selectedEvent.role"><option value="assistant">Assistant</option></select></label>
          </template>
          <template v-else-if="selectedEvent.type.startsWith('text.')">
            <label class="field"><span>Text block ID</span><input v-model="selectedEvent.textId" class="mono" /></label>
            <label v-if="selectedEvent.type !== 'text.end'" class="field"><span>Format hint</span><select v-model="selectedEvent.format"><option value="plain">Plain text</option><option value="markdown">Markdown</option></select></label>
            <label v-if="selectedEvent.type === 'text.delta'" class="field"><span>Chunk text</span><textarea v-model="selectedEvent.delta" rows="7" placeholder="Exact delta text"></textarea></label>
            <div v-if="selectedEvent.type === 'text.delta' && selectedEvent.format === 'markdown'" class="markdown-preview"><span class="section-label">Markdown source preview</span><pre>{{ selectedEvent.delta }}</pre></div>
          </template>
          <template v-else-if="selectedEvent.type.startsWith('tool.')">
            <label class="field"><span>Tool call ID</span><input v-model="selectedEvent.toolCallId" class="mono" /></label>
            <label v-if="selectedEvent.type === 'tool.start'" class="field"><span>Function name</span><input v-model="selectedEvent.name" /></label>
            <label v-if="selectedEvent.type === 'tool.arguments.delta'" class="field"><span>Arguments fragment</span><textarea v-model="selectedEvent.delta" class="mono" rows="8" spellcheck="false"></textarea><small class="field-help">Fragments may be incomplete JSON. Target validation happens during Preview.</small></label>
          </template>
          <template v-else-if="selectedEvent.type === 'usage'">
            <label class="field"><span>Input tokens</span><input v-model.number="selectedEvent.inputTokens" type="number" min="0" /></label>
            <label class="field"><span>Output tokens</span><input v-model.number="selectedEvent.outputTokens" type="number" min="0" /></label>
            <label class="field"><span>Total tokens</span><input v-model.number="selectedEvent.totalTokens" type="number" min="0" /></label>
          </template>
          <template v-else-if="selectedEvent.type === 'finish'">
            <label class="field"><span>Finish reason</span><select v-model="selectedEvent.reason"><option value="stop">Stop</option><option value="length">Length</option><option value="tool">Tool</option><option value="error">Error</option></select></label>
          </template>
          <template v-else-if="selectedEvent.type === 'error'">
            <label class="field"><span>Error code</span><input v-model="selectedEvent.code" class="mono" /></label>
            <label class="field"><span>Message</span><textarea v-model="selectedEvent.message" rows="5"></textarea></label>
          </template>
          <p v-else-if="selectedEvent.type === 'ping'" class="field-help ping-note">Ping has no payload. Its timestamp controls when the keep-alive event is emitted.</p>

          <div class="event-actions">
            <var-button size="small" outline :disabled="selectedIndex === 0" @click="move(selectedIndex, selectedIndex - 1)">Move up</var-button>
            <var-button size="small" outline :disabled="selectedIndex >= draft.timeline.length - 1" @click="move(selectedIndex, selectedIndex + 1)">Move down</var-button>
            <var-button size="small" text color="danger" @click="removeEvent">Delete</var-button>
          </div>
        </div>
      </aside>
    </div>

    <article class="panel preview-panel">
      <header class="panel-header preview-header">
        <div><h2>Server preview</h2><span class="panel-note">The browser does not reimplement protocol encoders.</span></div>
        <div class="button-row">
          <var-button v-for="protocol in protocols" :key="protocol.id" size="small" :outline="previewProtocol !== protocol.id" :loading="previewing === protocol.id" :disabled="Boolean(validationErrors.length || headersError)" @click="compile(protocol.id)">{{ protocol.label }}</var-button>
        </div>
      </header>
      <div class="preview-grid">
        <label class="field headers-editor"><span>Response headers (JSON)</span><textarea v-model="headersText" class="mono" rows="7" spellcheck="false" @input="syncHeaders"></textarea><small v-if="headersError" class="error-text">{{ headersError }}</small></label>
        <pre class="code-block preview-output">{{ previewText }}</pre>
      </div>
    </article>
  </section>
</template>

<style scoped>
.dirty-mark { color: var(--warning); font-size: 10px; vertical-align: middle; }
.page-error, .validation-message { margin-bottom: 12px; }
.editor-layout { display: grid; grid-template-columns: 220px minmax(430px, 1fr) 300px; gap: 14px; align-items: start; }
.editor-sidebar, .properties-panel { position: sticky; top: 102px; max-height: calc(100vh - 150px); overflow: auto; }
.scenario-list { display: grid; gap: 4px; max-height: 220px; overflow: auto; padding: 8px; }
.scenario-list button { min-width: 0; padding: 10px; border: 1px solid transparent; border-radius: 4px; background: transparent; text-align: left; }
.scenario-list button:hover, .scenario-list button.active { border-color: var(--border); background: var(--surface-soft); }
.scenario-list strong, .scenario-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scenario-list strong { font-size: 11px; }
/* deslop-ignore-next-line 33 -- Scenario IDs are machine identifiers. */
.scenario-list small { margin-top: 4px; color: var(--muted); font-family: "SFMono-Regular", monospace; font-size: 9px; }
.scenario-empty { min-height: 110px; padding: 12px; font-size: 11px; }
.palette { padding: 14px; border-top: 1px solid var(--border); }
.palette-heading { margin: 0; font-size: 12px; }
.palette-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 9px; }
.palette-grid button { min-height: 34px; padding: 0 9px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--muted); font-size: 11px; text-align: left; }
.palette-grid button:hover { border-color: var(--border-strong); background: var(--surface-soft); color: var(--text); }
.scenario-meta-header { display: block; }
.scenario-title-fields { display: grid; grid-template-columns: 1.5fr 1fr; gap: 10px; width: 100%; }
.meta-grid { display: grid; grid-template-columns: minmax(0, 1fr) 110px auto; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.protocol-checks { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 14px; margin: 0; padding: 9px 11px; border: 1px solid var(--border); border-radius: 4px; }
.protocol-checks legend { padding: 0 4px; color: var(--muted); font-size: 10px; font-weight: 650; }
.protocol-checks label { display: flex; align-items: center; gap: 5px; color: var(--muted); font-size: 10px; }
.protocol-checks input { width: 14px; min-height: 14px; accent-color: var(--accent); }
.stream-check { align-self: end; }
.timeline-heading { display: flex; align-items: flex-end; justify-content: space-between; padding: 16px; }
.timeline-heading strong { display: inline; margin-right: 8px; font-size: 13px; }
.timeline-list { display: grid; gap: 5px; margin: 0; padding: 0 12px 16px; list-style: none; }
.timeline-list li { border: 1px solid var(--border); border-radius: 4px; background: var(--surface); }
.timeline-list li:hover, .timeline-list li.selected { border-color: var(--border-strong); background: var(--surface-soft); }
.timeline-list li button { display: grid; width: 100%; min-height: 43px; grid-template-columns: 18px 67px 135px minmax(0, 1fr); align-items: center; gap: 8px; padding: 7px 10px; border: 0; background: transparent; color: inherit; text-align: left; }
.timeline-handle { color: var(--faint); cursor: grab; }
/* deslop-ignore-next-line 33 -- Timeline offsets are machine timing data. */
.timeline-list time { color: var(--muted); font-family: "SFMono-Regular", monospace; font-size: 9px; }
/* deslop-ignore-next-line 33 -- Event types are protocol identifiers. */
.event-type { font-family: "SFMono-Regular", monospace; font-size: 10px; font-weight: 700; }
.event-value { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.properties-body { display: grid; gap: 13px; padding: 15px; }
.ping-note { margin: 0; }
.event-actions { display: flex; flex-wrap: wrap; gap: 5px; padding-top: 5px; border-top: 1px solid var(--border); }
.markdown-preview { display: grid; gap: 6px; }
.markdown-preview pre { min-height: 60px; margin: 0; padding: 10px; border-radius: 4px; background: var(--surface-soft); white-space: pre-wrap; }
.preview-panel { margin-top: 14px; }
.preview-header > div:first-child h2 { margin-bottom: 4px; }
.preview-grid { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 14px; padding: 16px; }
.preview-output { max-height: 350px; }
@media (max-width: 1240px) {
  .editor-layout { grid-template-columns: 200px minmax(420px, 1fr); }
  .properties-panel { position: static; grid-column: 1 / -1; max-height: none; }
}
@media (max-width: 850px) {
  .editor-layout { grid-template-columns: 1fr; }
  .editor-sidebar { position: static; max-height: none; }
  .properties-panel { grid-column: auto; }
  .preview-grid { grid-template-columns: 1fr; }
  .preview-header { align-items: flex-start; flex-direction: column; }
}
@media (max-width: 570px) {
  .scenario-title-fields, .meta-grid { grid-template-columns: 1fr; }
  .protocol-checks { grid-column: auto; }
  .timeline-list li button { grid-template-columns: 16px 58px minmax(100px, .7fr) 1fr; }
}
</style>
