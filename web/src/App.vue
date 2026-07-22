<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useRuntimeStore } from './stores/runtime'

const runtime = useRuntimeStore()
const route = useRoute()
const dark = ref(localStorage.getItem('mock-console-theme') === 'dark' || (
  !localStorage.getItem('mock-console-theme') && matchMedia('(prefers-color-scheme: dark)').matches
))
let refreshTimer: number | undefined

const navigation = [
  { to: '/recordings', label: 'Recorder', short: 'Record' },
  { to: '/scenarios', label: 'Scenario Editor', short: 'Editor' },
  { to: '/test', label: 'API Test', short: 'Test' },
  { to: '/settings', label: 'Settings', short: 'Settings' },
]

const protocolLabels = {
  'openai-chat': 'OpenAI Chat',
  'openai-responses': 'OpenAI Responses',
  'anthropic-messages': 'Anthropic Messages',
}
const modeLabel = computed(() => runtime.state.mode === 'record'
  ? `Recording · ${protocolLabels[runtime.state.recordingProtocol]}`
  : runtime.state.replayRecordingId
    ? `Replay · ${runtime.state.replayPosition}/${runtime.state.replayTotal}`
    : 'Replay ready')

function applyTheme(): void {
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'
  localStorage.setItem('mock-console-theme', dark.value ? 'dark' : 'light')
}

function toggleTheme(): void {
  dark.value = !dark.value
  applyTheme()
}

onMounted(() => {
  applyTheme()
  void runtime.refresh()
  refreshTimer = window.setInterval(() => void runtime.refresh(), 5000)
})

onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <router-link class="brand" to="/recordings" aria-label="Mock OpenAI API recorder">
        <span>
          <strong>Mock OpenAI API</strong>
          <small>Record &amp; replay console</small>
        </span>
      </router-link>

      <div class="header-actions">
        <router-link class="mode-status" :class="`is-${runtime.state.mode}`" to="/recordings">
          <i aria-hidden="true"></i>{{ modeLabel }}
        </router-link>
        <span class="connection" :class="runtime.connected ? 'is-ready' : 'is-error'">
          <i aria-hidden="true"></i>
          {{ runtime.connected ? `API ${runtime.state.apiBaseUrl.replace(/^https?:\/\//, '')}` : 'Admin offline' }}
        </span>
        <button class="theme-button" type="button" :aria-label="dark ? 'Use light theme' : 'Use dark theme'" @click="toggleTheme">
          {{ dark ? 'Light' : 'Dark' }}
        </button>
      </div>
    </header>

    <aside class="app-sidebar" aria-label="Primary navigation">
      <nav>
        <router-link
          v-for="item in navigation"
          :key="item.to"
          :to="item.to"
          :aria-current="route.path === item.to ? 'page' : undefined"
        >
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-short">{{ item.short }}</span>
        </router-link>
      </nav>
    </aside>

    <main class="app-main">
      <div v-if="runtime.error" class="global-alert" role="alert">
        <strong>Control API unavailable.</strong>
        <span>{{ runtime.error }}</span>
        <var-button size="small" text @click="runtime.refresh">Retry</var-button>
      </div>
      <router-view />
    </main>

  </div>
</template>
