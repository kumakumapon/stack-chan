import assert from 'node:assert/strict'
import test from 'node:test'
import { MiniStackClient } from './client.mjs'
function fixture() {
  let listener
  let closeCount = 0
  const sent = []
  const session = {
    discover: async () => [{ id: 'robot' }],
    subscribe: (_, cb) => {
      listener = cb
      return () => {
        listener = undefined
      }
    },
    async send(peer, type, payload) {
      sent.push({ peer, type, payload })
      if (type === 'capabilities.get')
        listener({
          peer: { id: peer },
          payload: { v: 1, requestId: payload.requestId, sessionId: 'boot', ok: true, result: { sessionId: 'boot' } },
        })
    },
    close() {
      closeCount++
    },
  }
  const client = new MiniStackClient(() => ({ open: async () => session }))
  return {
    client,
    sent,
    reply: (p) => listener({ peer: { id: 'robot' }, payload: p }),
    get closeCount() {
      return closeCount
    },
  }
}
test('handshake binds subsequent requests to device boot session and rejects remote errors', async () => {
  const f = fixture()
  await f.client.connect('test-only-shared-key')
  const request = f.client.request('head.set', { yawRad: 0.05 })
  const p = f.sent.at(-1).payload
  assert.equal(p.sessionId, 'boot')
  f.reply({ v: 1, sessionId: 'boot', requestId: p.requestId, ok: false, error: { code: 'invalid-head' } })
  await assert.rejects(request, /invalid-head/)
  f.client.close()
})
test('close rejects pending commands and detaches the sole connection', async () => {
  const f = fixture()
  await f.client.connect('test-only-shared-key')
  const request = f.client.request('state.get')
  f.client.close()
  await assert.rejects(request, /Disconnected/)
  assert.equal(f.closeCount, 1)
  await assert.rejects(f.client.request('stop'), /Not connected/)
})

test('a cancelled connection closes a late session and refuses concurrent opens', async () => {
  let done
  let closed = 0
  const client = new MiniStackClient(() => ({
    open: () =>
      new Promise((r) => {
        done = r
      }),
  }))
  const connecting = client.connect('test-only-shared-key')
  await assert.rejects(client.connect('test-only-shared-key'), /already in progress/)
  client.close()
  done({
    close() {
      closed++
    },
  })
  await assert.rejects(connecting, /cancelled/)
  assert.equal(closed, 1)
})
