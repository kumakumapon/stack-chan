import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyPetEvent,
  createPetState,
  decodePetState,
  encodePetState,
  levelForXp,
  restorePetState,
  unlockedReactions,
} from './pet-state.js'

test('petting is bounded and rapid taps cannot farm experience', () => {
  const first = applyPetEvent(createPetState(), { type: 'petted', now: 1000 })
  assert.equal(first.state.bond, 22)
  assert.equal(first.state.xp, 3)
  const repeated = applyPetEvent(first.state, { type: 'tap', now: 2000 })
  assert.equal(repeated.state.xp, 3)
  assert.equal(repeated.changed, false)
  const later = applyPetEvent(repeated.state, { type: 'tap', now: 6000 })
  assert.equal(later.state.xp, 6)
  assert.equal(later.state.pettings, 2)
})

test('an unset clock still enforces cooldowns and a backward clock recovers after restart', () => {
  const first = applyPetEvent(createPetState(), { type: 'petted', now: 0 }).state
  assert.equal(applyPetEvent(first, { type: 'tap', now: 1000 }).state.xp, 3)
  const afterRestart = applyPetEvent(first, { type: 'boot', now: 0 }).state
  const later = applyPetEvent(afterRestart, { type: 'petted', now: 5000 }).state
  const resetClock = applyPetEvent(later, { type: 'boot', now: 0 }).state
  assert.equal(applyPetEvent(resetClock, { type: 'petted', now: 100 }).state.xp, 9)
})

test('elapsed time restores energy without punishing absence', () => {
  const start = applyPetEvent(createPetState(), { type: 'boot', now: 1000 }).state
  const played = applyPetEvent(start, { type: 'gameFinished', score: 8, now: 2000 }).state
  assert.equal(played.energy, 75)
  const middle = applyPetEvent(played, { type: 'boot', now: 301000 }).state
  assert.equal(middle.energy, 75)
  const recovered = applyPetEvent(middle, { type: 'boot', now: 601000 }).state
  assert.equal(recovered.energy, 76)
  assert.equal(recovered.bond, played.bond)
  assert.equal(applyPetEvent(recovered, { type: 'boot', now: 100000000 }).state.energy, 100)
})

test('level-up unlocks a new reaction once at the threshold', () => {
  const before = { ...createPetState(), xp: 18, level: 1 }
  const result = applyPetEvent(before, { type: 'petted', now: 1000 })
  assert.equal(result.state.level, 2)
  assert.equal(result.levelUp, true)
  assert.equal(unlockedReactions(result.state.level).delighted, true)
  const repeated = applyPetEvent(result.state, { type: 'petted', now: 2000 })
  assert.equal(repeated.levelUp, false)
  assert.equal(levelForXp(21), 2)
})

test('saved values migrate, clamp and recover safely from corrupt data', () => {
  const migrated = restorePetState({ version: 0, bond: 200, energy: -10, curiosity: 30, xp: 20 })
  assert.equal(migrated.version, 1)
  assert.equal(migrated.bond, 100)
  assert.equal(migrated.energy, 0)
  assert.equal(migrated.level, 2)
  assert.deepEqual(restorePetState({ version: 99, bond: 99 }), createPetState())
  assert.deepEqual(restorePetState(null), createPetState())
  assert.equal(restorePetState({ version: 1, xp: Number.NaN }).xp, 0)
  assert.deepEqual(decodePetState('{broken'), createPetState())
  assert.deepEqual(decodePetState(encodePetState(migrated)), migrated)
})

test('only named future events affect state; scores never escape bounds', () => {
  const initial = createPetState()
  assert.deepEqual(applyPetEvent(initial, { type: 'setBond', bond: 100, now: 1 }).state, initial)
  const result = applyPetEvent(
    { ...initial, energy: 2, curiosity: 99 },
    { type: 'gameFinished', score: 100000, now: 1 },
  )
  assert.equal(result.state.energy, 0)
  assert.equal(result.state.curiosity, 100)
  assert.ok(result.state.xp <= 10)
  const repeated = applyPetEvent(result.state, { type: 'gameFinished', score: 1000, now: 100 })
  assert.equal(repeated.state.xp, result.state.xp)
  assert.equal(levelForXp(Number.NaN), 1)
  const capped = applyPetEvent(
    { ...initial, interactions: 100000, pettings: 100000, games: 100000 },
    { type: 'petted', now: 1 },
  )
  assert.equal(capped.state.interactions, 100000)
  assert.equal(capped.state.pettings, 100000)
})
