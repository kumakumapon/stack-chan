import assert from 'node:assert/strict'
import test from 'node:test'
import { createController } from './controller.js'

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
const fixture = (execute = async () => ({}), now = () => 0) =>
  createController({ execute, now, sessionId: 'boot1', capabilities: { emotions: ['HAPPY', 'NEUTRAL'] } })
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
