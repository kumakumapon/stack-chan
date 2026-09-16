import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type GatewayConfig,
  parseGatewayEndpoint,
  requireGatewayIdentity,
  resolveGatewayConfig,
} from './gateway-config.js'

test('resolveGatewayConfig leaves the host config untouched when the MOD does not opt in', () => {
  const hostConfig: GatewayConfig = { enabled: false, endpoint: 'ws://gateway.local/ws' }
  assert.deepEqual(resolveGatewayConfig(hostConfig, undefined), hostConfig)
  assert.deepEqual(resolveGatewayConfig(hostConfig, {}), hostConfig)
  assert.deepEqual(resolveGatewayConfig(hostConfig, { gateway: { enabled: false } }), hostConfig)
  assert.equal(resolveGatewayConfig(undefined, {}), undefined)
})

test('resolveGatewayConfig lets a MOD flip enabled on, preserving the rest of the host config', () => {
  const hostConfig: GatewayConfig = { enabled: false, endpoint: 'ws://gateway.local/ws', deviceId: 'device-1' }
  const resolved = resolveGatewayConfig(hostConfig, { gateway: { enabled: true } })
  assert.equal(resolved?.enabled, true)
  assert.equal(resolved?.endpoint, hostConfig.endpoint)
  assert.equal(resolved?.deviceId, hostConfig.deviceId)
})

test('resolveGatewayConfig lets a MOD opt in even when there is no host config at all', () => {
  const resolved = resolveGatewayConfig(undefined, { gateway: { enabled: true } })
  assert.deepEqual(resolved, { enabled: true })
})

test('resolveGatewayConfig tolerates a malformed MOD config shape', () => {
  const hostConfig: GatewayConfig = { enabled: true }
  assert.deepEqual(resolveGatewayConfig(hostConfig, null), hostConfig)
  assert.deepEqual(resolveGatewayConfig(hostConfig, 'not-an-object'), hostConfig)
  assert.deepEqual(resolveGatewayConfig(hostConfig, { gateway: 'not-an-object' }), hostConfig)
})

test('parseGatewayEndpoint defaults ports and path for ws:// and wss://', () => {
  assert.deepEqual(parseGatewayEndpoint('ws://gateway.local'), {
    secure: false,
    host: 'gateway.local',
    port: 80,
    path: '/',
  })
  assert.deepEqual(parseGatewayEndpoint('wss://gateway.local'), {
    secure: true,
    host: 'gateway.local',
    port: 443,
    path: '/',
  })
})

test('parseGatewayEndpoint keeps an explicit port and path', () => {
  assert.deepEqual(parseGatewayEndpoint('ws://localhost:9000/stackchan'), {
    secure: false,
    host: 'localhost',
    port: 9000,
    path: '/stackchan',
  })
  assert.deepEqual(parseGatewayEndpoint('wss://gateway.example.com:8443/v1/session'), {
    secure: true,
    host: 'gateway.example.com',
    port: 8443,
    path: '/v1/session',
  })
})

test('parseGatewayEndpoint unwraps a bracketed IPv6 host', () => {
  assert.deepEqual(parseGatewayEndpoint('ws://[::1]:9000/ws'), {
    secure: false,
    host: '::1',
    port: 9000,
    path: '/ws',
  })
})

test('parseGatewayEndpoint rejects non ws(s) schemes, bad ports and malformed URLs', () => {
  assert.throws(() => parseGatewayEndpoint('http://gateway.local'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => parseGatewayEndpoint('ws://gateway.local:99999'), /port/)
  assert.throws(() => parseGatewayEndpoint('ws://gateway.local:0'), /port/)
  assert.throws(() => parseGatewayEndpoint('not a url'), /ws:\/\/ or wss:\/\//)
  assert.throws(() => parseGatewayEndpoint('ws://'), /host/)
})

test('requireGatewayIdentity resolves a complete config, with and without a token', () => {
  const withoutToken = requireGatewayIdentity({
    endpoint: 'wss://gateway.local/ws',
    deviceId: 'device-1',
    clientId: 'client-1',
  })
  assert.deepEqual(withoutToken, {
    endpoint: { secure: true, host: 'gateway.local', port: 443, path: '/ws' },
    deviceId: 'device-1',
    clientId: 'client-1',
  })
  assert.equal('token' in withoutToken, false)

  const withToken = requireGatewayIdentity({
    endpoint: 'wss://gateway.local/ws',
    deviceId: 'device-1',
    clientId: 'client-1',
    token: 'secret',
  })
  assert.equal(withToken.token, 'secret')
})

test('requireGatewayIdentity names the first missing field', () => {
  assert.throws(() => requireGatewayIdentity(undefined), /endpoint/)
  assert.throws(() => requireGatewayIdentity({}), /endpoint/)
  assert.throws(() => requireGatewayIdentity({ endpoint: 'ws://gateway.local' }), /deviceId/)
  assert.throws(() => requireGatewayIdentity({ endpoint: 'ws://gateway.local', deviceId: 'device-1' }), /clientId/)
})

test('requireGatewayIdentity propagates an invalid endpoint as a readable error', () => {
  assert.throws(
    () => requireGatewayIdentity({ endpoint: 'http://gateway.local', deviceId: 'device-1', clientId: 'client-1' }),
    /ws:\/\/ or wss:\/\//,
  )
})
