import assert from 'node:assert/strict'
import test from 'node:test'
import { MiniStackClient, createEventTracker, readTransfer, decodeBase64, TRANSFER_CHUNK_MAX } from './client.mjs'
function fixture(options = {}) {
  // Keyed by Local Peer message type: the client now subscribes to both
  // 'response' and 'event', which a single shared listener could not tell apart.
  const listeners = new Map()
  let closeCount = 0
  let openCount = 0
  let failOpen = false
  const sent = []
  const session = {
    discover: async () => [{ id: 'robot' }],
    subscribe: (type, cb) => {
      listeners.set(type, cb)
      return () => {
        if (listeners.get(type) === cb) listeners.delete(type)
      }
    },
    async send(peer, type, payload) {
      sent.push({ peer, type, payload })
      if (type === 'capabilities.get' || type === 'state.get')
        listeners.get('response')?.({
          peer: { id: peer },
          payload: { v: 1, requestId: payload.requestId, sessionId: 'boot', ok: true, result: { sessionId: 'boot' } },
        })
      else if (type === 'events.since')
        listeners.get('response')?.({
          peer: { id: peer },
          payload: {
            v: 1,
            requestId: payload.requestId,
            sessionId: 'boot',
            ok: true,
            result: { events: [], gap: false },
          },
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
    reply: (p) => listeners.get('response')?.({ peer: { id: 'robot' }, payload: p }),
    event: (p) => listeners.get('event')?.({ peer: { id: 'robot' }, payload: p }),
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

// createEventTracker: the MOD delivers each event at least once (a pushed
// 'event' message can be redelivered by a later events.since replay that
// overlaps it), and the PC is the one responsible for deduplicating on eventId.

test('a redelivered event is handed to the UI once, not twice', () => {
  const delivered = []
  const tracker = createEventTracker({ onEvent: (event) => delivered.push(event.eventId) })
  const event = { eventId: 1, occurredAt: 0, kind: 'ready', data: {} }
  tracker.ingest(event)
  tracker.ingest(event)
  tracker.ingestReplay({ events: [event], gap: false })
  assert.deepEqual(delivered, [1])
  assert.equal(tracker.cursor, 1)
})

test('a pushed event and an overlapping polled replay still deliver each id once, in order', () => {
  const delivered = []
  const tracker = createEventTracker({ onEvent: (event) => delivered.push(event.eventId) })
  const events = [1, 2, 3].map((eventId) => ({ eventId, occurredAt: 0, kind: 'touch', data: {} }))
  // The push for event 2 races ahead of the replay that is still catching up
  // from the start; it must be held back rather than shown out of order.
  tracker.ingest(events[1])
  assert.deepEqual(delivered, [])
  tracker.ingestReplay({ events, gap: false })
  assert.deepEqual(delivered, [1, 2, 3])
  assert.equal(tracker.cursor, 3)
})

test('gap: true surfaces as a resync signal instead of being swallowed', () => {
  const delivered = []
  let gaps = 0
  const tracker = createEventTracker({
    onEvent: (event) => delivered.push(event.eventId),
    onGap: () => {
      gaps += 1
    },
  })
  // Event 1 is buffered, waiting on nothing yet to arrive before it.
  tracker.ingest({ eventId: 1, occurredAt: 0, kind: 'ready', data: {} })
  assert.deepEqual(delivered, [1])
  // The MOD's buffer overran and dropped ids 2-4 for good; only 5 survives.
  const survivor = { eventId: 5, occurredAt: 0, kind: 'touch', data: {} }
  tracker.ingestReplay({ events: [survivor], gap: true })
  assert.equal(gaps, 1)
  // The survivor is still delivered — a gap loses the ids in between, not
  // whatever the MOD still has on hand.
  assert.deepEqual(delivered, [1, 5])
  assert.equal(tracker.cursor, 5)
  // The cursor has moved past the hole, so a later, stale redelivery of an id
  // from before the gap is dropped rather than resurrected.
  tracker.ingest({ eventId: 3, occurredAt: 0, kind: 'touch', data: {} })
  assert.deepEqual(delivered, [1, 5])
})

// readTransfer / decodeBase64: chunked download of a photo or recording.

function chunkedSource(bytes, { failOffsetsOnce = new Set() } = {}) {
  const requests = []
  const alreadyFailed = new Set()
  const read = async (offset, length) => {
    requests.push({ offset, length })
    if (failOffsetsOnce.has(offset) && !alreadyFailed.has(offset)) {
      alreadyFailed.add(offset)
      throw new Error('peer did not acknowledge message')
    }
    const end = Math.min(offset + length, bytes.byteLength)
    return {
      transferId: 't1',
      offset,
      byteLength: bytes.byteLength,
      chunk: btoa(String.fromCharCode(...bytes.subarray(offset, end))),
      eof: end >= bytes.byteLength,
    }
  }
  return { read, requests }
}

test('the chunk loop reassembles a multi-chunk payload byte-for-byte, including a final partial chunk', async () => {
  const bytes = Uint8Array.from({ length: 2500 }, (_, index) => index % 256)
  const { read, requests } = chunkedSource(bytes)
  const result = await readTransfer(read, { chunkSize: 1000 })
  assert.deepEqual([...result], [...bytes])
  assert.deepEqual(
    requests.map((r) => r.offset),
    [0, 1000, 2000],
  )
  for (const r of requests) assert.ok(r.length <= TRANSFER_CHUNK_MAX)
  // The final chunk is a partial 500 bytes, not padded up to the request size.
  assert.equal(requests.at(-1).length, 1000)
})

test('a failed chunk read is retried at the same offset rather than restarting at 0', async () => {
  const bytes = Uint8Array.from({ length: 300 }, (_, index) => (index * 7) % 256)
  const { read, requests } = chunkedSource(bytes, { failOffsetsOnce: new Set([100]) })
  const result = await readTransfer(read, { chunkSize: 100 })
  assert.deepEqual([...result], [...bytes])
  assert.deepEqual(
    requests.map((r) => r.offset),
    [0, 100, 100, 200],
  )
})

test('base64 decoding round-trips bytes that are not a multiple of 3', () => {
  const original = Uint8Array.from([0, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255])
  assert.notEqual(original.byteLength % 3, 0)
  const encoded = btoa(String.fromCharCode(...original))
  assert.deepEqual([...decodeBase64(encoded)], [...original])
})
