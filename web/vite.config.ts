import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [vue()],
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/admin/api': 'http://127.0.0.1:3001',
    },
  },
})
