import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventOutbox, createEventPump, createTransferRegistry, TRANSFER_CHUNK_MAX } from './controller.js'

const outbox = (capacity = 4, clock = { value: 0 }) => createEventOutbox({ now: () => clock.value, capacity })

test('event ids are monotonic and never reused', () => {
  const events = outbox()
  const first = events.emit('ready')
  const second = events.emit('touch', { press: 'short' })
  events.ack(first.eventId)
  const third = events.emit('error', { code: 'x' })
  assert.deepEqual([first.eventId, second.eventId, third.eventId], [1, 2, 3])
})

test('an unknown kind is rejected rather than emitted as a kind nothing matches', () => {
  assert.throws(() => outbox().emit('speech.done'), /unknown-event-kind/)
})

test('replay redelivers an unacked completion so a lost reply does not lose it', () => {
  const events = outbox()
  events.emit('ready')
  const finished = events.emit('command.finished', { requestId: 'a' })
  const replay = events.since(0)
  assert.deepEqual(
    replay.events.map((event) => event.eventId),
    [1, finished.eventId],
  )
  assert.equal(replay.gap, false)
})

test('acking drops confirmed events and leaves the rest', () => {
  const events = outbox()
  events.emit('ready')
  events.emit('touch')
  assert.equal(events.ack(1), true)
  assert.deepEqual(
    events.pending.map((event) => event.eventId),
    [2],
  )
})

test('an ack for an id that was never emitted is refused', () => {
  const events = outbox()
  events.emit('ready')
  // Honouring this would discard the only record of commands not yet finished.
  assert.equal(events.ack(5), false)
  assert.equal(events.ack(-1), false)
  assert.deepEqual(
    events.pending.map((event) => event.eventId),
    [1],
  )
})

test('overflow drops the oldest and reports a gap to a cursor behind it', () => {
  const events = outbox(2)
  events.emit('ready')
  events.emit('touch')
  events.emit('command.finished', { requestId: 'a' })

  const replay = events.since(0)
  assert.equal(replay.gap, true, 'a PC starting from scratch must learn an event was lost')
  assert.deepEqual(
    replay.events.map((event) => event.eventId),
    [2, 3],
  )
  // A cursor past the loss has missed nothing.
  assert.equal(events.since(2).gap, false)
})

test('a stale cursor still reports the gap after the buffer was emptied by acks', () => {
  // The regression this exists for: clearing the buffer must not make a loss
  // look like "nothing happened" to a PC reconnecting with an old cursor.
  const events = outbox(2)
  events.emit('ready')
  events.emit('touch')
  events.emit('command.finished', { requestId: 'a' })
  events.ack(3)

  assert.deepEqual(events.pending, [])
  assert.equal(events.since(0).gap, true)
  assert.equal(events.since(2).gap, false)
})

test('a cursor at or beyond the newest id is rejected as invalid', () => {
  const events = outbox()
  events.emit('ready')
  assert.equal(events.since(1).invalid, false)
  assert.equal(events.since(2).invalid, true)
})

const registry = (clock = { value: 0 }) =>
  createTransferRegistry({
    now: () => clock.value,
    encode: (bytes) => Buffer.from(bytes).toString('base64'),
    ttlMs: 1000,
  })

test('a transfer is read in chunks and reports the end', () => {
  const transfers = registry()
  const offer = transfers.offer('photo', Uint8Array.from([1, 2, 3, 4, 5]), { imageType: 'jpeg' })
  assert.equal(offer.byteLength, 5)
  assert.equal(offer.imageType, 'jpeg')

  const head = transfers.read(offer.transferId, 0, 3)
  assert.equal(head.eof, false)
  assert.equal(Buffer.from(head.chunk, 'base64').length, 3)

  const tail = transfers.read(offer.transferId, 3, 3)
  assert.equal(tail.eof, true)
  assert.deepEqual([...Buffer.from(tail.chunk, 'base64')], [4, 5])
})

test('re-reading the same offset returns the same bytes so a lost reply costs one chunk', () => {
  const transfers = registry()
  const { transferId } = transfers.offer('photo', Uint8Array.from([7, 8, 9]))
  assert.deepEqual(transfers.read(transferId, 0, 2), transfers.read(transferId, 0, 2))
})

test('a chunk larger than the envelope allows is refused', () => {
  const transfers = registry()
  const { transferId } = transfers.offer('photo', new Uint8Array(4096))
  assert.equal(transfers.read(transferId, 0, TRANSFER_CHUNK_MAX + 1).error, 'invalid-length')
  assert.equal(transfers.read(transferId, 0, 0).error, 'invalid-length')
  assert.equal(transfers.read(transferId, -1, 8).error, 'invalid-offset')
  assert.equal(transfers.read(transferId, 4097, 8).error, 'invalid-offset')
})

