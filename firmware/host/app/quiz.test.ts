import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Quiz, validateQuizQuestions } from './quiz.js'
import { bundledQuizQuestions } from './quiz-questions.js'

const messages = JSON.parse(readFileSync('host/app/strings/en.json', 'utf8'))
const questions = bundledQuizQuestions((key) => messages[key])
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
function answer(quiz: Quiz, correct: boolean) {
  const q = quiz.snapshot().question
  quiz.answer(q.id, correct ? q.answer : (q.answer + 1) % q.choices.length)
}

test('quiz grades exactly three questions and blocks double answers and stale question IDs', () => {
  const store = memory()
  const quiz = new Quiz(questions, store)
  quiz.start()
  assert.equal(quiz.start(), false)
  const first = quiz.snapshot().question
  assert.equal(quiz.answer(first.id, -1), false)
  answer(quiz, true)
  const writes = store.writes()
  for (let i = 0; i < 10; i++) assert.equal(quiz.answer(first.id, first.answer), false)
  assert.equal(store.writes(), writes)
  assert.equal(quiz.snapshot().score, 1)
  quiz.next()
  assert.equal(quiz.next(), false)
  assert.equal(quiz.answer(first.id, first.answer), false)
  answer(quiz, false)
  quiz.next()
  answer(quiz, true)
  quiz.next()
  assert.equal(quiz.snapshot().phase, 'complete')
  assert.equal(quiz.snapshot().score, 2)
  assert.equal(quiz.snapshot().reviewCount, 1)
})

test('wrong answers survive close/restart, are prioritized, and leave the queue when corrected', () => {
  const store = memory()
  let quiz = new Quiz(questions, store)
  quiz.start()
  const missed = quiz.snapshot().question.id
  answer(quiz, false)
  quiz.close()
  quiz = new Quiz(questions, store)
  quiz.start()
  assert.equal(quiz.snapshot().question.id, missed)
  answer(quiz, true)
  assert.equal(new Quiz(questions, store).snapshot().reviewCount, 0)
})

test('successive rounds rotate the bundled set and never duplicate a question within a round', () => {
  const quiz = new Quiz(questions, memory())
  const seen: string[] = []
  for (let round = 0; round < 2; round++) {
    quiz.start()
    for (let i = 0; i < 3; i++) {
      seen.push(quiz.snapshot().question.id)
      answer(quiz, true)
      quiz.next()
    }
  }
  assert.equal(new Set(seen).size, 6)
})

test('all bundled answer tables and localized packs are valid', () => {
  const answers: Record<string, string> = { sum: '5', byte: '8', minute: '60', triangle: '3', week: '7', binary: '2' }
  for (const locale of ['ja', 'en', 'zh-CN']) {
    const catalog = JSON.parse(readFileSync(`host/app/strings/${locale}.json`, 'utf8'))
    const pack = bundledQuizQuestions((key) => catalog[key])
    validateQuizQuestions(pack)
    for (const question of pack) assert.equal(question.choices[question.answer], answers[question.id])
  }
})

test('question validation rejects oversized, duplicate and invalid answer data', () => {
  for (const pack of [
    [],
    [...questions, questions[0]],
    Array(33).fill(questions[0]),
    [{ ...questions[0], answer: 3 }, ...questions.slice(1)],
    [{ ...questions[0], prompt: 'x'.repeat(81) }, ...questions.slice(1)],
    [{ ...questions[0], choices: ['x'.repeat(37), 'b'] }, ...questions.slice(1)],
    [{ ...questions[0], id: '../bad' }, ...questions.slice(1)],
  ])
    assert.throws(() => validateQuizQuestions(pack))
})

test('corrupt persistence is bounded, failures are visible and saving can be retried', () => {
  for (const raw of [
    'null',
    'x'.repeat(4097),
    JSON.stringify({ version: 1, cursor: -1, review: [] }),
    JSON.stringify({ version: 1, cursor: 0, review: ['unknown'] }),
    JSON.stringify({ version: 1, cursor: 0, review: ['sum', 'sum'] }),
  ]) {
    const quiz = new Quiz(questions, memory(raw))
    assert.equal(quiz.snapshot().storageFailed, true)
    assert.equal(quiz.snapshot().reviewCount, 0)
  }
  let fail = true
  const store = memory()
  const quiz = new Quiz(questions, {
    get: () => undefined,
    set(value) {
      if (fail) throw new Error('full')
      store.set(value)
    },
  })
  quiz.start()
  answer(quiz, false)
  assert.equal(quiz.snapshot().storageFailed, true)
  fail = false
  quiz.retrySave()
  assert.equal(quiz.snapshot().storageFailed, false)
  assert.equal(new Quiz(questions, store).snapshot().reviewCount, 1)
  const writes = store.writes()
  quiz.close()
  quiz.next()
  quiz.start()
  quiz.retrySave()
  answer(quiz, true)
  assert.equal(store.writes(), writes)
})
