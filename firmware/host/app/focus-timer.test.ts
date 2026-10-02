import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from './companion-idle.js'
import { FOCUS_TIMER_PRESETS, FocusTimerModel, type FocusTimerState } from './focus-timer-model.js'

const appRoot = dirname(fileURLToPath(import.meta.url))
writeAliasPackage(appRoot, 'focus-timer-model', resolve(appRoot, 'focus-timer-model.js'))
const { FocusTimerService } = await import('./focus-timer-service.js')

function harness(saved?: unknown) {
  let now = 0
  let hiddenAt: number | undefined
  let fails = false
  const context = {}
  const timers: { callback(): void; due: number; active: boolean }[] = []
  const writes: string[] = []
  const service = new FocusTimerService({
    now: () => now,
    schedule(callback, delay) {
      const timer = { callback, due: now + delay, active: true }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    storage: {
      get() {
        return saved
      },
      set(value) {
        if (fails) throw new Error('save unavailable')
        writes.push(value)
        saved = value
      },
    },
    suppressIdle: () => suppressCompanionIdle(context),
    takeHiddenAt() {
      const at = hiddenAt
      hiddenAt = undefined
      return at
    },
  })
  const activeCount = () => timers.filter((timer) => timer.active).length
  return {
    service,
    context,
    timers,
    writes,
    activeCount,
    failWrites: (value: boolean) => {
      fails = value
    },
    setNow: (value: number) => {
      now = value
    },
    hide: () => {
      hiddenAt ??= now
    },
    advance(ms: number) {
      now += ms
      const due = timers.filter((timer) => timer.active && timer.due <= now)
      for (const timer of due) {
        timer.active = false
        timer.callback()
      }
    },
  }
}

test('all offline presets, double start and exact deadline complete only once', () => {
  for (const [preset, { durationMs, phase }] of Object.entries(FOCUS_TIMER_PRESETS)) {
    let now = 0
    const model = new FocusTimerModel(() => now)
    model.start(preset as keyof typeof FOCUS_TIMER_PRESETS)
    const generation = model.snapshot().generation
    assert.equal(model.start(), false)
    assert.equal(model.snapshot().generation, generation)
    assert.equal(model.snapshot().phase, phase)
    now = durationMs - 1
    assert.equal(model.elapsed(), false)
    assert.equal(model.snapshot().remainingMs, 1)
    now++
    assert.equal(model.elapsed(), true)
    assert.equal(model.elapsed(), false)
    assert.equal(model.snapshot().state, 'completed')
    assert.equal(model.snapshot().remainingMs, 0)
  }
})

test('late callbacks use the deadline, publish completion once and never start a break', () => {
  const h = harness()
  const states: FocusTimerState[] = []
  h.service.subscribe((snapshot) => states.push(snapshot.state))
  h.service.start('focus-5')
  h.advance(7 * 60 * 1000)
  h.advance(60 * 1000)
  assert.equal(states.filter((state) => state === 'completed').length, 1)
  assert.equal(h.service.getSnapshot().phase, 'focus')
  assert.equal(h.activeCount(), 0)
  assert.equal(isCompanionIdleSuppressed(h.context), false)
  assert.equal(JSON.parse(h.writes.at(-1) ?? '{}').state, 'completed')
})

test('pause freezes the remaining time; resume keeps one timer; cancel restores the preset', () => {
  const h = harness()
  h.service.start('focus-5')
  h.advance(1200)
  h.service.pause()
  h.service.pause()
  const remaining = h.service.getSnapshot().remainingMs
  assert.equal(remaining, 298800)
  assert.equal(h.activeCount(), 0)
  h.advance(500000)
  assert.equal(h.service.getSnapshot().remainingMs, remaining)
  h.service.resume()
  h.service.resume()
  assert.equal(h.activeCount(), 1)
  h.advance(1000)
  assert.equal(h.service.getSnapshot().remainingMs, 297800)
  h.service.cancel()
  h.service.cancel()
  assert.equal(h.activeCount(), 0)
  assert.equal(h.service.getSnapshot().state, 'idle')
  assert.equal(h.service.getSnapshot().remainingMs, 300000)
})

test('a callback captured before cancel/restart cannot complete or clear the new timer', () => {
  const h = harness()
  h.service.start('focus-5')
  const old = h.timers[0]
  h.service.cancel()
  h.service.start('focus-25')
  h.setNow(300000)
  old.callback()
  assert.equal(h.service.getSnapshot().state, 'running')
  assert.equal(h.service.getSnapshot().remainingMs, 1200000)
  assert.equal(h.activeCount(), 1)
})

test('invalid, backwards and throwing clocks interrupt instead of claiming completion', () => {
  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE, -1, 99]) {
    const h = harness()
    h.setNow(100)
    h.service.start()
    h.setNow(invalid)
    assert.equal(h.service.getSnapshot().state, 'interrupted')
    assert.equal(h.service.getSnapshot().remainingMs, null)
    assert.equal(h.activeCount(), 0)
    assert.equal(isCompanionIdleSuppressed(h.context), false)
  }
  const model = new FocusTimerModel(() => {
    throw new Error('clock failed')
  })
  assert.equal(model.start(), false)
  assert.equal(model.snapshot().interruptionReason, 'clock')
})

