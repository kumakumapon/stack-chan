import assert from 'node:assert/strict'
import test from 'node:test'
import { createController, createEventOutbox, createTransferRegistry } from './controller.js'

const clock = () => ({ value: 0 })
const build = ({ execute = async () => ({}), applyConfig, capabilities = {}, time = clock() } = {}) => {
  const events = createEventOutbox({ now: () => time.value })
  const transfers = createTransferRegistry({
    now: () => time.value,
    encode: (bytes) => Buffer.from(bytes).toString('base64'),
  })
  const controller = createController({
    execute,
    now: () => time.value,
    sessionId: 'boot1',
    capabilities: { emotions: ['HAPPY', 'NEUTRAL'], listen: true, photo: true, ...capabilities },
    events,
    transfers,
    applyConfig,
  })
  return { controller, events, transfers, time }
}
const action = (id, extra = {}) => ({
  v: 1,
  sessionId: 'boot1',
  requestId: id,
  priority: 1,
  ttlMs: 1000,
  ...extra,
})
const read = (id, extra = {}) => ({ v: 1, sessionId: 'boot1', requestId: id, ...extra })

test('every finished command is reported as an event as well as a reply', async () => {
  const { controller, events } = build()
  await controller.receive('face.set', action('a', { emotion: 'HAPPY' }))

  const [finished] = events.pending.filter((event) => event.kind === 'command.finished')
  assert.equal(finished.data.requestId, 'a')
  assert.equal(finished.data.type, 'face.set')
})

test('a rejected command is reported with its reason, so a lost reply is recoverable', async () => {
  const { controller, events } = build()
  await controller.receive('face.set', action('a', { emotion: 'NOPE' }))

  const [rejected] = events.pending.filter((event) => event.kind === 'command.rejected')
  assert.deepEqual(
    { requestId: rejected.data.requestId, code: rejected.data.code },
    { requestId: 'a', code: 'invalid-face' },
  )
})

test('state.get exposes the event cursor without consuming action history', async () => {
  const { controller, events } = build()
  events.emit('ready')
  const state = await controller.receive('state.get', read('s1'))
  assert.equal(state.result.nextEventId, 2)
  assert.equal(state.result.pendingEvents, 1)
})

test('events.since replays and events.ack clears', async () => {
  const { controller, events } = build()
  events.emit('ready')
  events.emit('touch', { press: 'short' })

  const replay = await controller.receive('events.since', read('r1', { afterEventId: 0 }))
  assert.deepEqual(
    replay.result.events.map((event) => event.kind),
    ['ready', 'touch'],
  )
  assert.equal(replay.result.gap, false)

  assert.equal((await controller.receive('events.ack', read('a1', { lastEventId: 2 }))).ok, true)
  assert.deepEqual(events.pending, [])
})

test('an ack the MOD cannot honour is an error rather than silent data loss', async () => {
  const { controller, events } = build()
  events.emit('ready')
  const reply = await controller.receive('events.ack', read('a1', { lastEventId: 99 }))
  assert.equal(reply.error.code, 'invalid-ack')
  assert.equal(events.pending.length, 1)
})

test('speech may now interrupt, and a non-boolean flag is still refused', async () => {
  const seen = []
  const { controller } = build({
    execute: async (_type, payload) => {
      seen.push(payload.interrupt)
      return {}
    },
  })
  assert.equal((await controller.receive('speech.say', action('a', { text: 'hi', interrupt: true }))).ok, true)
  assert.equal((await controller.receive('speech.say', action('b', { text: 'hi' }))).ok, true)
  assert.equal(
    (await controller.receive('speech.say', action('c', { text: 'hi', interrupt: 1 }))).error.code,
    'invalid-speech',
  )
  assert.deepEqual(seen, [true, undefined])
})

