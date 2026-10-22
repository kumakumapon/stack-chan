import assert from 'node:assert/strict'
import { test } from 'node:test'
import { RHYTHM_GAME_ROUNDS, RhythmGame } from './rhythm-game.js'

function harness() {
  let now = 0
  let available = true
  const timers: { at: number; active: boolean; fire(): void }[] = []
  const tones: { at: number; active: boolean }[] = []
  const results: number[] = []
  const game = new RhythmGame({
    now: () => now,
    schedule(fire, delay) {
      const timer = { at: now + delay, active: true, fire }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    tone() {
      if (!available) return undefined
      const tone = { at: now, active: true }
      tones.push(tone)
      return () => {
        tone.active = false
      }
    },
    onResult: (score) => results.push(score),
  })
  const advance = (ms: number) => {
    const target = now + ms
    for (let guard = 0; guard < 100; guard++) {
      const timer = timers.filter((t) => t.active && t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!timer) {
        now = target
        return
      }
      now = timer.at
      timer.active = false
      timer.fire()
    }
    throw new Error('timer loop')
  }
  const demonstrate = () => {
    const beats: number[] = []
    const unsubscribe = game.subscribe((s) => {
      if (s.phase === 'showing' && s.pulse) beats.push(now)
    })
    while (game.snapshot().phase === 'showing') advance(20)
    unsubscribe()
    assert.equal(game.snapshot().phase, 'input')
    return beats.slice(1).map((time, index) => time - beats[index])
  }
  const tap = (hold = 0) => {
    const at = now
    advance(hold)
    game.tap(at)
  }
  return {
    game,
    tones,
    timers,
    results,
    advance,
    demonstrate,
    tap,
    now: () => now,
    busy: () => {
      available = false
    },
  }
}

test('copies the demonstrated intervals through every round, independent of first-tap reaction time', () => {
  const h = harness()
  h.game.start()
  let previousBeats = 0
  const rhythms = new Set<string>()
  for (let round = 1; round <= RHYTHM_GAME_ROUNDS; round++) {
    const intervals = h.demonstrate()
    assert(intervals.length >= previousBeats)
    previousBeats = intervals.length
    rhythms.add(intervals.join(','))
    h.advance(3500)
    h.tap()
    for (const interval of intervals) {
      h.advance(interval)
      h.tap()
    }
    assert.equal(h.game.snapshot().round, round)
    assert.equal(h.game.snapshot().phase, round === RHYTHM_GAME_ROUNDS ? 'complete' : 'won')
    if (round < RHYTHM_GAME_ROUNDS) h.game.start()
  }
  assert(rhythms.size > 1)
  assert.deepEqual(h.results, [RHYTHM_GAME_ROUNDS])
  h.game.tap(h.now())
  h.game.replay()
  assert.deepEqual(h.results, [RHYTHM_GAME_ROUNDS], 'no duplicate completion')
  h.game.start()
  assert.equal(h.game.snapshot().round, 1)
})

test('accepts human timing variation and uses press time despite different release delays', () => {
  const h = harness()
  h.game.start()
  const [gap] = h.demonstrate()
  h.tap(200)
  h.advance(gap - 200 + 100)
  h.tap(50)
  h.advance(gap - 50 - 100)
  h.tap(300)
  assert.equal(h.game.snapshot().phase, 'won')
})

test('a release at the latest accepted press and hold boundary beats the missing-input timeout', () => {
  const h = harness()
  h.game.start()
  const [gap] = h.demonstrate()
  h.tap()
  h.advance(gap * 1.25)
  h.tap(300)
  assert.equal(h.game.snapshot().matched, 2)
  assert.equal(h.game.snapshot().phase, 'input')
})

for (const [scale, reason] of [
  [0.4, 'early'],
  [1.4, 'late'],
] as const) {
  test(`rejects ${reason} beats and retries the same pattern`, () => {
    const h = harness()
    h.game.start()
    const pattern = h.demonstrate()
    h.tap()
    h.advance(pattern[0] * scale)
    h.tap()
    assert.equal(h.game.snapshot().phase, 'lost')
    assert.equal(h.game.snapshot().reason, reason)
    h.game.start()
    assert.deepEqual(h.demonstrate(), pattern)
    assert.equal(h.game.snapshot().round, 1)
    assert.deepEqual(h.results, [])
  })
}

test('ignores early, malformed, duplicate and stale taps; a rapid burst cannot win', () => {
  const h = harness()
  h.game.tap(h.now())
  h.game.start()
  h.game.tap(h.now())
  h.demonstrate()
  for (const at of [Number.NaN, Infinity, -1, h.now() + 100]) h.game.tap(at)
  assert.equal(h.game.snapshot().matched, 0)
  h.tap()
  for (let i = 0; i < 10; i++) {
    h.advance(5)
    h.tap()
  }
  assert.equal(h.game.snapshot().matched, 1)
  h.advance(150)
  h.tap()
  assert.equal(h.game.snapshot().phase, 'lost')
})

test('missing first or later beats time out without a result; replay resets the input deadline', () => {
  const h = harness()
  h.game.start()
  const pattern = h.demonstrate()
  h.advance(13000)
  assert.equal(h.game.snapshot().reason, 'timeout')
  h.game.replay()
  assert.deepEqual(h.demonstrate(), pattern)
  h.tap()
  h.advance(2000)
  assert.equal(h.game.snapshot().reason, 'timeout')
  assert.deepEqual(h.results, [])
  h.game.replay()
  h.demonstrate()
  h.advance(11000)
  h.game.replay()
  h.demonstrate()
  h.advance(2000)
  assert.equal(h.game.snapshot().phase, 'input')
})

test('silent and busy modes keep visual cues and grading; mute, replay and close cancel only owned work', () => {
  const h = harness()
  h.game.start()
  h.advance(600)
  assert(h.tones[0].active)
  h.game.setSound(false)
  assert(!h.tones[0].active)
  h.demonstrate()
  assert.equal(h.tones.length, 1)
  h.game.setSound(true)
  h.busy()
  h.game.replay()
  const pattern = h.demonstrate()
  assert(h.game.snapshot().muted)
  h.tap()
  for (const interval of pattern) {
    h.advance(interval)
    h.tap()
  }
  assert.equal(h.game.snapshot().phase, 'won')
  h.game.start()
  h.game.close()
  h.game.close()
  for (const timer of h.timers) timer.fire()
  assert.equal(h.game.snapshot().phase, 'closed')
  assert(!h.timers.some((t) => t.active))
  assert(!h.tones.some((t) => t.active))
  assert.deepEqual(h.results, [])
})