test('calendar changes cannot affect a monotonic timer', () => {
  const realNow = Date.now
  const h = harness()
  try {
    Date.now = () => -10000000
    h.service.start('focus-5')
    Date.now = () => 9999999999999
    h.advance(1000)
    assert.equal(h.service.getSnapshot().remainingMs, 299000)
  } finally {
    Date.now = realNow
  }
})

test('view subscriptions can close/reopen without duplicating timers or losing elapsed time', () => {
  const h = harness()
  h.service.start('focus-5')
  let disposedUpdates = 0
  for (let index = 0; index < 30; index++) {
    const off = h.service.subscribe(() => disposedUpdates++)
    off()
    off()
  }
  const previous = disposedUpdates
  h.advance(15000)
  assert.equal(disposedUpdates, previous)
  let reopenedRemaining = 0
  h.service.subscribe((snapshot) => {
    reopenedRemaining = snapshot.remainingMs ?? -1
  })
  assert.equal(reopenedRemaining, 285000)
  assert.equal(h.activeCount(), 1)
})

test('only state transitions write storage, and acknowledgement persists the selected setting', () => {
  const h = harness()
  h.service.select('focus-15')
  h.service.start()
  const count = h.writes.length
  for (let index = 0; index < 20; index++) h.advance(1000)
  assert.equal(h.writes.length, count)
  h.advance(900000)
  h.service.acknowledge()
  assert.deepEqual(JSON.parse(h.writes.at(-1) ?? '{}'), { version: 1, preset: 'focus-15', state: 'idle' })
  h.service.start('break-5')
  assert.equal(h.service.getSnapshot().phase, 'break')
})

test('idle suppression is owned only while running and does not overwrite changing settings', () => {
  const h = harness()
  const settings = { idleReactions: true }
  const otherRelease = suppressCompanionIdle(h.context)
  h.service.start()
  settings.idleReactions = false
  h.service.pause()
  assert.equal(isCompanionIdleSuppressed(h.context), true, 'other owner remains')
  otherRelease()
  otherRelease()
  assert.equal(isCompanionIdleSuppressed(h.context), false)
  h.service.resume()
  assert.equal(isCompanionIdleSuppressed(h.context), true)
  otherRelease()
  assert.equal(isCompanionIdleSuppressed(h.context), true, 'an old release cannot remove a new owner')
  h.service.close()
  h.service.close()
  assert.equal(settings.idleReactions, false)
  assert.equal(isCompanionIdleSuppressed(h.context), false)
  assert.equal(h.activeCount(), 0)
  const count = h.writes.length
  h.timers.at(-1)?.callback()
  h.service.start()
  assert.equal(h.writes.length, count)
})

