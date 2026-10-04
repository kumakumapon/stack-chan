import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'
import { InboxModel } from './inbox-model.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(root, 'quiz', resolve(root, 'app/quiz.js'))
writeAliasPackage(root, 'workshop-model', resolve(root, 'app/workshop-model.js'))
const { WorkshopStore } = await import('./workshop-store.js')

test('inbox defers, coalesces, expires and never replays duplicate gestures', () => {
  let now = 0,
    gestures = 0
  const model = new InboxModel(
    () => now,
    () => gestures++,
  )
  model.receive({ entries: [] })
  const entry = { id: 'a', kind: 'build', text: 'Done', sender: 'Build', read: false, remainingMs: 1000 }
  model.receive({ entries: [entry, { ...entry, id: 'b' }] })
  model.present(true)
  assert.equal(gestures, 0)
  model.present(false)
  assert.equal(gestures, 1)
  model.receive({ entries: [entry] })
  model.present(false)
  assert.equal(gestures, 1)
  model.receive({ entries: [{ ...entry, id: 'c' }] })
  now = 1001
  model.present(false)
  assert.equal(model.snapshot().length, 0)
  assert.equal(gestures, 1)
  assert.throws(() => model.receive({ entries: [{ ...entry, remainingMs: Infinity }] }))
})

test('failed or malformed quiz imports preserve the installed deck and settings', () => {
  let saved: string | undefined,
    fail = false
  const store = new WorkshopStore(
    {
      get: () => undefined,
      set: () => {
        if (fail) throw Error('full')
      },
    },
    {
      get: () => saved,
      set: (value) => {
        if (fail) throw Error('full')
        saved = value
      },
    },
  )
  const deck = {
    version: 1,
    id: 'one',
    title: 'One',
    questions: ['a', 'b', 'c'].map((id) => ({ id, prompt: '1+1?', choices: ['2', '3'], answer: 0, explanation: '2' })),
  }
  store.importDeck(JSON.stringify(deck))
  assert.throws(() => store.importDeck('{}'))
  fail = true
  assert.throws(() => store.importDeck(JSON.stringify({ ...deck, id: 'two' })))
  assert.equal(store.deck()?.id, 'one')
  assert.equal(store.revision(), 1)
  assert.throws(() => store.set('sound', true))
  assert.equal(store.settings().sound, false)
})
