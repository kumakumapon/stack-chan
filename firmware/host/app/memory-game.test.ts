import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createMemoryGameScheduler,
  MEMORY_GAME_MAX_ROUNDS,
  MEMORY_GAME_SYMBOLS,
  MemoryGame,
  type MemoryGameOptions,
} from './memory-game.js'

function harness(random = () => 0, motionBlockReason?: MemoryGameOptions['motionBlockReason']) {
  const timers: { fire(): void; active: boolean; delay: number }[] = []
  const effects: { name: string; cancelled: boolean }[] = []
  const results: number[] = []
  const game = new MemoryGame({
    random,
    motionBlockReason,
    schedule(callback, delay) {
      const timer = { fire: callback, active: true, delay }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    react(name) {
      const effect = { name, cancelled: false }
      effects.push(effect)
      return () => {
        effect.cancelled = true
      }
    },
    onResult: (score) => results.push(score),
  })
  const active = () => timers.filter((timer) => timer.active)
  const step = () => {
    const timer = active()[0]
    assert(timer, 'one scheduled transition expected')
    assert.equal(active().length, 1, 'at most one timer can be owned')
    timer.active = false
    timer.fire()
  }
  const show = () => {
    const sequence: string[] = []
    let guard = 0
    while (game.snapshot().phase !== 'input') {
      assert(++guard < 50, 'presentation must finish')
      step()
      if (game.snapshot().phase === 'showing') sequence.push(game.snapshot().symbol as string)
    }
    return sequence
  }
  return { game, timers, effects, results, active, step, show }
}

test('motion reports a blocking conversation, keeps the game playable, and resumes after it stops', () => {
  let blocked = true
  const h = harness(
    () => 0,
    () => (blocked ? 'conversation' : null),
  )
  assert.equal(h.game.snapshot().motionBlockReason, null, 'OFF has no waiting warning')
  h.game.setMotion(true)
  assert.equal(h.game.snapshot().motionBlockReason, 'conversation')
  h.game.start()
  h.show()
  assert.equal(h.effects.length, 0)
  h.game.answer('yes')
  h.step()
  assert.equal(h.game.snapshot().phase, 'won')
  assert.equal(h.effects.length, 0)
  blocked = false
  h.game.next()
  h.step()
  assert.equal(h.game.snapshot().motionBlockReason, null)
  assert.equal(h.effects[0].name, 'yes')
})

test('motion checks activity again at cue time and OFF clears the waiting warning', () => {
  let busy = false
  const h = harness(
    () => 0,
    () => (busy ? 'busy' : null),
  )
  h.game.setMotion(true)
  h.game.start()
  busy = true
  h.step()
  assert.equal(h.game.snapshot().motionBlockReason, 'busy')
  assert.equal(h.effects.length, 0)
  h.game.setMotion(false)
  assert.equal(h.game.snapshot().motionBlockReason, null)
  assert.equal(h.game.snapshot().motion, false)
})

test('offline presentation separates repeated symbols, blocks early input, and extends the same sequence', () => {
  let random = 0
  const h = harness(() => random)
  h.game.answer('yes')
  h.game.next()
  assert.equal(h.game.snapshot().phase, 'ready')
  h.game.start()
  h.game.start()
  h.game.answer('yes')
  assert.deepEqual(h.show(), ['yes'])
  h.game.answer('yes')
  h.game.answer('yes')
  assert.equal(h.game.snapshot().matched, 1)
  assert.equal(h.game.snapshot().phase, 'feedback')
  h.step()
  assert.equal(h.game.snapshot().phase, 'won')
  assert.equal(h.game.snapshot().score, 1)
  assert.equal(h.active().length, 0, 'next round requires a tap')
  h.game.next()
  h.game.next()
  assert.deepEqual(h.show(), ['yes', 'yes'], 'a blank gap must separate identical cues')
  h.game.answer('yes')
  h.game.answer('yes')
  assert.equal(h.game.snapshot().matched, 1, 'rapid duplicate must not answer another symbol')
  h.step()
  h.game.answer('yes')
  h.step()
  random = 0.99
  h.game.next()
  assert.deepEqual(h.show(), ['yes', 'yes', 'greeting'])
  assert.equal(h.effects.length, 0, 'motion is opt-in and no audio is needed')
})

test('a wrong answer ends once, reveals the expected symbol, and retry resets the score', () => {
  const h = harness(() => 0.5)
  h.game.start()
  h.show()
  h.game.answer('no')
  h.step()
  h.game.next()
  h.show()
  h.game.answer('greeting')
  assert.equal(h.game.snapshot().phase, 'lost')
  assert.equal(h.game.snapshot().symbol, 'no')
  assert.deepEqual(h.results, [1])
  h.game.answer('yes')
  h.game.next()
  assert.deepEqual(h.results, [1])
  assert.equal(h.active().length, 0)
  h.game.start()
  assert.equal(h.game.snapshot().score, 0)
  assert.deepEqual(h.show(), ['no'])
})

test('all twelve rounds complete once with bounded sequence length and no automatic replay', () => {
  const h = harness()
  h.game.start()
  for (let round = 1; round <= MEMORY_GAME_MAX_ROUNDS; round++) {
    assert.equal(h.show().length, round)
    for (let answer = 0; answer < round; answer++) {
      h.game.answer('yes')
      h.step()
    }
    assert.equal(h.game.snapshot().score, round)
    if (round < MEMORY_GAME_MAX_ROUNDS) h.game.next()
  }
  assert.equal(h.game.snapshot().phase, 'complete')
  assert.deepEqual(h.results, [MEMORY_GAME_MAX_ROUNDS])
  h.game.next()
  h.game.answer('yes')
  assert.equal(h.active().length, 0)
  assert.deepEqual(h.results, [MEMORY_GAME_MAX_ROUNDS])
})

test('close in every timed phase rejects stale callbacks, inputs and restart', () => {
  for (const target of ['gap', 'showing', 'input', 'feedback', 'won', 'lost'] as const) {
    const h = harness()
    let changes = 0
    h.game.subscribe(() => changes++)
    h.game.setMotion(true)
    h.game.start()
    if (target === 'showing') h.step()
    if (['input', 'feedback', 'won', 'lost'].includes(target)) h.show()
    if (target === 'feedback' || target === 'won') h.game.answer('yes')
    if (target === 'won') h.step()
    if (target === 'lost') h.game.answer('no')
    assert.equal(h.game.snapshot().phase, target)
    h.game.close()
    h.game.close()
    const before = changes
    for (const timer of h.timers) timer.fire()
    h.game.start()
    h.game.next()
    h.game.answer('yes')
    h.game.setMotion(true)
    assert.equal(h.game.snapshot().phase, 'closed')
    assert.equal(changes, before)
    assert.equal(h.active().length, 0)
    assert(h.effects.every((effect) => effect.cancelled))
  }
})

test('switching motion off cancels only its owned handle and does not interrupt the game', () => {
  const h = harness()
  h.game.setMotion(true)
  h.game.start()
  h.step()
  assert.equal(h.effects[0].name, 'yes')
  h.game.setMotion(false)
  assert(h.effects[0].cancelled)
  h.show()
  h.game.answer('yes')
  h.step()
  assert.equal(h.game.snapshot().phase, 'won')
  assert.equal(h.effects.length, 1)
})

test('invalid random values stay within the three supported symbols', () => {
  for (const value of [NaN, Infinity, -3, 1, 25]) {
    const h = harness(() => value)
    h.game.start()
    const shown = h.show()
    assert(MEMORY_GAME_SYMBOLS.some((symbol) => symbol === shown[0]))
  }
})

test('native scheduler clears fired and cancelled handles exactly once', () => {
  type Handle = { fire(): void }
  const retained = new Set<Handle>()
  const handles: Handle[] = []
  let calls = 0
  const schedule = createMemoryGameScheduler({
    set(callback: (handle: Handle) => void) {
      const handle = { fire: () => callback(handle) }
      handles.push(handle)
      retained.add(handle)
      return handle
    },
    clear(handle: Handle) {
      assert(retained.delete(handle))
    },
  })
  for (let index = 0; index < 100; index++) {
    const cancel = schedule(() => calls++, 100)
    handles.at(-1)?.fire()
    cancel()
  }
  const cancel = schedule(() => calls++, 100)
  cancel()
  cancel()
  handles.at(-1)?.fire()
  assert.equal(calls, 100)
  assert.equal(retained.size, 0)
})
