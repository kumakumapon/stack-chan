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