test('face colour is accepted for the published theme keys only', async () => {
  const { controller } = build()
  assert.equal(
    (await controller.receive('face.set', action('a', { color: { key: 'primary', r: 10, g: 20, b: 30 } }))).ok,
    true,
  )
  for (const [id, color] of [
    ['b', { key: 'accent', r: 1, g: 1, b: 1 }],
    ['c', { key: 'primary', r: 256, g: 0, b: 0 }],
    ['d', { key: 'primary', r: 1.5, g: 0, b: 0 }],
  ])
    assert.equal((await controller.receive('face.set', action(id, { color }))).error.code, 'invalid-face')
  // Neither an emotion nor a colour leaves nothing to apply.
  assert.equal((await controller.receive('face.set', action('e'))).error.code, 'invalid-face')
})

test('listen validates its timeout and reports unsupported without a microphone', async () => {
  const { controller } = build()
  assert.equal((await controller.receive('conversation.listen', action('a', { timeoutMs: 2000 }))).ok, true)
  assert.equal(
    (await controller.receive('conversation.listen', action('b', { timeoutMs: 100 }))).error.code,
    'invalid-listen',
  )

  const { controller: deaf } = build({ capabilities: { listen: false } })
  assert.equal((await deaf.receive('conversation.listen', action('c', { timeoutMs: 2000 }))).error.code, 'unsupported')
})

test('config.set applies only enumerated settings within range', async () => {
  const applied = []
  const { controller } = build({ applyConfig: (settings) => applied.push(settings) })

  assert.deepEqual(
    (await controller.receive('config.set', read('a', { speechVolume: 80, faceMotion: false }))).result.applied,
    { speechVolume: 80, faceMotion: false },
  )
  assert.equal(
    (await controller.receive('config.set', read('b', { ttsEndpoint: 'http://x' }))).error.code,
    'unknown-setting',
  )
  assert.equal((await controller.receive('config.set', read('c', { speechVolume: 101 }))).error.code, 'invalid-setting')
  assert.equal((await controller.receive('config.set', read('d', { faceMotion: 'yes' }))).error.code, 'invalid-setting')
  assert.equal((await controller.receive('config.set', read('e'))).error.code, 'invalid-setting')
  assert.deepEqual(applied, [{ speechVolume: 80, faceMotion: false }])
})

test('config.set does not wait behind a busy motion queue', async () => {
  // Settings decide how the next motion behaves, so queueing them would apply
  // them after the motion they were meant to change.
  const applied = []
  const { controller } = build({
    execute: () => new Promise(() => {}),
    applyConfig: (settings) => applied.push(settings),
  })
  void controller.receive('head.set', action('slow', { yawRad: 0, pitchRad: 0, durationMs: 700 }))
  assert.equal((await controller.receive('config.set', read('now', { speechVolume: 10 }))).ok, true)
  assert.deepEqual(applied, [{ speechVolume: 10 }])
})

test('a transfer offered by the executor is readable and releasable over the protocol', async () => {
  const { controller, transfers } = build()
  const offer = transfers.offer('photo', Uint8Array.from([1, 2, 3]), { imageType: 'jpeg' })

  const chunk = await controller.receive(
    'transfer.read',
    read('r1', { transferId: offer.transferId, offset: 0, length: 3 }),
  )
  assert.equal(chunk.result.eof, true)
  assert.deepEqual([...Buffer.from(chunk.result.chunk, 'base64')], [1, 2, 3])

  assert.equal((await controller.receive('transfer.release', read('r2', { transferId: offer.transferId }))).ok, true)
  assert.equal(
    (await controller.receive('transfer.read', read('r3', { transferId: offer.transferId, offset: 0, length: 3 })))
      .error.code,
    'unknown-transfer',
  )
})

test('closing the session releases transfers the PC never finished reading', async () => {
  const { controller, transfers } = build()
  let closed = 0
  transfers.offer('photo', Uint8Array.from([1]), {}, () => closed++)
  controller.close()
  assert.equal(closed, 1)
})
