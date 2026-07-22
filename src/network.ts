import { lookup as dnsLookup } from 'node:dns/promises'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'

const BLOCKED_IPV4 = new BlockList()
const BLOCKED_IPV6 = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6')
}

export interface ResolvedNetworkTarget {
  url: URL
  lookup?: LookupFunction
  address?: string
}

export function parseUpstreamBaseUrl(rawUrl: string): URL {
  if (!rawUrl) throw new Error('Upstream base URL is required')
  const url = new URL(rawUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Upstream must use http or https')
  if (url.username || url.password) throw new Error('Upstream URL must not contain credentials')
  if (url.search || url.hash) throw new Error('Upstream base URL must not contain query or fragment data')
  return url
}

export function isPrivateOrSpecialAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return BLOCKED_IPV4.check(address, 'ipv4')
  if (family === 6) return BLOCKED_IPV6.check(address, 'ipv6')
  return true
}

export async function resolveNetworkTarget(
  rawUrl: string | URL,
  allowPrivateNetwork: boolean,
): Promise<ResolvedNetworkTarget> {
  const url = rawUrl instanceof URL ? new URL(rawUrl) : parseUpstreamBaseUrl(rawUrl)
  if (allowPrivateNetwork) return { url }

  const addresses = await dnsLookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length) throw new Error('Upstream hostname did not resolve')
  const blocked = addresses.find(({ address }) => isPrivateOrSpecialAddress(address))
  if (blocked) {
    throw new Error(`Upstream resolves to a private or special-use address: ${blocked.address}`)
  }
  const selected = addresses[0]
  const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all) callback(null, addresses)
    else callback(null, selected.address, selected.family)
  }
  return { url, lookup: pinnedLookup, address: selected.address }
}

export async function probeNetworkTarget(
  rawUrl: string,
  allowPrivateNetwork: boolean,
  timeoutMs = 5_000,
): Promise<{ status: number; address?: string }> {
  const target = await resolveNetworkTarget(rawUrl, allowPrivateNetwork)
  const transport = target.url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const request = transport.request(target.url, {
      method: 'HEAD',
      lookup: target.lookup,
    }, (response) => {
      response.resume()
      response.once('end', () => resolve({ status: response.statusCode ?? 0, address: target.address }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error('Upstream check timed out')))
    request.once('error', reject)
    request.end()
  })
}

function responseHeaders(message: IncomingMessage): Headers {
  const headers = new Headers()
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    headers.append(message.rawHeaders[index], message.rawHeaders[index + 1])
  }
  return headers
}

export function createSecureFetch(allowPrivateNetwork: boolean, maxRequestBytes = 16 * 1024 * 1024): typeof fetch {
  return async (input, init) => {
    const webRequest = new Request(input, init)
    const target = await resolveNetworkTarget(webRequest.url, allowPrivateNetwork)
    const body = webRequest.body ? Buffer.from(await webRequest.arrayBuffer()) : undefined
    if (body && body.byteLength > maxRequestBytes) {
      throw new Error(`AI SDK request exceeds the ${maxRequestBytes} byte limit`)
    }
    const headers: Record<string, string> = {}
    webRequest.headers.forEach((value, name) => { headers[name] = value })
    const transport = target.url.protocol === 'https:' ? https : http

    return new Promise<Response>((resolve, reject) => {
      const request = transport.request(target.url, {
        method: webRequest.method,
        headers,
        lookup: target.lookup,
      }, (message) => {
        const status = message.statusCode ?? 500
        if (status >= 300 && status < 400) {
          message.resume()
          reject(new Error('AI SDK upstream redirects are not followed'))
          return
        }
        const responseBody = webRequest.method === 'HEAD' || status === 204 || status === 304
          ? null
          : Readable.toWeb(message) as ReadableStream<Uint8Array>
        resolve(new Response(responseBody, {
          status,
          statusText: message.statusMessage,
          headers: responseHeaders(message),
        }))
      })
      const aborted = (): void => {
        request.destroy(new DOMException('The operation was aborted', 'AbortError'))
      }
      if (webRequest.signal.aborted) aborted()
      else webRequest.signal.addEventListener('abort', aborted, { once: true })
      request.once('close', () => webRequest.signal.removeEventListener('abort', aborted))
      request.once('error', reject)
      request.end(body)
    })
  }
}
