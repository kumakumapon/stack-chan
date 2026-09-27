import assert from 'node:assert/strict'
import test from 'node:test'
import { MiniAppRegistry } from './mini-app.js'

test('registered mini-app results are normalized and unsubscribe on cleanup', () => {
  const registry = new MiniAppRegistry()
  const received: Array<{ id: string; score: number }> = []
  const unsubscribe = registry.subscribeResult((result) => received.push(result))
  const unregister = registry.register({ id: 'test.jump', title: 'Jump', create: () => ({}) as never })

  registry.reportResult('test.jump', 27.8)
  registry.reportResult('test.jump', 2000)
  registry.reportResult('test.jump', Number.NaN)
  registry.reportResult('test.jump', -1)
  registry.reportResult('unknown', 12)
  assert.deepEqual(received, [
    { id: 'test.jump', score: 27 },
    { id: 'test.jump', score: 1000 },
  ])

  unregister()
  registry.reportResult('test.jump', 8)
  assert.equal(received.length, 2)
  unsubscribe()
  registry.register({ id: 'test.jump', title: 'Jump', create: () => ({}) as never })
  registry.reportResult('test.jump', 9)
  assert.equal(received.length, 2)
})
