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
