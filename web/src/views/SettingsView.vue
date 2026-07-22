<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { checkUpstream } from '../api'
import { useRuntimeStore } from '../stores/runtime'
import type { Protocol, UpstreamConfig } from '../types'

const runtime = useRuntimeStore()
const protocols: Array<{ id: Protocol; label: string; placeholder: string }> = [
  { id: 'openai-chat', label: 'OpenAI Chat Completions', placeholder: 'https://api.openai.com/v1' },
  { id: 'openai-responses', label: 'OpenAI Responses', placeholder: 'https://api.openai.com/v1' },
  { id: 'anthropic-messages', label: 'Anthropic Messages', placeholder: 'https://api.anthropic.com' },
]
const upstreams = ref<UpstreamConfig[]>([])
const enabledEndpoints = ref<Protocol[]>([])
const initialized = ref(false)
const saving = ref(false)
const checking = ref<Protocol | ''>('')
const error = ref('')
const success = ref('')

function populate(): void {
  upstreams.value = protocols.map(({ id }) => runtime.state.upstreams.find((item) => item.protocol === id) || {
    protocol: id,
    baseUrl: '',
    allowPrivateNetwork: false,
    status: 'unchecked',
  })
  enabledEndpoints.value = [...runtime.state.enabledEndpoints]
}

function toggleEndpoint(protocol: Protocol): void {
  const index = enabledEndpoints.value.indexOf(protocol)
  if (index >= 0) enabledEndpoints.value.splice(index, 1)
  else enabledEndpoints.value.push(protocol)
}

async function save(): Promise<void> {
  saving.value = true
  try {
    await runtime.update({
      enabledEndpoints: enabledEndpoints.value,
      upstreams: upstreams.value,
    })
    success.value = 'Runtime settings saved.'
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Settings update failed'
  } finally {
    saving.value = false
  }
}

async function verify(upstream: UpstreamConfig): Promise<void> {
  if (!upstream.baseUrl) {
    error.value = `Enter a base URL for ${upstream.protocol}.`
    return
  }
  checking.value = upstream.protocol
  try {
    const result = await checkUpstream(upstream)
    upstream.status = result.ok ? 'ready' : 'error'
    upstream.message = result.message || (result.latencyMs != null ? `${result.latencyMs} ms` : undefined)
    success.value = result.ok ? `${upstream.protocol} base URL is reachable.` : ''
    error.value = result.ok ? '' : (result.message || 'Upstream check failed')
  } catch (cause) {
    upstream.status = 'error'
    error.value = cause instanceof Error ? cause.message : 'Upstream check failed'
  } finally {
    checking.value = ''
  }
}

onMounted(async () => {
  try {
    await runtime.refresh()
  } finally {
    populate()
    initialized.value = true
  }
})
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>Settings</h1>
        <p>Configure non-secret runtime state. Client credentials remain pass-through and never appear in persisted settings.</p>
      </div>
      <div class="heading-actions"><var-button :disabled="!initialized" :loading="saving" @click="save">Save settings</var-button></div>
    </header>

    <div v-if="!initialized" class="loading-row"><var-loading size="small" /> Loading runtime settings</div>
    <div v-if="error" class="message danger page-message" role="alert">{{ error }}</div>
    <div v-else-if="success" class="message success page-message" role="status">{{ success }}</div>

    <article v-show="initialized" class="panel settings-section">
      <header class="panel-header">
        <div><h2>Upstream APIs</h2><span class="panel-note">Reachability checks send an unauthenticated HEAD request and never invoke a model.</span></div>
      </header>
      <div class="upstream-grid">
        <section v-for="(upstream, index) in upstreams" :key="upstream.protocol" class="upstream-card">
          <header>
            <div>
              <code class="protocol-id">{{ upstream.protocol }}</code>
              <h3>{{ protocols[index].label }}</h3>
            </div>
            <span class="badge" :class="upstream.status === 'ready' ? 'success' : upstream.status === 'error' ? 'danger' : 'plain'">{{ upstream.status || 'unchecked' }}</span>
          </header>
          <label class="field">
            <span>Base URL</span>
            <input v-model.trim="upstream.baseUrl" type="url" :placeholder="protocols[index].placeholder" spellcheck="false" />
            <small class="field-help">The gateway appends the protocol endpoint path exactly once.</small>
          </label>
          <p class="field-help auth-note">Client authentication headers pass through unchanged and are redacted only in the capture copy.</p>
          <label class="check-row"><input v-model="upstream.allowPrivateNetwork" type="checkbox" /> Allow private-network target</label>
          <p v-if="upstream.message" class="check-message">{{ upstream.message }}</p>
          <div class="button-row">
            <var-button size="small" outline :loading="checking === upstream.protocol" @click="verify(upstream)">Check connection</var-button>
          </div>
        </section>
      </div>
    </article>

    <article v-show="initialized" class="panel settings-section">
      <header class="panel-header"><h2>Runtime &amp; storage</h2><span class="panel-note">Revision {{ runtime.state.revision }}</span></header>
      <div class="panel-body settings-form runtime-settings">
        <label class="field"><span>Data directory</span><input :value="runtime.state.dataDir" class="mono" disabled /><small class="field-help">Set at process startup. The web console cannot browse arbitrary server paths.</small></label>
        <fieldset class="endpoint-options">
          <legend>Enabled API endpoints</legend>
          <label v-for="protocol in protocols" :key="protocol.id"><input type="checkbox" :checked="enabledEndpoints.includes(protocol.id)" @change="toggleEndpoint(protocol.id)" /> {{ protocol.label }}</label>
        </fieldset>
      </div>
    </article>
  </section>
</template>

<style scoped>
.page-message { margin-bottom: 14px; }
.settings-section { margin-bottom: 16px; }
.panel-header > div h2 { margin-bottom: 4px; }
.upstream-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; }
.upstream-card { display: grid; align-content: start; gap: 13px; min-width: 0; padding: 18px; border-right: 1px solid var(--border); }
.upstream-card:last-child { border-right: 0; }
.upstream-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.upstream-card h3 { margin: 5px 0 0; font-size: 13px; }
.protocol-id { color: var(--muted); font-size: 10px; }
.check-message { margin: -4px 0 0; color: var(--muted); font-size: 10px; }
.auth-note { margin: 0; }
.settings-form { display: grid; gap: 15px; }
.runtime-settings { grid-template-columns: minmax(0, 1.4fr) minmax(300px, .6fr); align-items: start; }
.endpoint-options { display: grid; gap: 9px; margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: 4px; }
.endpoint-options legend { padding: 0 4px; color: var(--muted); font-size: 10px; font-weight: 650; }
.endpoint-options label { display: flex; align-items: center; gap: 7px; font-size: 11px; }
.endpoint-options input { width: 15px; min-height: 15px; accent-color: var(--accent); }
@media (max-width: 1050px) {
  .upstream-grid { grid-template-columns: 1fr; }
  .upstream-card { border-right: 0; border-bottom: 1px solid var(--border); }
  .upstream-card:last-child { border-bottom: 0; }
}
@media (max-width: 720px) { .runtime-settings { grid-template-columns: 1fr; } }
</style>
