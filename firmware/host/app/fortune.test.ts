import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  drawFortune,
  FORTUNE_ACTIONS,
  FORTUNE_COLORS,
  FORTUNE_RANKS,
  FORTUNE_SHAKE_FRAMES,
  FORTUNE_SHAKE_INTERVAL,
  FORTUNE_WEIGHTS,
  type FortuneOptions,
  FortuneTeller,
  fortuneRankFor,
  localDayNumber,
  parseFortuneRecord,
} from './fortune.js'

const SHAKE_MS = FORTUNE_SHAKE_FRAMES * FORTUNE_SHAKE_INTERVAL

function harness(options: Partial<FortuneOptions> & { saved?: unknown; day?: number | null } = {}) {
  let now = 0
  let day: number | null = options.day === undefined ? 20000 : options.day
  let saved: unknown = options.saved
  const writes: string[] = []
  const reveals: string[] = []
  const effects: { active: boolean }[] = []
  const timers: { at: number; active: boolean; fire(): void }[] = []
  const randoms: number[] = []
  const make = () =>
    new FortuneTeller({
      random: () => randoms.shift() ?? 0,
      schedule(fire, delay) {
        const timer = { at: now + delay, active: true, fire }
        timers.push(timer)
        return () => {
          timer.active = false
        }
      },
      today: () => day,
      storage: {
        get: () => saved,
        set(value) {
          writes.push(value)
          saved = value
        },
      },
      onReveal(draw) {
        reveals.push(draw.rank)
        const effect = { active: true }
        effects.push(effect)
        return () => {
          effect.active = false
        }
      },
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
  return {
    make,
    advance,
    writes,
    reveals,
    effects,
    randoms,
    timers,
    setDay(value: number | null) {
      day = value
    },
  }
}

test('weighted ranks cover the whole unit interval in declared order without an unlucky slip', () => {
  const total = FORTUNE_RANKS.reduce((sum, rank) => sum + FORTUNE_WEIGHTS[rank], 0)
  const counts = new Map<string, number>()
  for (let step = 0; step < total; step++) {
    const rank = fortuneRankFor((step + 0.5) / total)
    counts.set(rank, (counts.get(rank) ?? 0) + 1)
  }
  for (const rank of FORTUNE_RANKS) assert.equal(counts.get(rank), FORTUNE_WEIGHTS[rank], rank)
  assert.equal(fortuneRankFor(0), FORTUNE_RANKS[0])
  assert.equal(fortuneRankFor(1), FORTUNE_RANKS[FORTUNE_RANKS.length - 1])
  assert.ok(FORTUNE_RANKS.includes(fortuneRankFor(Number.NaN)))
})

test('a draw always names a valid rank, action and color', () => {
  for (const value of [0, 0.25, 0.5, 0.999, 1, Number.NaN]) {
    const draw = drawFortune(() => value)
    assert.ok(FORTUNE_RANKS.includes(draw.rank))
    assert.ok(FORTUNE_ACTIONS.includes(draw.action))
    assert.ok(FORTUNE_COLORS.includes(draw.color))
  }
})

test('local day numbers follow the configured offset across midnight', () => {
  const utcMidnight = Date.UTC(2026, 10, 4)
  const jst = 9 * 60
  assert.equal(localDayNumber(utcMidnight - 1, 0), localDayNumber(utcMidnight, 0) - 1)
  // 15:00 UTC is midnight in Japan.
  assert.equal(localDayNumber(utcMidnight + 15 * 3600000 - 1, jst), localDayNumber(utcMidnight, jst))
  assert.equal(localDayNumber(utcMidnight + 15 * 3600000, jst), (localDayNumber(utcMidnight, jst) as number) + 1)
  assert.equal(localDayNumber(Number.NaN, 0), null)
})

test('saved records round-trip and reject other versions or unknown values', () => {
  const record = { version: 1, day: 20000, rank: 'great', action: 'water', color: 'blue' }
  assert.deepEqual(parseFortuneRecord(JSON.stringify(record)), record)
  for (const raw of [
    undefined,
    '',
    '{',
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, day: -1 }),
    JSON.stringify({ ...record, day: 1.5 }),
    JSON.stringify({ ...record, rank: 'bad' }),
    JSON.stringify({ ...record, action: 'nap' }),
    JSON.stringify({ ...record, color: 'black' }),
  ])
    assert.equal(parseFortuneRecord(raw), undefined, String(raw))
})

