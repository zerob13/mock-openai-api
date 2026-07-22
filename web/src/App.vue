<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useRuntimeStore } from './stores/runtime'
import type { RuntimeMode } from './types'

const runtime = useRuntimeStore()
const route = useRoute()
const dark = ref(localStorage.getItem('mock-console-theme') === 'dark' || (
  !localStorage.getItem('mock-console-theme') && matchMedia('(prefers-color-scheme: dark)').matches
))
let refreshTimer: number | undefined

const navigation = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: '⌂' },
  { to: '/recordings', label: 'Recordings', short: 'Files', icon: '◉' },
  { to: '/replay', label: 'Replay', short: 'Replay', icon: '▶' },
  { to: '/scenarios', label: 'Scenario Editor', short: 'Editor', icon: '✦' },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: '⚙' },
  { to: '/test', label: 'API Test', short: 'Test', icon: '↗' },
]

const modeLabel = computed(() => ({ builtin: 'Built-in', record: 'Record', replay: 'Replay' })[runtime.state.mode])

async function changeMode(event: Event): Promise<void> {
  const next = (event.target as HTMLSelectElement).value as RuntimeMode
  const previous = runtime.state.mode
  if (next === previous) return
  const message = next === 'record'
    ? 'Record mode forwards requests to configured upstreams and stores complete captures. Continue?'
    : `Switch all new requests to ${next} mode? Active requests keep their current mode.`
  if (!window.confirm(message)) {
    ;(event.target as HTMLSelectElement).value = previous
    return
  }
  try {
    await runtime.setMode(next)
  } catch (cause) {
    window.alert(cause instanceof Error ? cause.message : 'Mode update failed')
    ;(event.target as HTMLSelectElement).value = previous
  }
}

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
      <router-link class="brand" to="/" aria-label="Mock OpenAI API dashboard">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>
          <strong>Mock OpenAI API</strong>
          <small>Record &amp; replay console</small>
        </span>
      </router-link>

      <div class="header-actions">
        <label class="mode-control">
          <span>Mode</span>
          <select :value="runtime.state.mode" :disabled="runtime.loading" @change="changeMode">
            <option value="builtin">Built-in</option>
            <option value="record">Record</option>
            <option value="replay">Replay</option>
          </select>
        </label>
        <span class="connection" :class="runtime.connected ? 'is-ready' : 'is-error'">
          <i aria-hidden="true"></i>
          {{ runtime.connected ? `API ${runtime.state.apiBaseUrl.replace(/^https?:\/\//, '')}` : 'Admin offline' }}
        </span>
        <button class="icon-button" type="button" :aria-label="dark ? 'Use light theme' : 'Use dark theme'" @click="toggleTheme">
          {{ dark ? '☀' : '◐' }}
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
          <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
          <span class="nav-label">{{ item.label }}</span>
          <span class="nav-short">{{ item.short }}</span>
        </router-link>
      </nav>
      <div class="sidebar-mode">
        <span class="eyebrow">Current mode</span>
        <strong><i :class="`mode-dot mode-${runtime.state.mode}`"></i>{{ modeLabel }}</strong>
        <small>{{ runtime.state.activeRequests }} active request{{ runtime.state.activeRequests === 1 ? '' : 's' }}</small>
      </div>
    </aside>

    <main class="app-main">
      <div v-if="runtime.error" class="global-alert" role="alert">
        <strong>Control API unavailable.</strong>
        <span>{{ runtime.error }}</span>
        <var-button size="small" text @click="runtime.refresh">Retry</var-button>
      </div>
      <router-view />
    </main>

    <footer class="app-footer">
      <span>Data <code>{{ runtime.state.dataDir }}</code></span>
      <span>captures {{ runtime.state.captureCount }}</span>
      <span>partial {{ runtime.state.partialCount }}</span>
      <span>revision {{ runtime.state.revision }}</span>
    </footer>
  </div>
</template>
