import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MiniAppRegistry } from './mini-app.ts'

const content = {} as never

test('MiniAppRegistry validates, sorts, and unregisters definitions', () => {
  const registry = new MiniAppRegistry()
  let notifications = 0
  registry.subscribe(() => {
    notifications += 1
  })

  const unregisterZulu = registry.register({ id: 'sample.zulu', title: 'Zulu', create: () => content })
  registry.register({ id: 'sample.alpha', title: ' Alpha ', create: () => content })

  assert.deepEqual(
    registry.list().map(({ id, title }) => ({ id, title })),
    [
      { id: 'sample.alpha', title: 'Alpha' },
      { id: 'sample.zulu', title: 'Zulu' },
    ],
  )
  assert.equal(notifications, 2)

  unregisterZulu()
  unregisterZulu()
  assert.deepEqual(
    registry.list().map(({ id }) => id),
    ['sample.alpha'],
  )
  assert.equal(notifications, 3)
})

test('MiniAppRegistry rejects invalid and duplicate definitions', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'valid-app', title: 'Valid', create: () => content })

  assert.throws(() => registry.register({ id: 'Not Valid', title: 'Invalid', create: () => content }), /mini app id/)
  assert.throws(() => registry.register({ id: 'empty-title', title: '   ', create: () => content }), /mini app title/)
  assert.throws(
    () => registry.register({ id: 'valid-app', title: 'Duplicate', create: () => content }),
    /already registered/,
  )
})

test('registry snapshots metadata without exposing the create callback', () => {
  const registry = new MiniAppRegistry()
  registry.register({ id: 'sample', title: 'Sample', create: () => content })
  const listed = registry.list()[0] as Record<string, unknown>

  assert.equal(Object.isFrozen(listed), true)
  assert.equal('create' in listed, false)
})

test('status updates preserve definitions, notify only on changes and clear on unregister', () => {
  const registry = new MiniAppRegistry()
  const unregister = registry.register({ id: 'focus', title: 'Focus', create: () => content })
  const definition = registry.get('focus')
  let notifications = 0
  registry.subscribe(() => notifications++)
  registry.setStatus('focus', 'Done')
  registry.setStatus('focus', 'Done')
  assert.equal(notifications, 1)
  assert.equal(registry.get('focus'), definition)
  assert.equal(registry.list()[0].status, 'Done')
  assert.throws(() => registry.setStatus('focus', 'x'.repeat(25)), /status/)
  unregister()
  registry.register({ id: 'focus', title: 'Focus', create: () => content })
  assert.equal(registry.list()[0].status, undefined)
})
