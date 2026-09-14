import assert from 'node:assert/strict'
import test from 'node:test'
import { applyHeadPose, createController, createHeartbeatWatchdog, readServoDiagnostics } from './controller.js'

const request = (id, extra = {}) => ({
  v: 1,
  sessionId: 'boot1',
  requestId: id,
  priority: 1,
  ttlMs: 1000,
  yawRad: 0.1,
  pitchRad: 0,
  durationMs: 700,
  ...extra,
})
const fixture = (execute = async () => ({}), now = () => 0, readDiagnostics) =>
  createController({
    execute,
    now,
    sessionId: 'boot1',
    capabilities: { emotions: ['HAPPY', 'NEUTRAL'] },
    readDiagnostics,
  })
test('duplicate pending and completed commands execute once; conflicts fail', async () => {
  let calls = 0
  let done
  const c = fixture(() => {
    calls++
    return new Promise((r) => {
      done = r
    })
  })
  const a = c.receive('head.set', request('one'))
  const b = c.receive('head.set', request('one'))
  assert.equal((await c.receive('head.set', request('one', { yawRad: 0.2 }))).error.code, 'request-id-conflict')
  done({ moved: true })
  assert.deepEqual(await a, await b)
  assert.deepEqual(await a, await c.receive('head.set', request('one')))
  assert.equal(calls, 1)
})
test('stop cancels queued work without starting overlapping physical operations', async () => {
  let done
  let calls = 0
  const c = fixture(() => {
    calls++
    return new Promise((r) => {
      done = r
    })
  })
  const first = c.receive('head.set', request('one'))
  const queued = c.receive('head.set', request('two'))
  assert.equal((await c.receive('stop', request('stop', { scope: 'all' }))).ok, true)
  assert.equal((await first).error.code, 'cancelled')
  assert.equal((await queued).error.code, 'cancelled')
  assert.equal(calls, 1)
  c.close()
  done({})
})
test('TTL expires while queued and priority orders remaining work', async () => {
  let clock = 0
  let done
  const order = []
  const c = fixture(
    async (_, p) => {
      order.push(p.requestId)
      if (p.requestId === 'one')
        await new Promise((r) => {
          done = r
        })
    },
    () => clock,
  )
  const one = c.receive('head.set', request('one'))
  const expired = c.receive('head.set', request('expired', { ttlMs: 100 }))
  const low = c.receive('head.set', request('low'))
  const high = c.receive('head.set', request('high', { priority: 3 }))
  clock = 200
  done()
  await Promise.all([one, low, high])
  assert.equal((await expired).error.code, 'expired')
  assert.deepEqual(order, ['one', 'high', 'low'])
})
test('rejects old sessions, malformed values and unsupported operations', async () => {
  const c = fixture(() => assert.fail('must not execute'))
  for (const [type, payload, code] of [
    ['head.set', request('a', { sessionId: 'old' }), 'stale-session'],
    ['head.set', request('b', { yawRad: NaN }), 'invalid-head'],
    ['head.set', request('c', { ttlMs: 0 }), 'invalid-ttl'],
    ['photo.capture', request('d'), 'unsupported'],
    ['speech.say', request('e', { text: 'hello', interrupt: true }), 'invalid-speech'],
  ])
    assert.equal((await c.receive(type, payload)).error.code, code)
})
test('queue has a hard bound and close cancels outstanding promises', async () => {
  const c = fixture(() => new Promise(() => {}))
  const pending = Array.from({ length: 9 }, (_, n) => c.receive('head.set', request(`q${n}`)))
  assert.equal((await c.receive('head.set', request('overflow'))).error.code, 'queue-full')
  c.close()
  for (const result of await Promise.all(pending)) assert.equal(result.error.code, 'cancelled')
})

test('heartbeats do not exhaust action history and reads survive a full action history', async () => {
  let calls = 0
  const c = fixture(async () => {
    calls++
    return { moved: true }
  })
  for (let i = 0; i < 1000; i++) {
    assert.equal((await c.receive('state.get', request(`heartbeat-${i}`))).ok, true)
    assert.equal((await c.receive('capabilities.get', request(`caps-${i}`))).ok, true)
  }
  assert.equal(calls, 0)
  for (let i = 0; i < 256; i++) assert.equal((await c.receive('head.set', request(`move-${i}`))).ok, true)
  assert.equal((await c.receive('head.set', request('overflow'))).error.code, 'session-full')
  assert.equal((await c.receive('state.get', request('still-alive'))).ok, true)
  assert.equal((await c.receive('capabilities.get', request('still-capable'))).ok, true)
  assert.equal((await c.receive('head.set', request('move-0'))).ok, true)
  assert.equal(calls, 256)
  assert.equal((await c.receive('state.get', request('move-0'))).error.code, 'request-id-conflict')
  assert.equal((await c.receive('stop', request('stop', { scope: 'all' }))).ok, true)
})

