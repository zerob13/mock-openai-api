#!/usr/bin/env node

import { createRequire } from 'node:module'
import { Command, InvalidArgumentError } from 'commander'
import { startServer } from './server.js'

const require = createRequire(import.meta.url)
let version: string
try {
  version = (require('../package.json') as { version: string }).version
} catch {
  version = (require('../../package.json') as { version: string }).version
}

function port(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new InvalidArgumentError('Port must be between 0 and 65535')
  return parsed
}

const program = new Command()
  .name('mock-openai-api')
  .description('Record, inspect, and replay OpenAI and Anthropic API traffic')
  .version(version)
  .option('-p, --port <number>', 'Mock API port', port, 3000)
  .option('-H, --host <address>', 'Mock API host', '0.0.0.0')
  .option('--admin-port <number>', 'Admin UI port', port, 3001)
  .option('--admin-host <address>', 'Admin UI host', '127.0.0.1')
  .option('-d, --data-dir <path>', 'Capture and scenario directory', '.mock-openai-api')
  .option('--admin-token <token>', 'Admin API bearer token (kept in memory only)')
  .option('-v, --verbose', 'Enable request diagnostics', false)
  .parse()

const options = program.opts<{
  port: number
  host: string
  adminPort: number
  adminHost: string
  dataDir: string
  adminToken?: string
  verbose: boolean
}>()

global.verboseLogging = options.verbose
const servers = await startServer({
  apiHost: options.host,
  apiPort: options.port,
  adminHost: options.adminHost,
  adminPort: options.adminPort,
  dataDir: options.dataDir,
  adminToken: options.adminToken,
})

console.log(`Mock API: ${servers.apiUrl}`)
console.log(`Admin UI: ${servers.adminUrl}`)
console.log(`Data: ${servers.dataDir}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void servers.close().finally(() => process.exit(0))
  })
}
