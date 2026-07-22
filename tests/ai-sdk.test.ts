import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { checkUpstream, resolveProviderBaseUrl } from '../src/ai-sdk.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })))
})

describe('AI SDK upstream probe', () => {
  it.each([
    ['openai-chat', 'https://example.com', 'https://example.com/v1'],
    ['openai-chat', 'https://example.com/v1/', 'https://example.com/v1'],
    ['openai-chat', 'https://example.com/prefix/v1/chat/completions', 'https://example.com/prefix/v1'],
    ['openai-responses', 'https://example.com/prefix', 'https://example.com/prefix/v1'],
    ['openai-responses', 'https://example.com/prefix/v1/responses', 'https://example.com/prefix/v1'],
    ['anthropic-messages', 'https://example.com', 'https://example.com/v1'],
    ['anthropic-messages', 'https://example.com/prefix/v1/messages', 'https://example.com/prefix/v1'],
  ] as const)('normalizes %s provider base %s', (protocol, baseUrl, expected) => {
    expect(resolveProviderBaseUrl(baseUrl, protocol)).toBe(expected)
  })

  it('uses the selected provider with a custom base URL and memory-only key', async () => {
    let path = ''
    let authorization = ''
    const server = createServer(async (request, response) => {
      path = request.url ?? ''
      authorization = request.headers.authorization ?? ''
      for await (const _chunk of request) {
        // Consume the provider request body.
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'chatcmpl-probe',
        object: 'chat.completion',
        created: 1,
        model: 'probe-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'OK' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    servers.push(server)
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Probe server did not bind')

    const result = await checkUpstream({
      protocol: 'openai-chat',
      baseUrl: `http://127.0.0.1:${address.port}`,
      model: 'probe-model',
      apiKey: 'temporary-probe-key',
      allowPrivateNetwork: true,
    })

    expect(result).toMatchObject({ text: 'OK' })
    expect(result.provider).toContain('openai')
    expect(path).toBe('/v1/chat/completions')
    expect(authorization).toBe('Bearer temporary-probe-key')
  })

  it('applies the private-network policy before sending the provider request', async () => {
    await expect(checkUpstream({
      protocol: 'openai-responses',
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'probe-model',
      apiKey: 'temporary-probe-key',
    })).rejects.toThrow('private or special-use')
  })
})