test('read-only polling returns current state and still checks the session', async () => {
  let done
  const c = fixture(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
  )
  const payload = request('poll')
  assert.equal((await c.receive('state.get', payload)).result.running, null)
  const action = c.receive('head.set', request('move'))
  assert.equal((await c.receive('state.get', payload)).result.running, 'head.set')
  assert.equal((await c.receive('state.get', request('old', { sessionId: 'old' }))).error.code, 'stale-session')
  done({})
  await action
  assert.equal((await c.receive('state.get', payload)).result.running, null)
})
test('capability handshake has bounded grace then switches to normal heartbeat timeout', () => {
  let now = 0
  const watch = createHeartbeatWatchdog(() => now)
  assert.equal(watch.expired(), false)
  watch.received(false)
  now = 3500
  assert.equal(watch.expired(), false, 'capability transfer must not consume the heartbeat window')
  watch.received(true)
  now = 6499
  assert.equal(watch.expired(), false)
  now = 6500
  assert.equal(watch.expired(), true)
  watch.received(true)
  assert.equal(watch.expired(), false)
  const unbound = createHeartbeatWatchdog(() => now)
  unbound.received(false)
  now += 11000
  unbound.received(false)
  now += 1000
  assert.equal(unbound.expired(), true, 'repeating capability requests must not extend handshake indefinitely')
})
test('head motion waits for torque enable and does not move on failure or cancellation', async () => {
  const calls = []
  let enabled
  const pose = { rotation: { y: 0.05, p: 0, r: 0 } }
  const motion = {
    setTorque(value) {
      calls.push(['torque', value])
      return new Promise((resolve) => {
        enabled = resolve
      })
    },
    async setPose(value, duration) {
      calls.push(['pose', value, duration])
    },
  }
  const move = applyHeadPose(motion, pose, 1, () => false)
  assert.deepEqual(calls, [['torque', true]])
  enabled()
  await move
  assert.deepEqual(calls, [
    ['torque', true],
    ['pose', pose, 1],
  ])
  let cancelled = false
  const aborted = applyHeadPose(motion, pose, 1, () => cancelled)
  cancelled = true
  enabled()
  await assert.rejects(aborted, /cancelled/)
  assert.equal(calls.filter(([type]) => type === 'pose').length, 1)
  await assert.rejects(
    applyHeadPose(
      {
        async setTorque() {
          throw new Error('servo unavailable')
        },
        setPose() {
          assert.fail('must not command position after torque failure')
        },
      },
      pose,
      1,
      () => false,
    ),
    /servo unavailable/,
  )
})

test('servo timeout has a specific code while unknown errors stay private', async () => {
  const timeout = Object.assign(new Error('internal servo details'), { protocol: 'scservo', timeoutMs: 120 })
  const c = fixture(async () => {
    throw timeout
  })
  assert.equal((await c.receive('head.set', request('timeout'))).error.code, 'servo-timeout')
  const other = fixture(async () => {
    throw new Error('private details')
  })
  assert.equal((await other.receive('head.set', request('other'))).error.code, 'execution-failed')
})

test('servo diagnostics stay readable while the queue is busy and do not consume history', async () => {
  let reads = 0
  let done
  const c = fixture(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
    () => 0,
    async () => {
      reads++
      return { servo: { pan: { commandsSent: reads } } }
    },
  )
  const action = c.receive('head.set', request('move'))
  for (let i = 0; i < 300; i++) {
    const reply = await c.receive('servo.diag', request(`diag-${i}`))
    assert.equal(reply.ok, true)
    assert.equal(reply.result.servo.pan.commandsSent, i + 1)
  }
  // A diagnostic read must never displace a queued action or fill the history.
  assert.equal((await c.receive('state.get', request('state'))).result.running, 'head.set')
  done({})
  assert.equal((await action).ok, true)
  assert.equal((await c.receive('servo.diag', request('stale', { sessionId: 'old' }))).error.code, 'stale-session')
})

test('a failing or absent diagnostics source is reported without dropping the session', async () => {
  const failing = fixture(
    async () => ({}),
    () => 0,
    async () => {
      throw new Error('servo unreachable')
    },
  )
  assert.equal((await failing.receive('servo.diag', request('diag'))).error.code, 'diagnostics-failed')
  assert.equal((await failing.receive('state.get', request('after'))).ok, true)
  const unsupported = fixture()
  assert.equal((await unsupported.receive('servo.diag', request('diag'))).error.code, 'unsupported')
})

test('a diagnostic snapshot pairs the commanded target with the measured rotation', async () => {
  const driverDiagnostics = { pan: { commandsSent: 0, lastGoalPosition: -1 } }
  const motion = {
    getDriverDiagnostics: () => driverDiagnostics,
    async getRotation() {
      // Reading is itself a servo command, so the counters move during the read.
      driverDiagnostics.pan.commandsSent++
      driverDiagnostics.pan.lastGoalPosition = 460
      return { success: true, value: { y: 0.11, p: -0.01, r: 0 } }
    },
  }
  const snapshot = await readServoDiagnostics(motion, { yawRad: 0.12, pitchRad: 0, durationMs: 1000 })
  assert.deepEqual(snapshot.commanded, { yawRad: 0.12, pitchRad: 0, durationMs: 1000 })
  assert.deepEqual(snapshot.measured, { yawRad: 0.11, pitchRad: -0.01 })
  assert.equal(snapshot.measuredError, null)
  assert.equal(snapshot.servo.pan.commandsSent, 1, 'the snapshot includes the read it just performed')
  // Drivers reuse their diagnostics object; the snapshot must not follow it.
  driverDiagnostics.pan.commandsSent = 99
  assert.equal(snapshot.servo.pan.commandsSent, 1)
})

test('an unreadable servo is reported as a measurement error, not as a missing head', async () => {
  const snapshot = await readServoDiagnostics(
    {
      getDriverDiagnostics: () => ({ pan: { responseTimeouts: 3 } }),
      async getRotation() {
        return { success: false, reason: 'scservo command timed out after 120ms' }
      },
    },
    null,
  )
  assert.equal(snapshot.measured, null)
  assert.match(snapshot.measuredError, /timed out/)
  assert.equal(snapshot.servo.pan.responseTimeouts, 3)
  const bare = await readServoDiagnostics({}, null)
  assert.deepEqual(bare, { commanded: null, measured: null, measuredError: null, servo: null })
})
