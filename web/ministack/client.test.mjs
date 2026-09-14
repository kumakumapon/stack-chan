import assert from 'node:assert/strict'
import test from 'node:test'
import { MiniStackClient } from './client.mjs'
function fixture(options = {}) {
  let listener
  let closeCount = 0
  let openCount = 0
  let failOpen = false
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
      if (type === 'capabilities.get' || type === 'state.get')
        listener({
          peer: { id: peer },
          payload: { v: 1, requestId: payload.requestId, sessionId: 'boot', ok: true, result: { sessionId: 'boot' } },
        })
    },
    close() {
      closeCount++
    },
  }
  const client = new MiniStackClient(
    () => ({
      open: async () => {
        openCount++
        if (failOpen) throw new Error('device not found')
        return session
      },
    }),
    () => {},
    options,
  )
  return {
    client,
    sent,
    reply: (p) => listener({ peer: { id: 'robot' }, payload: p }),
    get closeCount() {
      return closeCount
    },
    get openCount() {
      return openCount
    },
    failOpen(value) {
      failOpen = value
    },
  }
}
test('handshake binds subsequent requests to device boot session and rejects remote errors', async () => {
  const f = fixture()
  await f.client.connect('test-only-shared-key')
  const request = f.client.request('head.set', { yawRad: 0.05 })
  const p = f.sent.at(-1).payload
  assert.equal(p.sessionId, 'boot')
  assert.ok(f.sent.some((item) => item.type === 'state.get'), 'heartbeat starts during connection handshake')
  f.reply({ v: 1, sessionId: 'boot', requestId: p.requestId, ok: false, error: { code: 'invalid-head' } })
  await assert.rejects(request, /invalid-head/)
  f.client.close()
})
test('close rejects pending commands and detaches the sole connection', async () => {
  const f = fixture()
  await f.client.connect('test-only-shared-key')
  const request = f.client.request('head.set')
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

test('three consecutive heartbeat failures are reported and retained for subsequent buttons', async () => {
  const f = fixture()
  let notify
  const disconnected = new Promise((resolve) => { notify = resolve })
  f.client.onDisconnect = notify
  await f.client.connect('test-only-shared-key')
  const originalRequest = f.client.request.bind(f.client)
  f.client.request = async (type, fields) => {
    if (type === 'state.get') throw new Error('peer did not acknowledge message')
    return originalRequest(type, fields)
  }
  try {
    const reason = await disconnected
    assert.match(reason.message, /Heartbeat failed \(3 consecutive\): peer did not acknowledge message/)
    await assert.rejects(originalRequest('head.set', {}), (error) => error === reason)
    assert.equal(f.closeCount, 1)
  } finally {
    // A heartbeat failure now schedules a reconnect; stop it as a user would.
    f.client.disconnect()
  }
})

test('an unexpected drop reconnects with backoff and an explicit disconnect stays closed', async () => {
  // Flashing the host or the MOD drops the BLE session several times per device
  // cycle; retrying automatically removes that manual step from every attempt.
  const scheduled = []
  const attempts = []
  const f = fixture({
    reconnectAttempts: 2,
    reconnectBaseDelayMs: 1000,
    schedule: (run, delayMs) => scheduled.push({ run, delayMs }),
    onReconnectAttempt: (event) => attempts.push(event),
  })
  await f.client.connect('test-only-shared-key')
  assert.equal(f.openCount, 1)

  f.client.close(new Error('Device session changed'))
  assert.deepEqual(
    attempts.map(({ attempt, delayMs }) => [attempt, delayMs]),
    [[1, 1000]],
  )
  await scheduled.shift().run()
  assert.equal(f.openCount, 2, 'the retry reuses the shared key without another prompt')
  assert.equal(scheduled.length, 0)

  // A device that is still rebooting fails the first attempts; the budget is
  // spent on consecutive failures and restored once a session is established.
  f.failOpen(true)
  f.client.close(new Error('Device session changed'))
  await scheduled.shift().run()
  await scheduled.shift().run()
  assert.equal(scheduled.length, 0, 'consecutive retries are bounded')
  assert.deepEqual(
    attempts.map(({ attempt }) => attempt),
    [1, 1, 2],
  )
  assert.equal(f.openCount, 4)

  f.failOpen(false)
  await f.client.connect('test-only-shared-key')
  f.client.disconnect()
  assert.equal(scheduled.length, 0, 'an explicit disconnect must not reconnect')
  await assert.rejects(f.client.request('stop'), /Not connected/)
})

test('reconnect is not attempted before a session was ever established', async () => {
  const scheduled = []
  const client = new MiniStackClient(
    () => ({
      open: async () => {
        throw new Error('device not found')
      },
    }),
    () => {},
    { schedule: (run, delayMs) => scheduled.push({ run, delayMs }) },
  )
  await assert.rejects(client.connect('test-only-shared-key'), /device not found/)
  assert.equal(scheduled.length, 0)
})
