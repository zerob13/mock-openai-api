<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useRuntimeStore } from '../stores/runtime'
import type { Protocol } from '../types'

interface ReceivedChunk {
  seq: number
  atMs: number
  bytes: number
  text: string
}

const route = useRoute()
const runtime = useRuntimeStore()
const protocol = ref<Protocol>('openai-chat')
const model = ref('gpt-4o-mini')
const stream = ref(true)
const apiKey = ref('')
const keepKey = ref(false)
const headersText = ref('{}')
const bodyText = ref('')
const sending = ref(false)
const error = ref('')
const status = ref<number | null>(null)
const responseHeaders = ref<Record<string, string>>({})
const chunks = ref<ReceivedChunk[]>([])
const responseText = ref('')
const snippetType = ref<'curl' | 'sdk' | 'ai-sdk'>('curl')
let controller: AbortController | null = null

const endpoints: Record<Protocol, string> = {
  'openai-chat': '/v1/chat/completions',
  'openai-responses': '/v1/responses',
  'anthropic-messages': '/v1/messages',
}
const endpoint = computed(() => `${runtime.state.apiBaseUrl}${endpoints[protocol.value]}`)
const parsedEvents = computed(() => {
  const events: Array<{ event: string; data: string }> = []
  let eventName = 'message'
  let data: string[] = []
  for (const line of responseText.value.split(/\r?\n/)) {
    if (!line) {
      if (data.length) events.push({ event: eventName, data: data.join('\n') })
      eventName = 'message'
      data = []
    } else if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  if (data.length) events.push({ event: eventName, data: data.join('\n') })
  return events
})

const snippet = computed(() => {
  const body = bodyText.value || '{}'
  if (snippetType.value === 'curl') {
    const authHeaders = protocol.value === 'anthropic-messages'
      ? ["-H 'x-api-key: $API_KEY'", "-H 'anthropic-version: 2023-06-01'"]
      : ["-H 'Authorization: Bearer $API_KEY'"]
    return [
      `curl '${endpoint.value}'`,
      ...authHeaders.map((header) => `  ${header}`),
      "  -H 'content-type: application/json'",
      `  --data '${body.replaceAll("'", "'\\''")}'`,
    ].join(' \\\n')
  }
  if (snippetType.value === 'ai-sdk') {
    const factory = protocol.value === 'anthropic-messages' ? 'createAnthropic' : 'createOpenAI'
    const packageName = protocol.value === 'anthropic-messages' ? '@ai-sdk/anthropic' : '@ai-sdk/openai'
    const method = protocol.value === 'openai-chat' ? '.chat' : protocol.value === 'openai-responses' ? '.responses' : ''
    return `import { ${factory} } from '${packageName}'
import { streamText } from 'ai'

const provider = ${factory}({
  baseURL: '${runtime.state.apiBaseUrl}${protocol.value === 'anthropic-messages' ? '' : '/v1'}',
  apiKey: process.env.API_KEY,
})

const result = streamText({
  model: provider${method}('${model.value}'),
  prompt: 'Hello from the test console',
})

for await (const part of result.stream) console.log(part)`
  }
  if (protocol.value === 'anthropic-messages') {
    return `import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.API_KEY,
  baseURL: '${runtime.state.apiBaseUrl}',
})

const response = await client.messages.create(${body})`
  }
  const method = protocol.value === 'openai-chat' ? 'chat.completions.create' : 'responses.create'
  return `import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.API_KEY,
  baseURL: '${runtime.state.apiBaseUrl}/v1',
})

const response = await client.${method}(${body})`
})

watch([protocol, stream], resetBody)

function resetBody(): void {
  if (protocol.value === 'openai-responses') {
    model.value = 'gpt-4o-mini'
    bodyText.value = JSON.stringify({ model: model.value, input: 'Explain why deterministic replay helps testing.', stream: stream.value }, null, 2)
  } else if (protocol.value === 'anthropic-messages') {
    model.value = 'claude-3-5-sonnet-latest'
    bodyText.value = JSON.stringify({ model: model.value, max_tokens: 256, messages: [{ role: 'user', content: 'Explain why deterministic replay helps testing.' }], stream: stream.value }, null, 2)
  } else {
    model.value = 'gpt-4o-mini'
    bodyText.value = JSON.stringify({ model: model.value, messages: [{ role: 'user', content: 'Explain why deterministic replay helps testing.' }], stream: stream.value }, null, 2)
  }
}

function syncModel(): void {
  try {
    const body = JSON.parse(bodyText.value) as Record<string, unknown>
    body.model = model.value
    body.stream = stream.value
    bodyText.value = JSON.stringify(body, null, 2)
  } catch {
    // Raw JSON remains user-owned until Send validates it.
  }
}

async function send(): Promise<void> {
  let body: unknown
  let customHeaders: Record<string, string>
  try {
    body = JSON.parse(bodyText.value)
    customHeaders = JSON.parse(headersText.value) as Record<string, string>
    if (!customHeaders || Array.isArray(customHeaders) || typeof customHeaders !== 'object') throw new Error('Headers must be a JSON object')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Invalid request JSON'
    return
  }

  controller = new AbortController()
  sending.value = true
  error.value = ''
  status.value = null
  responseHeaders.value = {}
  chunks.value = []
  responseText.value = ''
  const startedAt = performance.now()

  try {
    const headers = new Headers(customHeaders)
    headers.set('content-type', 'application/json')
    if (apiKey.value) {
      if (protocol.value === 'anthropic-messages') {
        headers.set('x-api-key', apiKey.value)
        if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01')
      } else headers.set('authorization', `Bearer ${apiKey.value}`)
    }
    const response = await fetch(endpoint.value, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    status.value = response.status
    responseHeaders.value = Object.fromEntries(response.headers.entries())
    if (!response.body) {
      responseText.value = await response.text()
      return
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let seq = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      chunks.value.push({ seq: seq++, atMs: performance.now() - startedAt, bytes: value.byteLength, text })
      responseText.value += text
    }
    responseText.value += decoder.decode()
  } catch (cause) {
    error.value = cause instanceof DOMException && cause.name === 'AbortError'
      ? 'Request cancelled.'
      : cause instanceof Error ? cause.message : 'Request failed'
  } finally {
    sending.value = false
    controller = null
    if (!keepKey.value) apiKey.value = ''
  }
}

function stop(): void {
  controller?.abort()
}

onMounted(() => {
  const requestedProtocol = String(route.query.protocol || '') as Protocol
  if (Object.hasOwn(endpoints, requestedProtocol)) protocol.value = requestedProtocol
  if (route.query.stream === 'false') stream.value = false
  resetBody()
})
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>API Test</h1>
        <p>Send requests directly from this browser to the mock API listener. The key never passes through the Admin Control API.</p>
      </div>
      <div class="heading-actions">
        <var-button v-if="sending" outline color="danger" @click="stop">Cancel</var-button>
        <var-button :loading="sending" @click="send">Send request</var-button>
      </div>
    </header>

    <div v-if="error" class="callout danger page-error" role="alert">{{ error }}</div>

    <div class="test-layout">
      <article class="panel request-panel">
        <header class="panel-header"><h2>Request</h2><span class="badge info">browser → API :3000</span></header>
        <div class="panel-body request-form">
          <div class="request-presets">
            <label class="field"><span>Protocol</span><select v-model="protocol"><option value="openai-chat">OpenAI Chat</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
            <label class="field"><span>Model</span><input v-model="model" @change="syncModel" /></label>
            <label class="check-row"><input v-model="stream" type="checkbox" @change="syncModel" /> Stream response</label>
          </div>
          <label class="field"><span>Endpoint</span><input :value="endpoint" class="mono" readonly /></label>
          <div class="key-row">
            <label class="field"><span>API key</span><input v-model="apiKey" type="password" autocomplete="off" placeholder="Optional · held in memory only" /></label>
            <label class="check-row"><input v-model="keepKey" type="checkbox" /> Keep in memory after send</label>
          </div>
          <label class="field"><span>Additional headers (JSON)</span><textarea v-model="headersText" class="mono compact-textarea" rows="3" spellcheck="false"></textarea></label>
          <label class="field"><span>Request body (JSON)</span><textarea v-model="bodyText" class="mono body-editor" rows="17" spellcheck="false"></textarea></label>
        </div>
      </article>

      <article class="panel response-panel">
        <header class="panel-header">
          <h2>Response</h2>
          <div class="button-row">
            <span v-if="status != null" class="badge" :class="status < 400 ? 'success' : 'danger'">HTTP {{ status }}</span>
            <span v-if="chunks.length" class="badge plain">{{ chunks.length }} chunks</span>
          </div>
        </header>
        <div v-if="sending && !chunks.length" class="loading-row"><var-loading size="small" /> Waiting for first byte</div>
        <div v-else-if="status == null" class="empty-state"><div><strong>No response yet</strong>Edit any request field and press Send request.</div></div>
        <div v-else class="response-content">
          <div class="tab-list response-tabs" role="tablist">
            <span class="response-label">Raw response</span>
            <span>{{ parsedEvents.length }} SSE event{{ parsedEvents.length === 1 ? '' : 's' }}</span>
          </div>
          <pre class="code-block response-body">{{ responseText || '(empty body)' }}</pre>
          <details>
            <summary>Response headers</summary>
            <pre class="code-block">{{ JSON.stringify(responseHeaders, null, 2) }}</pre>
          </details>
          <details v-if="chunks.length" open>
            <summary>Browser chunk timeline</summary>
            <div class="table-scroll">
              <table class="data-table chunk-table">
                <thead><tr><th>#</th><th>Time</th><th>Bytes</th><th>Data</th></tr></thead>
                <tbody><tr v-for="chunk in chunks" :key="chunk.seq"><td>{{ chunk.seq }}</td><td class="mono">{{ chunk.atMs.toFixed(1) }} ms</td><td>{{ chunk.bytes }}</td><td class="mono chunk-data">{{ chunk.text }}</td></tr></tbody>
              </table>
            </div>
          </details>
          <details v-if="parsedEvents.length">
            <summary>Parsed SSE events</summary>
            <div class="table-scroll">
              <table class="data-table"><thead><tr><th>#</th><th>Event</th><th>Data</th></tr></thead><tbody><tr v-for="(event, index) in parsedEvents" :key="index"><td>{{ index }}</td><td class="mono">{{ event.event }}</td><td class="mono chunk-data">{{ event.data }}</td></tr></tbody></table>
            </div>
          </details>
        </div>
      </article>
    </div>

    <article class="panel snippets-panel">
      <header class="panel-header"><h2>Client example</h2><div class="tab-list" role="tablist"><button :aria-selected="snippetType === 'curl'" @click="snippetType = 'curl'">curl</button><button :aria-selected="snippetType === 'sdk'" @click="snippetType = 'sdk'">{{ protocol === 'anthropic-messages' ? 'Anthropic SDK' : 'OpenAI SDK' }}</button><button :aria-selected="snippetType === 'ai-sdk'" @click="snippetType = 'ai-sdk'">AI SDK</button></div></header>
      <div class="panel-body"><pre class="code-block">{{ snippet }}</pre></div>
    </article>
  </section>
</template>

<style scoped>
.page-error { margin-bottom: 14px; }
.test-layout { display: grid; grid-template-columns: minmax(390px, .85fr) minmax(480px, 1.15fr); gap: 16px; align-items: start; }
.request-form { display: grid; gap: 14px; }
.request-presets { display: grid; grid-template-columns: 1fr 1fr auto; gap: 9px; align-items: end; }
.key-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; }
.body-editor { min-height: 340px; }
.compact-textarea { min-height: 80px; }
.response-panel { min-width: 0; }
.response-content { display: grid; gap: 12px; padding: 14px; }
.response-tabs { align-items: center; justify-content: space-between; padding: 8px 10px; color: var(--muted); font-size: 10px; }
.response-label { color: var(--text); font-weight: 700; }
.response-body { min-height: 260px; max-height: 440px; white-space: pre-wrap; }
details { border-top: 1px solid var(--border); padding-top: 10px; }
summary { margin-bottom: 9px; color: var(--muted); font-size: 11px; font-weight: 650; cursor: pointer; }
.chunk-table { min-width: 560px; }
.chunk-data { max-width: 440px; white-space: pre-wrap; word-break: break-word; }
.snippets-panel { margin-top: 16px; }
@media (max-width: 1100px) { .test-layout { grid-template-columns: 1fr; } }
@media (max-width: 650px) {
  .request-presets, .key-row { grid-template-columns: 1fr; }
  .snippets-panel .panel-header { align-items: flex-start; flex-direction: column; }
}
</style>
