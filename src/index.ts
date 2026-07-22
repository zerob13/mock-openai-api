#!/usr/bin/env node

import { startServer } from './server.js'

global.verboseLogging = process.env.VERBOSE === 'true'

const servers = await startServer({
  apiHost: process.env.HOST,
  apiPort: process.env.PORT ? Number(process.env.PORT) : undefined,
  adminHost: process.env.ADMIN_HOST,
  adminPort: process.env.ADMIN_PORT ? Number(process.env.ADMIN_PORT) : undefined,
  dataDir: process.env.DATA_DIR,
  adminToken: process.env.ADMIN_TOKEN,
})

console.log(`Mock API: ${servers.apiUrl}`)
console.log(`Admin UI: ${servers.adminUrl}`)
console.log(`Data: ${servers.dataDir}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void servers.close().finally(() => process.exit(0))
  })
}
