<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { getBindings, getCaptures, getScenarios } from '../api'
import { useRuntimeStore } from '../stores/runtime'
import type { CaptureSummary, ReplayBinding, Scenario } from '../types'

const runtime = useRuntimeStore()
const captures = ref<CaptureSummary[]>([])
const scenarios = ref<Scenario[]>([])
const bindings = ref<ReplayBinding[]>([])
const loading = ref(true)
const error = ref('')
const protocolLabels = {
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}

const endpointRows = computed(() => [
  { protocol: 'openai-chat', path: '/v1/chat/completions', label: 'OpenAI Chat' },
  { protocol: 'openai-responses', path: '/v1/responses', label: 'OpenAI Responses' },
  { protocol: 'anthropic-messages', path: '/v1/messages', label: 'Anthropic Messages' },
].map((endpoint) => ({
  ...endpoint,
  enabled: runtime.state.enabledEndpoints.includes(endpoint.protocol as never),
  binding: bindings.value.find((item) => item.protocol === endpoint.protocol),
  recording: runtime.state.mode === 'record' && runtime.state.recordingProtocol === endpoint.protocol,
})))

function duration(value?: number): string {
  if (value == null) return '—'
  return value < 1000 ? `${value} µs` : `${(value / 1000).toFixed(value < 10000 ? 1 : 0)} ms`
}

async function load(): Promise<void> {
  loading.value = true
  try {
    ;[captures.value, scenarios.value, bindings.value] = await Promise.all([
      getCaptures(),
      getScenarios(),
      getBindings(),
    ])
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Dashboard data unavailable'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="page">
    <header class="page-heading">
      <div>
        <h1>Runtime overview</h1>
        <p>See which upstream is recording or which replay bindings are serving requests.</p>
      </div>
      <div class="heading-actions">
        <var-button outline :loading="loading" @click="load">Refresh</var-button>
        <router-link class="action-link primary" to="/test">Send a request</router-link>
      </div>
    </header>

    <div class="stats-grid" aria-label="Runtime statistics">
      <article class="stat-card">
        <span class="stat-label">Active requests</span>
        <strong>{{ runtime.state.activeRequests }}</strong>
        <small>using a fixed runtime snapshot</small>
      </article>
      <article class="stat-card">
        <span class="stat-label">Captures</span>
        <strong>{{ captures.length || runtime.state.captureCount }}</strong>
        <small>{{ runtime.state.partialCount }} partial file{{ runtime.state.partialCount === 1 ? '' : 's' }}</small>
      </article>
      <article class="stat-card">
        <span class="stat-label">Scenarios</span>
        <strong>{{ scenarios.length || runtime.state.scenarioCount }}</strong>
        <small>editable semantic responses</small>
      </article>
      <article class="stat-card">
        <span class="stat-label">Errors</span>
        <strong>{{ runtime.state.errorCount }}</strong>
        <small>in the current data directory</small>
      </article>
    </div>

    <div v-if="error" class="message danger" role="alert">{{ error }}</div>

    <div class="split-grid dashboard-grid">
      <article class="panel">
        <header class="panel-header">
          <h2>API endpoints</h2>
          <span class="badge" :class="runtime.state.mode === 'record' ? 'danger' : 'warning'">{{ runtime.state.mode === 'record' ? 'Recording' : 'Replay' }}</span>
        </header>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Endpoint</th><th>Binding</th><th>Source</th><th>Status</th></tr></thead>
            <tbody>
              <tr v-for="row in endpointRows" :key="row.protocol">
                <td>
                  <strong>{{ row.label }}</strong>
                  <div class="muted mono">{{ row.path }}</div>
                </td>
                <td>{{ runtime.state.mode === 'record' ? (row.recording ? 'Pass-through' : 'Paused') : row.binding?.stream ? 'Stream' : row.binding ? 'Non-stream' : '—' }}</td>
                <td class="truncate">{{ runtime.state.mode === 'record' ? (row.recording ? 'Selected upstream' : '—') : row.binding?.sourceTitle || row.binding?.sourceId || 'Built-in scenario' }}</td>
                <td><span class="badge" :class="row.enabled && (runtime.state.mode !== 'record' || row.recording) ? 'success' : 'danger'">{{ !row.enabled ? 'Disabled' : runtime.state.mode === 'record' ? (row.recording ? 'Recording' : 'Paused') : 'Ready' }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <header class="panel-header">
          <h2>Runtime</h2>
          <span class="badge info">rev {{ runtime.state.revision }}</span>
        </header>
        <div class="panel-body">
          <dl class="detail-list">
            <dt>Gateway state</dt><dd>{{ runtime.state.mode === 'record' ? `Recording · ${protocolLabels[runtime.state.recordingProtocol]}` : 'Replay' }}</dd>
            <dt>API listener</dt><dd class="mono">{{ runtime.state.apiBaseUrl }}</dd>
            <dt>Data directory</dt><dd class="mono">{{ runtime.state.dataDir }}</dd>
            <dt>Revision</dt><dd>{{ runtime.state.revision }}</dd>
          </dl>
          <div class="button-row runtime-links">
            <router-link class="action-link small" :to="runtime.state.mode === 'record' ? '/recordings' : '/replay'">Manage {{ runtime.state.mode === 'record' ? 'recording' : 'replay' }}</router-link>
            <router-link class="action-link small text" to="/settings">Runtime settings</router-link>
          </div>
        </div>
      </article>

      <article class="panel recent-panel">
        <header class="panel-header">
          <h2>Recent recordings</h2>
          <router-link class="panel-note" to="/recordings">View all →</router-link>
        </header>
        <div v-if="loading" class="loading-row"><var-loading size="small" /> Loading recordings</div>
        <div v-else-if="!captures.length" class="empty-state">
          <div><strong>No recordings yet</strong>Choose an upstream on the Recordings page, then start recording.</div>
        </div>
        <div v-else class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Request</th><th>Protocol</th><th>Outcome</th><th>TTFB</th><th>Total</th><th>Created</th></tr></thead>
            <tbody>
              <tr v-for="capture in captures.slice(0, 6)" :key="capture.id">
                <td><router-link :to="`/recordings?id=${capture.id}`" class="mono">{{ capture.id }}</router-link></td>
                <td>{{ capture.protocol }}</td>
                <td><span class="badge" :class="capture.outcome === 'complete' ? 'success' : 'danger'">{{ capture.outcome }}</span></td>
                <td>{{ duration(capture.ttfbUs) }}</td>
                <td>{{ duration(capture.durationUs) }}</td>
                <td class="nowrap">{{ new Date(capture.createdAt).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.dashboard-grid { align-items: start; }
.recent-panel { grid-column: 1 / -1; }
.runtime-links { margin-top: 20px; }
.panel-note { text-decoration: none; }
.muted { margin-top: 3px; font-size: 10px; }
@media (max-width: 1000px) { .recent-panel { grid-column: auto; } }
</style>
