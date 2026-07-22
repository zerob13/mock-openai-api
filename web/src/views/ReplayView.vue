<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getBindings, getCaptures, getScenarios, putBinding } from '../api'
import { useRuntimeStore } from '../stores/runtime'
import type { CaptureSummary, Protocol, ReplayBinding, Scenario } from '../types'

const router = useRouter()
const route = useRoute()
const runtime = useRuntimeStore()
const captures = ref<CaptureSummary[]>([])
const scenarios = ref<Scenario[]>([])
const bindings = ref<ReplayBinding[]>([])
const loading = ref(true)
const saving = ref(false)
const activating = ref(false)
const error = ref('')
const copied = ref(false)
const form = ref({
  protocol: 'openai-chat' as Protocol,
  stream: true,
  speed: '1' as string,
  sourceType: 'scenario' as 'capture' | 'scenario',
  sourceId: '',
})

const endpoints: Record<Protocol, string> = {
  'openai-chat': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'anthropic-messages': '/v1/messages',
}

const sourceOptions = computed(() => form.value.sourceType === 'capture'
  ? captures.value.map((capture) => ({
      id: capture.id,
      title: capture.title || capture.id,
      protocol: capture.protocol,
      exact: capture.protocol === form.value.protocol
        && Boolean(capture.stream) === form.value.stream
        && captureMatchesEndpoint(capture.downstreamUrl, form.value.protocol)
        && capture.outcome === 'complete'
        && capture.bodyExact === true
        && capture.valid !== false
        && !capture.partial
        && (form.value.speed === 'instant' || capture.timingReplayable === true),
      timingReplayable: capture.timingReplayable === true,
      includeUsage: capture.includeUsage === true,
    }))
  : scenarios.value.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      protocol: scenario.source.protocol,
      exact: false,
    })))

const selectedSource = computed(() => sourceOptions.value.find((item) => item.id === form.value.sourceId))
const exactReplay = computed(() => form.value.sourceType === 'capture' && Boolean(selectedSource.value?.exact))
const endpoint = computed(() => `${runtime.state.apiBaseUrl}${endpoints[form.value.protocol]}`)
const diagnostics = computed(() => {
  if (!selectedSource.value) return ['Select a source before activating this binding.']
  if (exactReplay.value) return []
  if (form.value.sourceType === 'capture') return [
    'This capture requires semantic transcoding; raw bytes and provider-specific extensions are not preserved.',
  ]
  if (selectedSource.value.protocol && selectedSource.value.protocol !== form.value.protocol) return [
    `Source semantics are converted from ${selectedSource.value.protocol} to ${form.value.protocol}.`,
    'Stop reasons and provider-specific usage details may be normalized.',
  ]
  return ['Scenario replay is semantic, not a byte-exact capture replay.']
})

function captureMatchesEndpoint(url: string | undefined, protocol: Protocol): boolean {
  if (!url) return false
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '')
    return pathname === endpoints[protocol]
      || (protocol === 'openai-chat' && pathname === '/chat/completions')
  } catch {
    return false
  }
}

watch(() => [form.value.sourceType, form.value.protocol, form.value.stream], () => {
  if (!sourceOptions.value.some((item) => item.id === form.value.sourceId)) {
    form.value.sourceId = sourceOptions.value[0]?.id || ''
  }
})

async function load(): Promise<void> {
  loading.value = true
  try {
    ;[captures.value, scenarios.value, bindings.value] = await Promise.all([
      getCaptures(),
      getScenarios(),
      getBindings(),
    ])
    const current = bindings.value.find((item) => item.protocol === form.value.protocol && item.stream === form.value.stream)
    if (current) {
      form.value.sourceType = current.sourceType
      form.value.sourceId = current.sourceId
      form.value.speed = String(current.speed)
    } else {
      form.value.sourceId = sourceOptions.value[0]?.id || ''
    }
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Replay data unavailable'
  } finally {
    loading.value = false
  }
}

async function save(): Promise<void> {
  if (!form.value.sourceId) return
  saving.value = true
  try {
    const binding: ReplayBinding = {
      protocol: form.value.protocol,
      stream: form.value.stream,
      sourceType: form.value.sourceType,
      sourceId: form.value.sourceId,
      speed: form.value.speed === 'instant' ? 'instant' : Number(form.value.speed),
      diagnostics: diagnostics.value,
    }
    bindings.value = await putBinding(binding)
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Binding update failed'
  } finally {
    saving.value = false
  }
}

async function copyEndpoint(): Promise<void> {
  await navigator.clipboard.writeText(endpoint.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1500)
}

function testEndpoint(): void {
  void router.push({ name: 'test', query: { protocol: form.value.protocol, stream: String(form.value.stream) } })
}

async function activateReplay(): Promise<void> {
  activating.value = true
  try {
    await runtime.refresh()
    if (runtime.state.mode !== 'replay') await runtime.setMode('replay')
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not activate replay'
  } finally {
    activating.value = false
  }
}

