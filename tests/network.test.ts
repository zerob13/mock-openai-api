import { describe, expect, it } from 'vitest'
import {
  isPrivateOrSpecialAddress,
  parseUpstreamBaseUrl,
  resolveNetworkTarget,
} from '../src/network.js'

describe('upstream network policy', () => {
  it('accepts only credential-free HTTP base URLs', () => {
    expect(parseUpstreamBaseUrl('https://api.example.com/v1').toString()).toBe('https://api.example.com/v1')
    expect(() => parseUpstreamBaseUrl('ftp://api.example.com')).toThrow('http or https')
    expect(() => parseUpstreamBaseUrl('https://key:secret@api.example.com/v1')).toThrow('credentials')
    expect(() => parseUpstreamBaseUrl('https://api.example.com/v1?key=secret')).toThrow('query or fragment')
    expect(() => parseUpstreamBaseUrl('https://api.example.com/v1#secret')).toThrow('query or fragment')
  })

  it('blocks local, private, documentation, multicast, and unspecified addresses', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '198.51.100.10',
      '224.0.0.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
    ]) expect(isPrivateOrSpecialAddress(address)).toBe(true)

    expect(isPrivateOrSpecialAddress('8.8.8.8')).toBe(false)
    expect(isPrivateOrSpecialAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('requires explicit private-network permission for loopback upstreams', async () => {
    await expect(resolveNetworkTarget('http://127.0.0.1:4010', false)).rejects.toThrow('private or special-use')
    await expect(resolveNetworkTarget('http://127.0.0.1:4010', true)).resolves.toMatchObject({
      url: new URL('http://127.0.0.1:4010'),
    })
  })
})