test('a new capture releases the previous one of the same kind and closes its buffer', () => {
  const transfers = registry()
  let closed = 0
  const first = transfers.offer('photo', Uint8Array.from([1]), {}, () => closed++)
  transfers.offer('photo', Uint8Array.from([2]), {}, () => closed++)

  assert.equal(closed, 1, 'the camera frame it owned must be closed, not just dereferenced')
  assert.equal(transfers.read(first.transferId, 0, 1).error, 'unknown-transfer')
  assert.equal(transfers.size, 1)
})

test('a recording and a photo coexist because they are separate kinds', () => {
  const transfers = registry()
  const photo = transfers.offer('photo', Uint8Array.from([1]))
  const audio = transfers.offer('audio', Uint8Array.from([2]))
  assert.equal(transfers.read(photo.transferId, 0, 1).eof, true)
  assert.equal(transfers.read(audio.transferId, 0, 1).eof, true)
})

test('an expired transfer is closed and no longer readable', () => {
  const clock = { value: 0 }
  const transfers = registry(clock)
  let closed = 0
  const { transferId } = transfers.offer('photo', Uint8Array.from([1]), {}, () => closed++)
  clock.value = 1000
  assert.equal(transfers.read(transferId, 0, 1).error, 'unknown-transfer')
  assert.equal(closed, 1)
})

test('closeAll releases every buffer the session still holds', () => {
  const transfers = registry()
  let closed = 0
  transfers.offer('photo', Uint8Array.from([1]), {}, () => closed++)
  transfers.offer('audio', Uint8Array.from([2]), {}, () => closed++)
  transfers.closeAll()
  assert.equal(closed, 2)
  assert.equal(transfers.size, 0)
})

const pumpFixture = (send) => {
  const events = createEventOutbox({ now: () => 0 })
  const pump = createEventPump({ events, send })
  const emit = (kind) => {
    events.emit(kind)
    pump.pump()
  }
  return { events, pump, emit }
}
const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

test('the pump sends one event at a time, in id order', async () => {
  const sent = []
  const gates = [deferred(), deferred()]
  const { emit } = pumpFixture((event) => {
    sent.push(event.eventId)
    return gates[sent.length - 1].promise
  })

  emit('ready')
  emit('touch')
  // Overlapping sends would reorder events, and the PC's state machine is built on order.
  assert.deepEqual(sent, [1])

  gates[0].resolve()
  await gates[0].promise
  await Promise.resolve()
  assert.deepEqual(sent, [1, 2])
})

test('a failed send retries the same event rather than skipping it', async () => {
  const sent = []
  let fail = true
  const { pump, emit } = pumpFixture((event) => {
    sent.push(event.eventId)
    return fail ? Promise.reject(new Error('radio')) : Promise.resolve()
  })

  emit('ready')
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sent, [1])
  assert.equal(pump.sentThrough, 0, 'a failure must not advance past the event')

  fail = false
  pump.pump()
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sent, [1, 1])
  assert.equal(pump.sentThrough, 1)
})

test('an event already sent is not resent while it waits to be acknowledged', async () => {
  // The outbox keeps an event until the PC acks it. Without tracking sent apart
  // from acked, every tick would resend the same event forever.
  const sent = []
  const { pump, emit } = pumpFixture((event) => {
    sent.push(event.eventId)
    return Promise.resolve()
  })

  emit('ready')
  await new Promise((done) => setImmediate(done))
  pump.pump()
  pump.pump()
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sent, [1])
})

test('a backlog drains without waiting for another trigger', async () => {
  const sent = []
  const { events, pump } = pumpFixture((event) => {
    sent.push(event.eventId)
    return Promise.resolve()
  })
  // Queued before any peer existed, as the boot 'ready' event is.
  events.emit('ready')
  events.emit('touch')
  events.emit('error')

  pump.pump()
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sent, [1, 2, 3])
})

test('a send that throws synchronously is treated as a failure, not a crash', async () => {
  const { pump, emit } = pumpFixture(() => {
    throw new Error('radio gone')
  })
  emit('ready')
  await new Promise((done) => setImmediate(done))
  assert.equal(pump.sending, false, 'the pump must not wedge itself shut')
  assert.equal(pump.sentThrough, 0)
})

test('the pump stays quiet while no peer is connected', async () => {
  const events = createEventOutbox({ now: () => 0 })
  let connected = false
  const sent = []
  const pump = createEventPump({
    events,
    send: (event) => {
      sent.push(event.eventId)
      return Promise.resolve()
    },
    isClosed: () => !connected,
  })
  events.emit('ready')
  pump.pump()
  assert.deepEqual(sent, [])

  connected = true
  pump.pump()
  await new Promise((done) => setImmediate(done))
  assert.deepEqual(sent, [1])
})
