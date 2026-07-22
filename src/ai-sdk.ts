import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { createSecureFetch, parseUpstreamBaseUrl } from './network.js'
import type { GatewayProtocol } from './runtime.js'

export interface UpstreamCheckInput {
  protocol: GatewayProtocol
  baseUrl: string
  model: string
  apiKey: string
  auth?: 'api-key' | 'bearer'
  allowPrivateNetwork?: boolean
}

const PROVIDER_RESOURCES: Record<GatewayProtocol, string> = {
  'openai-chat': '/chat/completions',
  'openai-responses': '/responses',
  'anthropic-messages': '/messages',
}

export function resolveProviderBaseUrl(baseUrl: string, protocol: GatewayProtocol): string {
  const url = parseUpstreamBaseUrl(baseUrl)
  const resource = PROVIDER_RESOURCES[protocol]
  const pathname = url.pathname.replace(/\/+$/, '')
  const endpoint = `/v1${resource}`

  if (pathname.endsWith(endpoint)) {
    url.pathname = pathname.slice(0, -resource.length)
  } else if (pathname.endsWith('/v1')) {
    url.pathname = pathname
  } else {
    url.pathname = `${pathname}/v1`.replace(/\/{2,}/g, '/')
  }
  return url.toString()
}

export async function checkUpstream(input: UpstreamCheckInput): Promise<{ text: string; provider: string }> {
  if (!input.baseUrl || !input.model || !input.apiKey) {
    throw new Error('baseUrl, model, and apiKey are required')
  }

  try {
    const baseURL = resolveProviderBaseUrl(input.baseUrl, input.protocol)
    const providerFetch = createSecureFetch(input.allowPrivateNetwork === true)
    const model = input.protocol === 'anthropic-messages'
      ? createAnthropic({
          baseURL,
          fetch: providerFetch,
          ...(input.auth === 'bearer' ? { authToken: input.apiKey } : { apiKey: input.apiKey }),
        }).messages(input.model)
      : input.protocol === 'openai-chat'
        ? createOpenAI({ baseURL, apiKey: input.apiKey, fetch: providerFetch }).chat(input.model)
        : createOpenAI({ baseURL, apiKey: input.apiKey, fetch: providerFetch }).responses(input.model)
    const result = await generateText({
      model,
      prompt: 'Reply with OK.',
      maxOutputTokens: 8,
      timeout: 15_000,
    })
    return { text: result.text, provider: model.provider }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replaceAll(input.apiKey, '[REDACTED]'))
  }
}
