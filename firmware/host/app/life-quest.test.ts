import assert from 'node:assert/strict'
import test from 'node:test'
import { LifeQuest } from './life-quest.js'

function memory(initial?: unknown) {
  let saved = initial
  let writes = 0
  return {
    get: () => saved,
    set(value: string) {
      saved = value
      writes++
    },
    writes: () => writes,
  }
}

test('quest persists progress and celebrates only once per manually reset round', () => {
  const storage = memory()
  let quest = new LifeQuest(storage)
  quest.setDone(0, true)
  quest = new LifeQuest(storage)
  assert.deepEqual(quest.snapshot().done, [true, false, false])
  quest.setDone(1, true)
  quest.setDone(2, true)
  assert.equal(quest.snapshot().celebration, true)
  const writes = storage.writes()
  for (let i = 0; i < 10; i++) quest.setDone(2, true)
  assert.equal(storage.writes(), writes)
  quest.setDone(2, false)
  quest.setDone(2, true)
  assert.equal(quest.snapshot().celebration, false)
  quest = new LifeQuest(storage)
  assert.equal(quest.snapshot().complete, true)
  assert.equal(quest.snapshot().celebration, false)
  quest.setDone(1, false)
  quest.setDone(1, true)
  assert.equal(quest.snapshot().celebration, false)
  quest.newRound()
  assert.deepEqual(new LifeQuest(storage).snapshot().done, [false, false, false])
  for (let i = 0; i < 3; i++) quest.setDone(i, true)
  assert.equal(quest.snapshot().celebration, true)
})

test('quest rejects invalid input and stale actions after close', () => {
  const storage = memory()
  const quest = new LifeQuest(storage)
  for (const index of [-1, 3, 0.5, NaN]) assert.equal(quest.setDone(index, true), false)
  const state = quest.snapshot()
  assert.throws(() => (state.done as boolean[]).push(true))
  quest.close()
  quest.setDone(0, true)
  quest.newRound()
  quest.retrySave()
  assert.equal(storage.writes(), 0)
})

test('quest recovers from corrupt state and storage errors without resetting other stores', () => {
  for (const raw of [
    '{',
    'null',
    JSON.stringify({ version: 2 }),
    JSON.stringify({ version: 1, done: [1, 0, 0], celebrated: false }),
  ]) {
    const quest = new LifeQuest(memory(raw))
    assert.deepEqual(quest.snapshot().done, [false, false, false])
    assert.equal(quest.snapshot().storageFailed, true)
  }
  let fail = true
  const storage = memory()
  const quest = new LifeQuest({
    get: () => {
      throw new Error('read')
    },
    set: (value) => {
      if (fail) throw new Error('write')
      storage.set(value)
    },
  })
  quest.setDone(0, true)
  assert.equal(quest.snapshot().storageFailed, true)
  fail = false
  quest.retrySave()
  assert.equal(quest.snapshot().storageFailed, false)
  assert.deepEqual(new LifeQuest(storage).snapshot().done, [true, false, false])
})
