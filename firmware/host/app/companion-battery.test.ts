import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  type CompanionBatteryTimer,
  createCompanionBattery,
  INITIAL_LOW_BATTERY_STATE,
  LOW_BATTERY_THRESHOLDS,
  type LowBatteryEvent,
  type LowBatteryState,
  nextLowBatteryState,
} from './companion-battery.js'

function run(levels: (number | undefined)[]): { events: (LowBatteryEvent | undefined)[]; state: LowBatteryState } {
  let state = INITIAL_LOW_BATTERY_STATE
  const events: (LowBatteryEvent | undefined)[] = []
  for (const level of levels) {
    const step = nextLowBatteryState(state, level)
    state = step.state
    events.push(step.event)
  }
  return { events, state }
}
const defined = (events: (LowBatteryEvent | undefined)[]) => events.filter((event) => event !== undefined)

test('a low first reading enters once; a high first reading emits nothing', () => {
  assert.deepEqual(defined(run([5, 5, 5, 5]).events), ['enter'])
  assert.deepEqual(defined(run([90, 80, 70]).events), [])
})

test('a single dip is not confirmed, two consecutive low samples are', () => {
  assert.deepEqual(defined(run([80, 5, 80, 5, 80]).events), [])
  assert.deepEqual(defined(run([80, 5, 5]).events), ['enter'])
})

test('oscillation around the boundaries yields exactly one enter and one recover', () => {
  const low = 10
  const high = 90
  // Alternating while inside the hysteresis band must not toggle the state.
  const mid = (LOW_BATTERY_THRESHOLDS.enterAt + LOW_BATTERY_THRESHOLDS.exitAt) / 2
  const sequence = [high, low, low, mid, low, mid, low, high, high, mid, high, mid]
  assert.deepEqual(defined(run(sequence).events), ['enter', 'recover'])
})

test('a notified low state recovers only after leaving the band, then can enter again', () => {
  const events = defined(run([5, 5, 50, 50, 5, 5, 50, 50, 5, 5]).events)
  assert.deepEqual(events, ['enter', 'recover', 'enter', 'recover', 'enter'])
})

test('missing and out-of-range samples leave the state unchanged and never notify twice', () => {
  const missing = [undefined, Number.NaN, -1, 101, Number.POSITIVE_INFINITY]
  const base = run([5, 5]).state
  for (const bad of missing) {
    const step = nextLowBatteryState(base, bad)
    assert.deepEqual(step.state, base)
    assert.equal(step.event, undefined)
  }
  // Dropouts between samples do not reset or retrigger a notified state.
  assert.deepEqual(defined(run([5, undefined, 5, Number.NaN, 5, -3, 5]).events), ['enter'])
  // A pending recovery survives a dropout.
  assert.deepEqual(defined(run([5, 80, undefined, 80]).events), ['enter', 'recover'])
})

test('without any valid sample there is never an event', () => {
  const { events, state } = run([undefined, Number.NaN, -5, 500, undefined])
  assert.deepEqual(defined(events), [])
  assert.equal(state.low, false)
})

function fakeTimer() {
  const pending = new Map<number, { cb: () => void; due: number }>()
  let id = 0
  let now = 0
  const timer: CompanionBatteryTimer = {
    set(cb, delay) {
      id += 1
      pending.set(id, { cb, due: now + delay })
      return id
    },
    clear(handle) {
      pending.delete(handle as number)
    },
  }
  return {
    timer,
    count: () => pending.size,
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        const next = [...pending.entries()].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        pending.delete(next[0])
        now = next[1].due
        next[1].cb()
      }
      now = end
    },
  }
}

test('adapter without a reader creates nothing and schedules no timer', () => {
  const clock = fakeTimer()
  assert.equal(createCompanionBattery({ readLevel: undefined, timer: clock.timer, onLow: () => true }), undefined)
  assert.equal(createCompanionBattery({ readLevel: null, timer: clock.timer, onLow: () => true }), undefined)
  assert.equal(clock.count(), 0)
})

test('adapter with a reader that never yields a level stays silent', () => {
  const clock = fakeTimer()
  let notices = 0
  const battery = createCompanionBattery({
    readLevel: () => undefined,
    timer: clock.timer,
    onLow: () => {
      notices += 1
      return true
    },
  })
  clock.advance(10 * 60000)
  assert.equal(notices, 0)
  assert.equal(battery?.isLow(), false)
  battery?.close()
})

test('adapter notifies once while low, again only after recovery, and stops on close', () => {
  const clock = fakeTimer()
  let level: number | undefined = 5
  let notices = 0
  const battery = createCompanionBattery({
    readLevel: () => level,
    timer: clock.timer,
    onLow: () => {
      notices += 1
      return true
    },
  })
  clock.advance(10 * 60000)
  assert.equal(notices, 1)
  assert.equal(battery?.isLow(), true)
  level = 90
  clock.advance(5 * 60000)
  assert.equal(battery?.isLow(), false)
  assert.equal(notices, 1)
  level = 5
  clock.advance(5 * 60000)
  assert.equal(notices, 2)
  battery?.close()
  assert.equal(clock.count(), 0)
  level = 90
  clock.advance(10 * 60000)
  assert.equal(notices, 2)
})

test('adapter retries a refused notice without consuming it', () => {
  const clock = fakeTimer()
  let allowed = false
  let shown = 0
  const battery = createCompanionBattery({
    readLevel: () => 5,
    timer: clock.timer,
    onLow: () => {
      if (!allowed) return false
      shown += 1
      return true
    },
  })
  clock.advance(5 * 60000)
  assert.equal(shown, 0)
  allowed = true
  clock.advance(2 * 60000)
  assert.equal(shown, 1)
  clock.advance(10 * 60000)
  assert.equal(shown, 1)
  battery?.close()
})

test('adapter survives a throwing reader and keeps polling', () => {
  const clock = fakeTimer()
  let throwing = true
  let notices = 0
  const battery = createCompanionBattery({
    readLevel: () => {
      if (throwing) throw new Error('i2c failure')
      return 5
    },
    timer: clock.timer,
    onLow: () => {
      notices += 1
      return true
    },
  })
  clock.advance(5 * 60000)
  assert.equal(notices, 0)
  throwing = false
  clock.advance(2 * 60000)
  assert.equal(notices, 1)
  battery?.close()
})