onMounted(async () => {
  await runtime.refresh()
  await load()
  const protocol = route.query.protocol
  if (protocol === 'openai-chat' || protocol === 'openai-responses' || protocol === 'anthropic-messages') {
    form.value.protocol = protocol
  }
  if (route.query.stream === 'true' || route.query.stream === 'false') {
    form.value.stream = route.query.stream === 'true'
  }
  if (route.query.sourceType === 'capture') form.value.sourceType = 'capture'
  if (typeof route.query.sourceId === 'string'
    && sourceOptions.value.some((source) => source.id === route.query.sourceId)) {
    form.value.sourceId = route.query.sourceId
  }
})
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>Replay bindings</h1>
        <p>Choose exactly what each protocol endpoint returns. Raw captures retain recorded bytes and timing; scenarios can be transcoded.</p>
      </div>
      <div class="heading-actions"><var-button outline :loading="loading" @click="load">Refresh</var-button></div>
    </header>

    <div v-if="error" class="callout danger page-error" role="alert">{{ error }}</div>

    <article class="panel replay-mode-panel" :class="{ active: runtime.state.mode === 'replay' }">
      <div>
        <span class="eyebrow">Replay mode</span>
        <h2>{{ runtime.state.mode === 'replay' ? 'Replay is serving active bindings' : 'Recording is currently active' }}</h2>
        <p>Built-in examples are regular replay scenarios and can be replaced by a capture or an edited scenario below.</p>
      </div>
      <span v-if="runtime.state.mode === 'replay'" class="badge success">Active</span>
      <var-button v-else :loading="activating" @click="activateReplay">Use replay mode</var-button>
    </article>

    <article class="panel binding-builder">
      <header class="panel-header">
        <h2>Configure active response</h2>
        <span class="badge" :class="exactReplay ? 'success' : 'warning'">{{ exactReplay ? 'Body exact' : 'Transcoded' }}</span>
      </header>
      <div class="binding-controls">
        <label class="field">
          <span>Target protocol</span>
          <select v-model="form.protocol">
            <option value="openai-chat">OpenAI Chat</option>
            <option value="openai-responses">OpenAI Responses</option>
            <option value="anthropic-messages">Anthropic Messages</option>
          </select>
        </label>
        <label class="field">
          <span>Transport</span>
          <select v-model="form.stream">
            <option :value="true">Streaming</option>
            <option :value="false">Non-streaming</option>
          </select>
        </label>
        <label class="field">
          <span>Playback speed</span>
          <select v-model="form.speed">
            <option value="instant">Instant</option>
            <option value="2">2×</option>
            <option value="1">Recorded 1×</option>
            <option value="0.5">0.5×</option>
          </select>
        </label>
      </div>

      <div class="source-grid">
        <div class="source-column">
          <span class="eyebrow">Source type</span>
          <div class="segmented" role="radiogroup" aria-label="Replay source type">
            <label :class="{ active: form.sourceType === 'capture' }"><input v-model="form.sourceType" type="radio" value="capture" /> Raw capture</label>
            <label :class="{ active: form.sourceType === 'scenario' }"><input v-model="form.sourceType" type="radio" value="scenario" /> Scenario</label>
          </div>
          <div v-if="!sourceOptions.length" class="empty-state source-empty">
            <div><strong>No {{ form.sourceType }} sources</strong>{{ form.sourceType === 'capture' ? 'Record or import one first.' : 'Create one in Scenario Editor.' }}</div>
          </div>
          <div v-else class="source-list" role="radiogroup" aria-label="Replay sources">
            <label v-for="source in sourceOptions" :key="source.id" :class="{ selected: form.sourceId === source.id }">
              <input v-model="form.sourceId" type="radio" :value="source.id" />
              <span>
                <strong>{{ source.title }}</strong>
                <small>{{ source.id }}</small>
              </span>
              <span class="badge plain" :class="source.exact ? 'success' : 'warning'">{{ source.exact ? 'Exact' : 'Semantic' }}</span>
            </label>
          </div>
        </div>

        <div class="compatibility-column">
          <span class="eyebrow">Compatibility</span>
          <div v-if="exactReplay" class="compatibility-card exact-card">
            <strong>✓ Body Exact · {{ form.speed === 'instant' ? 'Instant' : 'Recorded Timing' }}</strong>
            <p>Response entity bytes are replayed unchanged. The request must use the recorded stream and include_usage options.</p>
          </div>
          <div v-else class="compatibility-card warning-card">
            <strong>Semantic replay</strong>
            <p>Core text, tool calls, usage, finish state, and errors are compiled for the target protocol.</p>
          </div>
          <ul v-if="diagnostics.length" class="diagnostics">
            <li v-for="diagnostic in diagnostics" :key="diagnostic">{{ diagnostic }}</li>
          </ul>
          <div v-else class="compatibility-list">
            <span>✓ Headers</span><span>✓ Body bytes</span><span>✓ Chunk timing</span><span>✓ Termination</span>
          </div>
        </div>
      </div>

      <footer class="endpoint-bar">
        <div>
          <span class="eyebrow">Endpoint</span>
          <code>{{ endpoint }}</code>
        </div>
        <div class="button-row">
          <var-button size="small" text @click="copyEndpoint">{{ copied ? 'Copied' : 'Copy' }}</var-button>
          <var-button size="small" outline @click="testEndpoint">Test</var-button>
          <var-button size="small" :disabled="!form.sourceId" :loading="saving" @click="save">Activate binding</var-button>
        </div>
      </footer>
    </article>

    <article class="panel active-bindings">
      <header class="panel-header"><h2>Active bindings</h2><span class="panel-note">{{ bindings.length }} configured</span></header>
      <div v-if="!bindings.length" class="empty-state"><div><strong>No explicit bindings</strong>Endpoints use their built-in defaults.</div></div>
      <div v-else class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Protocol</th><th>Transport</th><th>Source</th><th>Speed</th><th>Fidelity</th></tr></thead>
          <tbody>
            <tr v-for="binding in bindings" :key="`${binding.protocol}:${binding.stream}`">
              <td>{{ binding.protocol }}</td>
              <td>{{ binding.stream ? 'Streaming' : 'Non-streaming' }}</td>
              <td><strong>{{ binding.sourceTitle || binding.sourceId }}</strong><div class="muted mono">{{ binding.sourceType }}</div></td>
              <td>{{ binding.speed === 'instant' ? 'Instant' : `${binding.speed}×` }}</td>
              <td><span class="badge" :class="binding.sourceType === 'capture' && binding.compatible !== false ? 'success' : 'warning'">{{ binding.sourceType === 'capture' && binding.compatible !== false ? 'Exact' : 'Transcoded' }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
</template>

<style scoped>
.page-error { margin-bottom: 16px; }
.replay-mode-panel { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 18px; padding: 18px; border-left: 5px solid var(--warning); }
.replay-mode-panel.active { background: color-mix(in srgb, var(--warning-soft) 38%, var(--surface)); }
.replay-mode-panel h2 { margin: 5px 0 4px; font-size: 17px; }
.replay-mode-panel p { margin: 0; color: var(--muted); font-size: 11px; line-height: 1.5; }
.binding-builder { overflow: hidden; }
.binding-controls { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding: 18px; border-bottom: 1px solid var(--border); }
.source-grid { display: grid; grid-template-columns: 1.08fr .92fr; min-height: 320px; }
.source-column, .compatibility-column { min-width: 0; padding: 20px; }
.source-column { border-right: 1px solid var(--border); }
.segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 9px 0 14px; padding: 4px; border-radius: 9px; background: var(--surface-soft); }
.segmented label { padding: 8px 10px; border-radius: 6px; color: var(--muted); font-size: 11px; font-weight: 650; text-align: center; cursor: pointer; }
.segmented label.active { background: var(--surface); color: var(--text); box-shadow: 0 1px 5px rgba(0,0,0,.08); }
.segmented input { position: absolute; width: 1px; min-height: 1px; opacity: 0; }
.source-list { display: grid; gap: 7px; max-height: 290px; overflow: auto; }
.source-list label { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px; border: 1px solid var(--border); border-radius: 9px; cursor: pointer; }
.source-list label:hover, .source-list label.selected { border-color: var(--accent); background: var(--accent-soft); }
.source-list input { width: 15px; min-height: 15px; accent-color: var(--accent); }
.source-list strong, .source-list small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.source-list strong { font-size: 12px; }
.source-list small { margin-top: 3px; color: var(--muted); font-family: "SFMono-Regular", monospace; font-size: 9px; }
.source-empty { min-height: 170px; }
.compatibility-column { background: var(--surface-soft); }
.compatibility-card { margin-top: 9px; padding: 17px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.compatibility-card strong { font-size: 13px; }
.compatibility-card p { margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55; }
.exact-card { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
.warning-card { border-color: color-mix(in srgb, var(--warning) 50%, var(--border)); }
.diagnostics { margin: 15px 0 0; padding-left: 17px; color: var(--warning); font-size: 11px; line-height: 1.55; }
.compatibility-list { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; color: var(--accent-strong); font-size: 11px; }
.endpoint-bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 15px 18px; border-top: 1px solid var(--border); }
.endpoint-bar code { display: block; margin-top: 5px; font-size: 11px; word-break: break-all; }
.active-bindings { margin-top: 18px; }
.muted { margin-top: 3px; font-size: 9px; }
@media (max-width: 900px) {
  .source-grid { grid-template-columns: 1fr; }
  .source-column { border: 0; border-bottom: 1px solid var(--border); }
}
@media (max-width: 620px) {
  .binding-controls { grid-template-columns: 1fr; }
  .endpoint-bar { align-items: stretch; flex-direction: column; }
}
</style>
