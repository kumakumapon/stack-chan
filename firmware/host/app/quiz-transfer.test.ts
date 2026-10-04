import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(root, 'quiz', resolve(root, 'app/quiz.js'))
writeAliasPackage(root, 'workshop-model', resolve(root, 'app/workshop-model.js'))
const { createQuizTransfer } = await import('./quiz-transfer.js')

test('BLE upload commits only a complete valid deck and drops interrupted or out-of-order transfers', () => {
  let saved = 'previous'
  const transfer = createQuizTransfer({
    get: () => saved,
    set: (value) => {
      saved = value
    },
  })
  const send = (value: unknown) => JSON.parse(transfer(JSON.stringify(value)))
  const deck = JSON.stringify({
    version: 1,
    id: 'test',
    title: '🐻',
    questions: ['a', 'b', 'c'].map((id) => ({
      id,
      prompt: '熊？',
      choices: ['はい', 'いいえ'],
      answer: 0,
      explanation: '熊です',
    })),
  })
  send({ action: 'begin' })
  send({ action: 'append', index: 0, text: deck.slice(0, 100) })
  assert.equal(saved, 'previous')
  assert.equal(send({ action: 'append', index: 2, text: 'oops' }).ok, false)
  assert.equal(send({ action: 'commit' }).ok, false)
  assert.equal(saved, 'previous')
  send({ action: 'begin' })
  send({ action: 'append', index: 0, text: 'invalid' })
  assert.equal(send({ action: 'commit' }).ok, false)
  send({ action: 'begin' })
  send({ action: 'append', index: 0, text: deck })
  assert.deepEqual(send({ action: 'commit', sequence: 42 }), { ok: true, sequence: 42 })
  assert.deepEqual(JSON.parse(saved), JSON.parse(deck))
  send({ action: 'begin' })
  send({ action: 'append', index: 0, text: deck })
  send({ action: 'cancel' })
  assert.equal(send({ action: 'commit' }).ok, false)
  assert.deepEqual(JSON.parse(saved), JSON.parse(deck))
})
