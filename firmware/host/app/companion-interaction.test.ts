import assert from 'node:assert/strict'
import test from 'node:test'
import type { TouchPanelInputEvent } from '../modules/input/input-event.js'
import type { ReactionName } from '../modules/reaction/reaction-types.js'
import { CompanionInteraction } from './companion-interaction.js'

function harness() {
  let now = 0
  let available = true
  let intensity = 0.25
  let active: ReactionName | null = null
  let token = 0
  let cancellations = 0
  const played: { name: ReactionName; intensity: number | undefined }[] = []
  const timers = new Set<{ at: number; callback(): void }>()
  const interaction = new CompanionInteraction({
    now: () => now,
    available: () => available,
    intensity: () => intensity,
    trace: () => {},
    timer: {
      set(callback, delay) {
        const handle = { at: now + delay, callback }
        timers.add(handle)
        return handle
      },
      clear(handle) {
        timers.delete(handle as { at: number; callback(): void })
      },
    },
    reaction: {
      status: () => ({ active, startedAt: active ? now : null }),
      playOwned(name, options) {
        if (active) return { ok: false, error: 'busy' }
        active = name
        const owner = ++token
        played.push({ name, intensity: options?.intensity })
        return {
          ok: true,
          cancel() {
            if (!active || token !== owner) return false
            active = null
            cancellations++
            return true
          },
        }
      },
    },
  })
  const advance = (delay: number) => {
    const target = now + delay
    for (;;) {
      const due = [...timers].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      now = due.at
      timers.delete(due)
      due.callback()
    }
    now = target
  }
  const send = (gesture: TouchPanelInputEvent['gesture'], tap = false) =>
    interaction.touch({
      gesture,
      ticks: now,
      ...(tap ? { tap: { durationMs: 100, maxMovement: 0, position: 0 } } : {}),
    })
  const tap = () => {
    send('press')
    advance(100)
    send('release', true)
  }
  return {
    interaction,
    advance,
    send,
    tap,
    played,
    timers,
    names: () => played.map((p) => p.name),
    busy: () => {
      available = false
    },
    free: () => {
      available = true
    },
    quiet: () => {
      intensity = 0
    },
    finish: () => {
      active = null
    },
    userReaction(name: ReactionName) {
      active = name
      token++
    },
    active: () => active,
    cancellations: () => cancellations,
  }
}

test('a short head tap gets one quick hello, then later taps vary the response', () => {
  const h = harness()
  h.tap()
  assert.deepEqual(h.names(), [], 'wait briefly for a possible second tap')
  h.advance(500)
  assert.deepEqual(h.names(), ['head-hello'])
  h.finish()
  h.advance(2000)
  h.tap()
  h.advance(500)
  assert.deepEqual(h.names(), ['head-hello', 'nose-boop'])
})

test('double and triple taps coalesce into one playful response rather than a reaction per tap', () => {
  for (const count of [2, 3]) {
    const h = harness()
    for (let i = 0; i < count; i++) {
      h.tap()
      h.advance(100)
    }
    h.advance(500)
    assert.deepEqual(h.names(), ['tickled'])
  }
})

test('a stationary hold cuddles once and release does not turn it into a tap', () => {
  const h = harness()
  h.send('press')
  h.advance(700)
  assert.deepEqual(h.names(), [])
  h.advance(500)
  assert.deepEqual(h.names(), ['head-cuddle'])
  h.advance(3000)
  h.send('release')
  h.advance(500)
  assert.deepEqual(h.names(), ['head-cuddle'])
})

test('a swipe cancels a pending hold and responds only if no reciprocal petting follows', () => {
  for (const [gesture, expected] of [
    ['forwardSwipe', 'look-touch-right'],
    ['backwardSwipe', 'look-touch-left'],
  ] as const) {
    const h = harness()
    h.send('press')
    h.advance(150)
    h.send(gesture)
    h.advance(100)
    h.send('release')
    h.advance(1000)
    assert.deepEqual(h.names(), [], 'leave the petting recognition window open')
    h.advance(1000)
    assert.deepEqual(h.names(), [expected])
  }
})

test('reciprocal strokes leave the face and head to the existing petting routine', () => {
  const h = harness()
  h.send('forwardSwipe')
  h.advance(500)
  h.send('backwardSwipe')
  h.advance(2000)
  assert.deepEqual(h.names(), [])
  assert.equal(h.interaction.faceTap(), false, 'do not overwrite the five-second petting expression')
  h.advance(3500)
  assert.equal(h.interaction.faceTap(), true)
})

test('busy contexts drop taps, holds and deferred swipes instead of queueing them', () => {
  for (const mode of ['tap', 'hold', 'swipe']) {
    const h = harness()
    if (mode === 'tap') h.tap()
    else {
      h.send('press')
      if (mode === 'swipe') {
        h.advance(100)
        h.send('forwardSwipe')
      }
    }
    h.busy()
    h.advance(2500)
    h.free()
    h.advance(5000)
    assert.deepEqual(h.names(), [], mode)
  }
})

test('opening another activity cancels only the interaction-owned reaction', () => {
  const h = harness()
  h.interaction.faceTap()
  h.busy()
  h.advance(200)
  assert.equal(h.active(), null)
  assert.equal(h.cancellations(), 1)
  h.free()
  h.advance(3000)
  assert.deepEqual(h.names(), ['head-hello'])
})

test('an external reaction, even the same name, is never cancelled or replaced by a touch or cleanup', () => {
  const h = harness()
  h.interaction.faceTap()
  h.userReaction('head-hello')
  h.advance(1500)
  assert.equal(h.interaction.faceTap(), false)
  assert.equal(h.interaction.reserveLegacy(), false)
  h.interaction.close()
  assert.equal(h.active(), 'head-hello')
  assert.equal(h.cancellations(), 0)
})

test('manual reactions take priority before the first touch as well', () => {
  const h = harness()
  h.userReaction('greeting')
  h.tap()
  h.advance(500)
  assert.deepEqual(h.names(), [])
  assert.equal(h.active(), 'greeting')
})

test('cooldown bounds rapid face taps and quiet mode passes zero head intensity', () => {
  const h = harness()
  h.quiet()
  assert.equal(h.interaction.faceTap(), true)
  for (let i = 0; i < 20; i++) h.interaction.faceTap()
  assert.equal(h.played.length, 1)
  assert.equal(h.played[0].intensity, 0)
})

test('legacy IMU/petting can take over an owned reaction and reserve the face temporarily', () => {
  const h = harness()
  h.interaction.faceTap()
  assert.equal(h.interaction.reserveLegacy(), true)
  assert.equal(h.active(), null)
  assert.equal(h.interaction.faceTap(), false)
  h.advance(5100)
  assert.equal(h.interaction.faceTap(), true)
})

test('duplicate/stale sensor events cannot farm taps or trigger actions after shutdown', () => {
  const h = harness()
  h.tap()
  h.send('release', true)
  h.interaction.touch({
    gesture: 'release',
    ticks: -1,
    tap: { durationMs: 10, maxMovement: 0, position: 0 },
  })
  h.advance(500)
  assert.deepEqual(h.names(), ['head-hello'])
  h.interaction.close()
  h.advance(5000)
  h.tap()
  h.advance(5000)
  assert.deepEqual(h.names(), ['head-hello'])
  assert.equal(h.timers.size, 0)
})
