import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createWasmPreference } from './preference.js'

function persistence(initial: string | null = null) {
  let saved = initial
  return {
    get: () => saved,
    set: (value: string) => {
      saved = value
    },
    delete: () => {
      saved = null
    },
  }
}

test('only the timer domain/key survives a new WASM session; Pet state stays independent', () => {
  const pet = persistence('pet growth')
  const focus = persistence()
  const first = createWasmPreference(pet, focus)
  first.set('stackchan_focus', 'state', 'timer session')
  first.set('stackchan_focus', 'other', 'temporary')
  first.set('other', 'state', 'temporary')
  const second = createWasmPreference(pet, focus)
  assert.equal(second.get('stackchan_focus', 'state'), 'timer session')
  assert.deepEqual(second.keys('stackchan_focus'), ['state'])
  assert.equal(second.get('stackchan_focus', 'other'), undefined)
  assert.equal(second.get('other', 'state'), undefined)
  assert.equal(pet.get(), 'pet growth')
  second.delete('stackchan_focus', 'state')
  assert.equal(focus.get(), null)
  assert.equal(pet.get(), 'pet growth')
  assert.deepEqual(second.keys('stackchan_focus'), [])
})

test('timer persistence errors reach the caller without committing an in-memory phantom save', () => {
  const pet = persistence('pet growth')
  const focus = persistence('old timer')
  focus.set = () => {
    throw new Error('quota exceeded')
  }
  const preference = createWasmPreference(pet, focus)
  assert.throws(() => preference.set('stackchan_focus', 'state', 'new timer'), /quota exceeded/)
  assert.equal(preference.get('stackchan_focus', 'state'), 'old timer')
  assert.equal(pet.get(), 'pet growth')
  assert.throws(() => preference.set('stackchan_focus', 'state', 123), /must be a string/)
})

test('daily apps persist independently across WASM sessions without leaking into other domains', () => {
  const pet = persistence('pet')
  const focus = persistence('focus')
  const daily = { quest: persistence(), quiz: persistence() }
  const first = createWasmPreference(pet, focus, daily)
  first.set('stackchan_quest', 'state', 'quest')
  first.set('stackchan_quiz', 'state', 'quiz')
  first.set('stackchan_quiz', 'other', 'temporary')
  const second = createWasmPreference(pet, focus, daily)
  assert.equal(second.get('stackchan_quest', 'state'), 'quest')
  assert.equal(second.get('stackchan_quiz', 'state'), 'quiz')
  assert.equal(second.get('stackchan_quiz', 'other'), undefined)
  assert.deepEqual(second.keys('stackchan_quiz'), ['state'])
  second.delete('stackchan_quest', 'state')
  assert.deepEqual(second.keys('stackchan_quest'), [])
  assert.equal(second.get('stackchan_quiz', 'state'), 'quiz')
  assert.equal(pet.get(), 'pet')
  assert.equal(focus.get(), 'focus')
})

test('daily save failures reach the app without a phantom memory commit', () => {
  const daily = { quest: persistence('before'), quiz: persistence('quiz') }
  daily.quest.set = () => {
    throw new Error('quota')
  }
  const preference = createWasmPreference(undefined, undefined, daily)
  assert.throws(() => preference.set('stackchan_quest', 'state', 'after'), /quota/)
  assert.equal(preference.get('stackchan_quest', 'state'), 'before')
  assert.equal(preference.get('stackchan_quiz', 'state'), 'quiz')
})
