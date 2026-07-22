import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('./views/DashboardView.vue') },
    { path: '/recordings', name: 'recordings', component: () => import('./views/RecordingsView.vue') },
    { path: '/replay', name: 'replay', component: () => import('./views/ReplayView.vue') },
    { path: '/scenarios', name: 'scenarios', component: () => import('./views/ScenarioEditorView.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') },
    { path: '/test', name: 'test', component: () => import('./views/TestView.vue') },
  ],
})