test('running/paused reboot as interrupted and retain only the previous setting', () => {
  for (const state of ['running', 'paused', 'interrupted']) {
    const h = harness(JSON.stringify({ version: 1, preset: 'focus-15', state }))
    assert.equal(h.service.getSnapshot().state, 'interrupted')
    assert.equal(h.service.getSnapshot().remainingMs, null)
    assert.equal(h.activeCount(), 0)
    assert.equal(isCompanionIdleSuppressed(h.context), false)
    h.service.start()
    assert.equal(h.service.getSnapshot().remainingMs, 900000)
  }
})

test('completed recovery remains acknowledgement-only; corrupt/unknown data is safe', () => {
  const h = harness('{"version":1,"preset":"break-5","state":"completed"}')
  assert.equal(h.service.getSnapshot().state, 'completed')
  assert.equal(h.activeCount(), 0)
  assert.equal(h.writes.length, 0, 'restoring completion cannot replay its transition')
  h.service.acknowledge()
  assert.equal(h.service.getSnapshot().preset, 'break-5')
  for (const bad of [null, {}, '{', '{"version":2}', '{"version":1,"preset":"toString","state":"running"}']) {
    assert.equal(harness(bad).service.getSnapshot().state, 'idle')
  }
})

test('saving failures are visible while timing continues and recover on the next transition', () => {
  const h = harness()
  h.failWrites(true)
  h.service.start('focus-5')
  assert.equal(h.service.getSnapshot().storageFailed, true)
  h.advance(1000)
  assert.equal(h.service.getSnapshot().remainingMs, 299000)
  assert.equal(h.writes.length, 0)
  h.failWrites(false)
  h.service.pause()
  assert.equal(h.service.getSnapshot().storageFailed, false)
})

test('a failed read is visible without blocking offline operation', () => {
  const service = new FocusTimerService({
    now: () => 0,
    schedule: () => () => undefined,
    suppressIdle: () => () => undefined,
    storage: {
      get: () => {
        throw new Error('read failed')
      },
      set: () => undefined,
    },
  })
  assert.equal(service.getSnapshot().storageFailed, true)
  service.start()
  assert.equal(service.getSnapshot().state, 'running')
  assert.equal(service.getSnapshot().storageFailed, false)
})

test('hidden time is excluded even when browser callbacks stop until after the deadline', () => {
  const h = harness()
  h.service.start('focus-5')
  h.setNow(2300)
  h.hide()
  h.advance(600000)
  assert.equal(h.service.getSnapshot().state, 'paused')
  assert.equal(h.service.getSnapshot().pauseReason, 'hidden')
  assert.equal(h.service.getSnapshot().remainingMs, 297700)
  assert.equal(isCompanionIdleSuppressed(h.context), false)
  h.advance(600000)
  assert.equal(h.service.getSnapshot().state, 'paused')
  h.service.resume()
  assert.equal(h.service.getSnapshot().state, 'running')
  h.advance(297700)
  assert.equal(h.service.getSnapshot().state, 'completed')
})

test('pause at or after the deadline confirms completion instead of offering a zero-length resume', () => {
  const h = harness()
  h.service.start('focus-5')
  h.setNow(300000)
  h.service.pause()
  assert.equal(h.service.getSnapshot().state, 'completed')
  assert.equal(h.activeCount(), 0)
})

test('subscribers may restart on completion without an old callback arming a second timer', () => {
  const h = harness()
  h.service.subscribe((snapshot) => {
    if (snapshot.state === 'completed') h.service.start('break-5')
  })
  h.service.start('focus-5')
  h.advance(300000)
  assert.equal(h.service.getSnapshot().state, 'running')
  assert.equal(h.service.getSnapshot().phase, 'break')
  assert.equal(h.activeCount(), 1)
})