test('a dated slip shakes, reveals once, is saved and locks until the next day', () => {
  const h = harness()
  const teller = h.make()
  assert.equal(teller.snapshot().phase, 'ready')
  assert.equal(teller.snapshot().canDraw, true)
  teller.draw()
  assert.equal(teller.snapshot().phase, 'shaking')
  teller.draw()
  h.advance(SHAKE_MS - 1)
  assert.equal(teller.snapshot().phase, 'shaking')
  h.randoms.push(0, 0, 0.99)
  h.advance(1)
  const state = teller.snapshot()
  assert.equal(state.phase, 'revealed')
  assert.deepEqual(state.draw, {
    rank: FORTUNE_RANKS[0],
    action: FORTUNE_ACTIONS[0],
    color: FORTUNE_COLORS[FORTUNE_COLORS.length - 1],
  })
  assert.equal(state.canDraw, false)
  assert.deepEqual(h.reveals, [FORTUNE_RANKS[0]], 'a second tap while shaking does not draw twice')
  assert.equal(h.writes.length, 1)
  assert.deepEqual(parseFortuneRecord(h.writes[0]), { version: 1, day: 20000, ...state.draw })
  teller.draw()
  assert.equal(teller.snapshot().phase, 'revealed', 'no second slip today')
  h.setDay(20001)
  assert.equal(teller.snapshot().canDraw, true, 'a new day allows a new slip without reopening')
})

test("reopening on the same day shows today's slip; another day starts fresh", () => {
  const saved = JSON.stringify({ version: 1, day: 20000, rank: 'small', action: 'sky', color: 'pink' })
  const today = harness({ saved }).make().snapshot()
  assert.equal(today.phase, 'revealed')
  assert.equal(today.repeat, true)
  assert.deepEqual(today.draw, { rank: 'small', action: 'sky', color: 'pink' })
  assert.equal(today.canDraw, false)
  const tomorrow = harness({ saved, day: 20001 }).make().snapshot()
  assert.equal(tomorrow.phase, 'ready')
  assert.equal(tomorrow.draw, null)
  const corrupted = harness({ saved: '{"version":1' }).make().snapshot()
  assert.equal(corrupted.phase, 'ready')
})

test('an unsynced clock neither loads, saves nor limits slips', () => {
  const saved = JSON.stringify({ version: 1, day: 20000, rank: 'small', action: 'sky', color: 'pink' })
  const h = harness({ saved, day: null })
  const teller = h.make()
  assert.equal(teller.snapshot().phase, 'ready')
  assert.equal(teller.snapshot().dated, false)
  teller.draw()
  h.advance(SHAKE_MS)
  assert.equal(teller.snapshot().phase, 'revealed')
  assert.equal(teller.snapshot().canDraw, true)
  assert.deepEqual(h.writes, [])
  teller.draw()
  h.advance(SHAKE_MS)
  assert.deepEqual(h.reveals.length, 2)
})

test('storage and effect failures keep the revealed slip', () => {
  const h = harness({
    storage: {
      get() {
        throw new Error('nvs unavailable')
      },
      set() {
        throw new Error('nvs full')
      },
    },
    onReveal() {
      throw new Error('servo busy')
    },
  })
  const teller = h.make()
  teller.draw()
  h.advance(SHAKE_MS)
  assert.equal(teller.snapshot().phase, 'revealed')
  assert.equal(teller.snapshot().saveFailed, true)
})

test('closing or redrawing cancels only the optional effect of the previous slip', () => {
  const h = harness({ day: null })
  const teller = h.make()
  teller.draw()
  h.advance(SHAKE_MS)
  assert.equal(h.effects[0].active, true)
  teller.draw()
  assert.equal(h.effects[0].active, false, 'a new draw stops the previous gesture')
  h.advance(SHAKE_MS)
  assert.equal(h.effects[1].active, true)
  teller.close()
  assert.equal(h.effects[1].active, false, 'closing stops the current gesture')
})

test('close cancels the shake and ignores later draws', () => {
  const h = harness()
  const teller = h.make()
  teller.draw()
  teller.close()
  assert.equal(
    h.timers.some((timer) => timer.active),
    false,
  )
  h.advance(SHAKE_MS * 2)
  teller.draw()
  assert.equal(teller.snapshot().phase, 'closed')
  assert.deepEqual(h.reveals, [])
})
