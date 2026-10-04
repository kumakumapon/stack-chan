import assert from 'node:assert/strict'
import test from 'node:test'
import { parseQuizDeck, StorySession, validateStory, validateStudio } from './workshop-model.js'

test('quiz import validates before replacing any saved deck', () => {
  const questions = ['a', 'b', 'c'].map((id) => ({
    id,
    prompt: '1+1?',
    choices: ['2', '3'],
    answer: 0,
    explanation: '2',
  }))
  const deck = { version: 1, id: 'math', title: 'Math', questions }
  assert.equal(parseQuizDeck(JSON.stringify(deck)).questions.length, 3)
  assert.throws(() => parseQuizDeck(JSON.stringify({ ...deck, questions: [...questions, questions[0]] })))
  assert.throws(() => parseQuizDeck(JSON.stringify({ ...deck, version: 2 })))
  assert.throws(() => parseQuizDeck(' '.repeat(20001)))
})

test('story reaches both endings, rejects invalid graphs and ignores closed/stale choices', () => {
  const story = {
    version: 1 as const,
    start: 'start',
    scenes: [
      {
        id: 'start',
        text: 'Choose',
        choices: [
          { label: 'A', next: 'a' },
          { label: 'B', next: 'b' },
        ],
      },
      { id: 'a', text: 'A', choices: [] },
      { id: 'b', text: 'B', choices: [] },
    ],
  }
  const session = new StorySession(story)
  assert.equal(session.choose('start', 0), true)
  assert.equal(session.current().id, 'a')
  assert.equal(session.choose('start', 1), false)
  session.restart()
  session.choose('start', 1)
  assert.equal(session.current().id, 'b')
  session.close()
  session.restart()
  assert.equal(session.current().id, 'b')
  assert.throws(
    () =>
      validateStory({
        ...story,
        scenes: [{ ...story.scenes[0], choices: [{ label: 'Loop', next: 'start' }] }, ...story.scenes.slice(1)],
      }),
    /cycle/,
  )
  assert.throws(() => validateStory({ ...story, start: 'missing' }), /missing/)
})

test('studio bounds names, raw commands, order, cue count, spacing and duration', () => {
  const timeline = {
    version: 1,
    title: 'Hello',
    durationMs: 3000,
    cues: [
      { at: 0, motion: 'nod' },
      { at: 1500, reaction: 'success' },
    ],
  }
  validateStudio(timeline)
  for (const value of [
    { ...timeline, durationMs: 30001 },
    { ...timeline, cues: Array(33).fill({ at: 0, motion: 'nod' }) },
    { ...timeline, cues: [{ at: 0, head: { yaw: 999 } }] },
    {
      ...timeline,
      cues: [
        { at: 0, motion: 'nod' },
        { at: 100, reaction: 'success' },
      ],
    },
    { ...timeline, cues: [{ at: 2900, motion: 'nod' }] },
    { ...timeline, cues: [{ at: 0, reaction: 'unknown' }] },
  ])
    assert.throws(() => validateStudio(value))
})
