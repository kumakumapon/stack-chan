import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })

const { default: Timer } = await import('../testing/fakes/timer.js')
const { TimelineClock } = await import('./timeline-clock.js')

type Log = string[]

function harness(maxCatchUpMs?: number) {
  Timer.reset()
  let now = 0
  const log: Log = []
  const clock = new TimelineClock({ now: () => now, maxCatchUpMs })
  const callbacks = {
    fire: (index: number, lateMs: number) => log.push(`fire ${index} +${lateMs}`),
    skip: (index: number, lateMs: number) => log.push(`skip ${index} +${lateMs}`),
    done: () => log.push('done'),
  }
  // Wall clock and Timer advance together; `drift` lets a test make the Timer fire late.
  const advance = (ms: number, drift = 0) => {
    now += ms + drift
    Timer.advance(ms)
  }
  return { clock, callbacks, log, advance }
}

test('entries fire at their absolute times and the timeline completes at its duration', () => {
  const { clock, callbacks, log, advance } = harness()
  clock.start([{ at: 0 }, { at: 100 }, { at: 250 }], 400, callbacks)
  assert.deepEqual(log, ['fire 0 +0'])
  advance(100)
  assert.deepEqual(log, ['fire 0 +0', 'fire 1 +0'])
  advance(150)
  assert.deepEqual(log, ['fire 0 +0', 'fire 1 +0', 'fire 2 +0'])
  assert.equal(clock.running, true)
  advance(150)
  assert.deepEqual(log.at(-1), 'done')
  assert.equal(clock.running, false)
  assert.equal(clock.nextIndex, 3)
})

test('a late timer delays only the entry it carried; later entries stay on the beat', () => {
  const { clock, callbacks, log, advance } = harness()
  clock.start([{ at: 100 }, { at: 200 }, { at: 300 }], 300, callbacks)
  advance(100, 60) // wall clock reads 160 when the 100 ms timer fires
  assert.deepEqual(log, ['fire 0 +60'])
  advance(40) // wall clock 200: the second entry is due now, not at 260
  assert.deepEqual(log, ['fire 0 +60', 'fire 1 +0'])
  advance(100)
  assert.deepEqual(log, ['fire 0 +60', 'fire 1 +0', 'fire 2 +0', 'done'])
})

test('a stall inside the catch-up window replays the overdue entries in order', () => {
  const { clock, callbacks, log, advance } = harness(1000)
  clock.start([{ at: 100 }, { at: 200 }, { at: 300 }], 1000, callbacks)
  advance(100, 250) // wall clock jumps to 350 in one go
  assert.deepEqual(log, ['fire 0 +250', 'fire 1 +150', 'fire 2 +50'])
})

test('entries beyond the catch-up window are skipped, not burst-fired', () => {
  const { clock, callbacks, log, advance } = harness(100)
  clock.start([{ at: 100 }, { at: 200 }, { at: 500 }], 600, callbacks)
  advance(100, 300) // wall clock 400: entry 0 is 300 late, entry 1 is 200 late
  assert.deepEqual(log, ['skip 0 +300', 'skip 1 +200'])
  advance(100)
  assert.deepEqual(log.at(-1), 'fire 2 +0')
})

test('stop clears the pending timer and reports nothing further', () => {
  const { clock, callbacks, log, advance } = harness()
  clock.start([{ at: 100 }], 200, callbacks)
  clock.stop()
  assert.equal(clock.running, false)
  advance(500)
  assert.deepEqual(log, [])
})

test('restarting from inside a callback abandons the old run cleanly', () => {
  const { clock, log, advance } = harness()
  const second = {
    fire: (index: number) => log.push(`second ${index}`),
    skip: () => log.push('second skip'),
    done: () => log.push('second done'),
  }
  clock.start([{ at: 0 }, { at: 50 }], 100, {
    fire: (index: number) => {
      log.push(`first ${index}`)
      if (index === 0) clock.start([{ at: 0 }, { at: 30 }], 60, second)
    },
    skip: () => log.push('first skip'),
    done: () => log.push('first done'),
  })
  assert.deepEqual(log, ['first 0', 'second 0'])
  advance(30)
  assert.deepEqual(log, ['first 0', 'second 0', 'second 1'])
  advance(30)
  assert.deepEqual(log, ['first 0', 'second 0', 'second 1', 'second done'])
  advance(100)
  assert.equal(log.length, 4)
})

test('elapsed and startedAt follow the injected clock', () => {
  const { clock, callbacks, advance } = harness()
  assert.equal(clock.elapsed(), 0)
  advance(40)
  clock.start([], 500, callbacks)
  assert.equal(clock.startedAt, 40)
  advance(120)
  assert.equal(clock.elapsed(), 120)
})
