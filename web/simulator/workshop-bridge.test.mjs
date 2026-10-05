import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorkshopBridge } from './workshop-bridge.mjs'

test('workshop acknowledges commands, rejects errors, and drops stale work on restart', async () => {
  const bridge = createWorkshopBridge()
  await assert.rejects(bridge.command({ action: 'stop' }), /starting/)
  bridge.exchange({ action: 'ready' })
  const command = bridge.command({ action: 'quiz', value: '{}' })
  const { id } = bridge.exchange({ action: 'take' })
  bridge.exchange({ action: 'result', id, error: 'Invalid quiz' })
  await assert.rejects(command, /Invalid quiz/)
  const stale = bridge.command({ action: 'studio' })
  bridge.reset()
  await assert.rejects(stale, /restarted/)
  assert.equal(bridge.exchange({ action: 'take' }), null)
})

test('notification transport bounds responses and does not forward credentials on redirects', async () => {
  const bridge = createWorkshopBridge({
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, 'error')
      assert.equal(options.credentials, 'omit')
      return new Response(JSON.stringify({ entries: [] }), { status: 200 })
    },
  })
  const { id } = bridge.exchange({ action: 'http', url: 'http://localhost/api/inbox/poll', token: 'test', body: {} })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bridge.exchange({ action: 'httpResult', id }), { value: { entries: [] } })
  bridge.reset()
})

test('oversized streamed responses fail and reset aborts requests without replaying results', async () => {
  const large = createWorkshopBridge({ fetchImpl: async () => new Response('x'.repeat(32769)) })
  const { id } = large.exchange({ action: 'http', url: 'http://localhost/api/inbox/poll', body: {} })
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(large.exchange({ action: 'httpResult', id }).error, /too large/)
  let signal
  const pending = createWorkshopBridge({
    fetchImpl: async (_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))))
    },
  })
  const stale = pending.exchange({ action: 'http', url: 'http://localhost/api/inbox/poll', body: {} })
  pending.reset()
  assert.equal(signal.aborted, true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.match(pending.exchange({ action: 'httpResult', id: stale.id }).error, /expired/)
})
