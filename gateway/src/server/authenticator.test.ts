import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthenticator } from './authenticator.ts'

test('a per-device token is required when one is configured', () => {
  const authenticate = createAuthenticator({ devices: [{ deviceId: 'stackchan-01', token: 'secret' }] })
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a', token: 'secret' }), true)
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a', token: 'wrong' }), false)
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a' }), false)
})

test('a per-device token wins over the shared token', () => {
  const authenticate = createAuthenticator({
    devices: [{ deviceId: 'stackchan-01', token: 'per-device' }],
    sharedToken: 'fleet',
  })
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a', token: 'fleet' }), false)
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a', token: 'per-device' }), true)
})

test('an unlisted device falls back to the shared token', () => {
  const authenticate = createAuthenticator({ sharedToken: 'fleet' })
  assert.equal(authenticate({ deviceId: 'unknown', clientId: 'a', token: 'fleet' }), true)
  assert.equal(authenticate({ deviceId: 'unknown', clientId: 'a', token: 'nope' }), false)
})

test('a device enrolled without a token still has to satisfy the shared token', () => {
  const authenticate = createAuthenticator({ devices: [{ deviceId: 'stackchan-01' }], sharedToken: 'fleet' })
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a' }), false)
  assert.equal(authenticate({ deviceId: 'stackchan-01', clientId: 'a', token: 'fleet' }), true)
})

test('anonymous devices are refused unless explicitly allowed', () => {
  assert.equal(createAuthenticator({})({ deviceId: 'any', clientId: 'a' }), false)
  assert.equal(createAuthenticator({ allowAnonymous: true })({ deviceId: 'any', clientId: 'a' }), true)
})

test('a token of a different length is refused rather than throwing', () => {
  const authenticate = createAuthenticator({ sharedToken: 'fleet' })
  assert.equal(authenticate({ deviceId: 'any', clientId: 'a', token: 'fleet-but-longer' }), false)
})
