import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { getRuntime, patchRuntime } from '../api'
import type { RuntimeMode, RuntimeState } from '../types'

const fallbackRuntime: RuntimeState = {
  mode: 'replay',
  recordingProtocol: 'openai-chat',
  activeRecordingId: '',
  replayRecordingId: '',
  replayPlaylist: [],
  replayOrder: 'sequential',
  replayLoop: 'none',
  replaySequence: [],
  replaySpeed: 1,
  replayPosition: 0,
  replayTotal: 0,
  revision: 0,
  activeRequests: 0,
  apiBaseUrl: 'http://127.0.0.1:3000',
  adminBaseUrl: 'http://127.0.0.1:3001',
  dataDir: '—',
  enabledEndpoints: ['openai-chat', 'openai-responses', 'anthropic-messages'],
  captureCount: 0,
  scenarioCount: 0,
  errorCount: 0,
  partialCount: 0,
  upstreams: [],
}

export const useRuntimeStore = defineStore('runtime', () => {
  const state = ref<RuntimeState>({ ...fallbackRuntime })
  const loading = ref(false)
  const error = ref('')
  const connected = computed(() => !error.value && state.value.revision > 0)

  async function refresh(): Promise<void> {
    if (loading.value) return
    loading.value = true
    try {
      state.value = { ...fallbackRuntime, ...(await getRuntime()) }
      error.value = ''
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Admin API unavailable'
    } finally {
      loading.value = false
    }
  }

  async function update(patch: Partial<RuntimeState>): Promise<void> {
    loading.value = true
    try {
      state.value = {
        ...fallbackRuntime,
        ...(await patchRuntime({ ...patch, revision: state.value.revision })),
      }
      error.value = ''
    } finally {
      loading.value = false
    }
  }

  function setMode(mode: RuntimeMode): Promise<void> {
    return update({ mode })
  }

  return { state, loading, error, connected, refresh, update, setMode }
})
