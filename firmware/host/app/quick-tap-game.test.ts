import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseQuickTapRecord,
  QUICK_TAP_ROUNDS,
  QUICK_TAP_TIMING,
  QuickTapGame,
  type QuickTapGameOptions,
  quickTapRank,
} from './quick-tap-game.js'

function harness(options: Partial<QuickTapGameOptions> & { saved?: unknown } = {}) {
  let now = 0
  let toneAvailable = true
  let saved: unknown = options.saved
  const writes: string[] = []
  const timers: { at: number; active: boolean; fire(): void }[] = []
  const tones: { active: boolean }[] = []
  const results: number[] = []
  const randoms: number[] = []
  const game = new QuickTapGame({
    now: () => now,
    random: () => randoms.shift() ?? 0,
    schedule(fire, delay) {
      const timer = { at: now + delay, active: true, fire }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    tone() {
      if (!toneAvailable) return undefined
      const tone = { active: true }
      tones.push(tone)
      return () => {
        tone.active = false
      }
    },
    storage: {
      get: () => saved,
      set(value) {
        writes.push(value)
        saved = value
      },
    },
    onResult: (score) => results.push(score),
    ...options,
  })
  const advance = (ms: number) => {
    const target = now + ms
    while (true) {
      const timer = timers.filter((entry) => entry.active && entry.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!timer) break
      now = timer.at
      timer.active = false
      timer.fire()
    }
    now = target
  }
  /** Advance until "now!" and return the go time. */
  const toGo = () => {
    while (game.snapshot().phase === 'waiting') advance(10)
    assert.equal(game.snapshot().phase, 'go')
    return now
  }
  const toNextRound = () => advance(QUICK_TAP_TIMING.result)
  return {
    game,
    advance,
    toGo,
    toNextRound,
    tones,
    writes,
    results,
    randoms,
    timers,
    now: () => now,
    setToneAvailable(value: boolean) {
      toneAvailable = value
    },
  }
}

test('ranks are monotonic in reaction time', () => {
  const order = ['lightning', 'fast', 'good', 'relaxed']
  let previous = 0
  for (let ms = QUICK_TAP_TIMING.anticipation; ms <= QUICK_TAP_TIMING.window; ms += 10) {
    const rank = order.indexOf(quickTapRank(ms))
    assert.ok(rank >= previous, `rank must not improve when slower (${ms} ms)`)
    previous = rank
  }
})

test('saved records accept only whole milliseconds inside the playable window', () => {
  assert.equal(parseQuickTapRecord('241'), 241)
  assert.equal(parseQuickTapRecord(300), 300)
  for (const raw of [
    undefined,
    '',
    'fast',
    '12.5',
    '-200',
    QUICK_TAP_TIMING.anticipation - 1,
    QUICK_TAP_TIMING.window + 1,
    Number.NaN,
    {},
  ])
    assert.equal(parseQuickTapRecord(raw), null, `reject ${String(raw)}`)
})

test('the signal waits a random delay inside the configured range', () => {
  for (const random of [0, 1, 0.5, Number.NaN]) {
    const h = harness()
    h.randoms.push(random)
    h.game.start()
    const go = h.toGo()
    assert.ok(go >= QUICK_TAP_TIMING.minDelay && go <= QUICK_TAP_TIMING.maxDelay, `delay ${go} for ${random}`)
  }
})

test('a tap before the signal or faster than anticipation is a false start', () => {
  const h = harness()
  h.game.start()
  h.game.tap(h.now())
  assert.equal(h.game.snapshot().phase, 'early')
  assert.equal(h.game.snapshot().hits, 0)
  h.advance(QUICK_TAP_TIMING.result - 1)
  assert.equal(h.game.snapshot().phase, 'early', 'a false start cancels that round signal')
  h.advance(1)
  assert.equal(h.game.snapshot().phase, 'waiting')
  assert.equal(h.game.snapshot().round, 2, 'the false start used up its round')
  const h2 = harness()
  h2.game.start()
  const go = h2.toGo()
  h2.game.tap(go + QUICK_TAP_TIMING.anticipation - 1)
  assert.equal(h2.game.snapshot().phase, 'early')
})

test('a timely tap records the reaction time and a missing tap is too slow', () => {
  const h = harness()
  h.game.start()
  let go = h.toGo()
  h.advance(240)
  h.game.tap(go + 240)
  let state = h.game.snapshot()
  assert.equal(state.phase, 'hit')
  assert.equal(state.lastMs, 240)
  assert.equal(state.bestMs, 240)
  h.game.tap(go + 300)
  assert.equal(h.game.snapshot().hits, 1, 'one verdict per round')
  h.toNextRound()
  assert.equal(h.game.snapshot().round, 2)
  go = h.toGo()
  h.advance(QUICK_TAP_TIMING.window)
  state = h.game.snapshot()
  assert.equal(state.phase, 'slow')
  assert.equal(state.lastMs, null)
  assert.equal(state.bestMs, 240)
})

test('a set always ends after the last round, reports hits once and saves only an improved record', () => {
  const h = harness({ saved: '300' })
  assert.equal(h.game.snapshot().recordMs, 300)
  h.game.start()
  const times = [420, 260, 0, 380, 500]
  for (const [index, ms] of times.entries()) {
    const go = h.toGo()
    if (ms > 0) {
      h.advance(ms)
      h.game.tap(go + ms)
    } else h.advance(QUICK_TAP_TIMING.window)
    if (index < QUICK_TAP_ROUNDS - 1) h.toNextRound()
  }
  h.advance(QUICK_TAP_TIMING.result)
  let state = h.game.snapshot()
  assert.equal(state.phase, 'complete')
  assert.equal(state.hits, 4)
  assert.equal(state.bestMs, 260)
  assert.equal(state.newRecord, true)
  assert.equal(state.recordMs, 260)
  assert.deepEqual(h.writes, ['260'])
  assert.deepEqual(h.results, [4])
  h.advance(60000)
  assert.equal(h.game.snapshot().phase, 'complete', 'no automatic restart')

  h.game.start()
  for (let index = 0; index < QUICK_TAP_ROUNDS; index++) {
    const go = h.toGo()
    h.advance(400)
    h.game.tap(go + 400)
    h.toNextRound()
  }
  state = h.game.snapshot()
  assert.equal(state.phase, 'complete')
  assert.equal(state.newRecord, false)
  assert.equal(state.recordMs, 260)
  assert.deepEqual(h.writes, ['260'], 'a slower set keeps the record untouched')
  assert.deepEqual(h.results, [4, QUICK_TAP_ROUNDS])
})

test('storage failures are shown without losing the in-memory record', () => {
  const h = harness({
    storage: {
      get() {
        throw new Error('nvs unavailable')
      },
      set() {
        throw new Error('nvs full')
      },
    },
  })
  assert.equal(h.game.snapshot().recordMs, null)
  h.game.start()
  for (let index = 0; index < QUICK_TAP_ROUNDS; index++) {
    const go = h.toGo()
    h.advance(300)
    h.game.tap(go + 300)
    h.toNextRound()
  }
  const state = h.game.snapshot()
  assert.equal(state.phase, 'complete')
  assert.equal(state.saveFailed, true)
  assert.equal(state.recordMs, 300)
  h.game.start()
  assert.equal(h.game.snapshot().saveFailed, false, 'a new set clears the previous save error')
})

test('the cue is owned, optional and silent when sound is off or the host is busy', () => {
  const h = harness()
  h.game.start()
  const go = h.toGo()
  assert.equal(h.tones.length, 1)
  assert.equal(h.tones[0].active, true)
  h.advance(200)
  h.game.tap(go + 200)
  assert.equal(h.tones[0].active, false, 'the verdict releases our cue')
  h.toNextRound()
  h.setToneAvailable(false)
  h.toGo()
  assert.equal(h.game.snapshot().muted, true, 'a busy host keeps the visual signal')
  h.advance(QUICK_TAP_TIMING.window)
  h.toNextRound()
  h.game.setSound(false)
  h.setToneAvailable(true)
  h.toGo()
  assert.equal(h.tones.length, 1, 'sound off never starts a cue')
  assert.equal(h.game.snapshot().muted, false)
})

test('close cancels the pending signal and our cue, then ignores input', () => {
  const h = harness()
  h.game.start()
  h.toGo()
  h.game.close()
  assert.equal(
    h.timers.some((timer) => timer.active),
    false,
  )
  assert.equal(h.tones[0].active, false)
  h.game.tap(h.now())
  h.game.start()
  h.advance(60000)
  assert.equal(h.game.snapshot().phase, 'closed')
})
