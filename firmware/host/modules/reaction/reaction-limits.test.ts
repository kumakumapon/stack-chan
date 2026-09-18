import assert from 'node:assert/strict'
import { test } from 'node:test'

import { clampFrame, clampHead, REACTION_LIMITS, validateTimeline } from './reaction-limits.js'
import type { ReactionTimeline } from './reaction-types.js'

const timeline = (frames: ReactionTimeline['frames'], durationMs = 1000): ReactionTimeline => ({
  name: 'yes',
  frames,
  durationMs,
})

test('head targets are clamped to the limits, never rejected', () => {
  const head = clampHead({ yaw: 9, pitch: -9, durationMs: 99999 })
  assert.equal(head.yaw, REACTION_LIMITS.yawRad)
  assert.equal(head.pitch, -REACTION_LIMITS.pitchRad)
  assert.equal(head.durationMs, REACTION_LIMITS.maxHeadDurationMs)
})

test('intensity scales amplitude before clamping and is itself bounded to 0..1', () => {
  assert.equal(clampHead({ yaw: 0.2 }, 0.5).yaw, 0.1)
  assert.equal(clampHead({ yaw: 0.2 }, 5).yaw, 0.2)
  assert.equal(clampHead({ yaw: 0.2 }, -1).yaw, 0)
})

test('non-finite numbers become safe values instead of reaching the servos', () => {
  const head = clampHead({ yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY, durationMs: Number.NaN })
  assert.deepEqual(head, { yaw: 0, pitch: 0, durationMs: REACTION_LIMITS.defaultHeadDurationMs })
})

test('a too-short head move is stretched to the minimum, because the driver ignores duration anyway', () => {
  assert.equal(clampHead({ yaw: 0.1, durationMs: 1 }).durationMs, REACTION_LIMITS.minHeadDurationMs)
})

test('eyes, mouth and light channels are clamped per field', () => {
  const frame = clampFrame({
    at: 0,
    eyes: { leftOpen: 2, rightOpen: -1 },
    mouth: { open: 1.5 },
    light: { r: 300, g: -5, b: 12.6 },
  })
  assert.deepEqual(frame.eyes, { leftOpen: 1, rightOpen: 0 })
  assert.deepEqual(frame.mouth, { open: 1 })
  assert.deepEqual(frame.light, { r: 255, g: 0, b: 13 })
})

test('a frame changes only what it names', () => {
  // Unset fields must stay unset after clamping, or a frame that only sets a
  // hand would also reset the emotion and effect.
  const frame = clampFrame({ at: 100, hand: 'wave' })
  assert.deepEqual(frame, { at: 100, hand: 'wave' })
})

test('structural problems are rejected, not repaired', () => {
  assert.equal(validateTimeline(timeline([])), 'timeline has no frames')
  assert.equal(validateTimeline(timeline([{ at: 0 }], 0)), 'timeline duration must be positive')
  assert.equal(validateTimeline(timeline([{ at: 500 }, { at: 100 }])), 'frames must be in time order')
  assert.equal(validateTimeline(timeline([{ at: 2000 }], 1000)), 'frame is after the timeline ends')
  assert.equal(validateTimeline(timeline([{ at: -1 }])), 'frame time must be a non-negative number')
  assert.match(validateTimeline(timeline([{ at: 0 }], REACTION_LIMITS.maxDurationMs + 1)) ?? '', /exceeds/)
})

test('head targets too close together are rejected', () => {
  // Two targets inside one servo move collapse into a move that never finishes.
  const tooClose = timeline([
    { at: 0, head: { yaw: 0.1 } },
    { at: 50, head: { yaw: -0.1 } },
  ])
  assert.match(validateTimeline(tooClose) ?? '', /at least/)
  const ok = timeline([
    { at: 0, head: { yaw: 0.1 } },
    { at: REACTION_LIMITS.minHeadSpacingMs, head: { yaw: -0.1 } },
  ])
  assert.equal(validateTimeline(ok), undefined)
})

test('non-head frames may be as dense as they like', () => {
  const dense = timeline([
    { at: 0, emotion: 'HAPPY' },
    { at: 10, effect: 'heart' },
    { at: 20, hand: 'clap' },
  ])
  assert.equal(validateTimeline(dense), undefined)
})
