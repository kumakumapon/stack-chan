import type { HeadTarget, ReactionFrame, ReactionTimeline } from 'reaction-types'

/**
 * The one place a reaction's motion is bounded. Anything that reaches the
 * servos through a reaction or a performance passes through here, so an agent
 * tool, a MOD or a PC client asking for "delighted" cannot make the head swing
 * further or faster than a person would when writing the catalog by hand.
 *
 * Yaw matches the ±π/6 clamp the shipped petting reaction already applies to
 * itself (on-context-created.ts), so nothing here moves further sideways than
 * the firmware has already been seen to. Pitch is tighter than petting's own
 * floor of −π/4: a catalog entry written by hand does not need that much, and
 * an agent-chosen reaction should not get it. Petting does not pass through
 * here and is unaffected. The MiniStack MOD's proven PoC limits (±0.25 / ±0.15
 * rad) sit inside both.
 */
export const REACTION_LIMITS = Object.freeze({
  yawRad: Math.PI / 6,
  pitchRad: Math.PI / 8,
  minHeadDurationMs: 150,
  maxHeadDurationMs: 3000,
  /** Two head targets closer together than this collapse into one servo move that never finishes. */
  minHeadSpacingMs: 150,
  maxFrames: 48,
  maxDurationMs: 15000,
  defaultHeadDurationMs: 220,
})

export function clamp(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-limit, Math.min(limit, value))
}

/**
 * Clamps a head target and scales it by intensity. Clamping comes first so an
 * out-of-range request at half intensity moves half as far as the robot would
 * actually go, never the full limit. An axis the target leaves unset stays
 * unset: the player holds the pre-reaction value for it.
 */
export function clampHead(target: HeadTarget, intensity = 1): HeadTarget & { durationMs: number } {
  const scale = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 1
  const duration = target.durationMs ?? REACTION_LIMITS.defaultHeadDurationMs
  const result: HeadTarget & { durationMs: number } = {
    durationMs: Number.isFinite(duration)
      ? Math.max(REACTION_LIMITS.minHeadDurationMs, Math.min(REACTION_LIMITS.maxHeadDurationMs, duration))
      : REACTION_LIMITS.defaultHeadDurationMs,
  }
  if (target.yaw !== undefined) result.yaw = clamp(target.yaw, REACTION_LIMITS.yawRad) * scale
  if (target.pitch !== undefined) result.pitch = clamp(target.pitch, REACTION_LIMITS.pitchRad) * scale
  return result
}

function clamp01(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value)) return undefined
  return Math.max(0, Math.min(1, value))
}

/** Returns why a timeline is unplayable, or undefined when it is. Rejects rather than repairs structure. */
export function validateTimeline(timeline: ReactionTimeline): string | undefined {
  if (!Array.isArray(timeline.frames) || timeline.frames.length === 0) return 'timeline has no frames'
  if (timeline.frames.length > REACTION_LIMITS.maxFrames) return `timeline exceeds ${REACTION_LIMITS.maxFrames} frames`
  if (!Number.isFinite(timeline.durationMs) || timeline.durationMs <= 0) return 'timeline duration must be positive'
  if (timeline.durationMs > REACTION_LIMITS.maxDurationMs) return `timeline exceeds ${REACTION_LIMITS.maxDurationMs} ms`
  let previousAt = -1
  let previousHeadAt = -Infinity
  for (const frame of timeline.frames) {
    if (!Number.isFinite(frame.at) || frame.at < 0) return 'frame time must be a non-negative number'
    if (frame.at < previousAt) return 'frames must be in time order'
    if (frame.at > timeline.durationMs) return 'frame is after the timeline ends'
    if (frame.head) {
      if (frame.at - previousHeadAt < REACTION_LIMITS.minHeadSpacingMs)
        return `head targets must be at least ${REACTION_LIMITS.minHeadSpacingMs} ms apart`
      previousHeadAt = frame.at
    }
    previousAt = frame.at
  }
  return undefined
}

/** A frame with every numeric field brought inside its limit. Structure is left as is. */
export function clampFrame(frame: ReactionFrame, intensity = 1): ReactionFrame {
  const clamped: ReactionFrame = { at: frame.at }
  if (frame.emotion !== undefined) clamped.emotion = frame.emotion
  if (frame.hand !== undefined) clamped.hand = frame.hand
  if (frame.effect !== undefined) clamped.effect = frame.effect
  if (frame.eyes) {
    clamped.eyes = { leftOpen: clamp01(frame.eyes.leftOpen), rightOpen: clamp01(frame.eyes.rightOpen) }
  }
  if (frame.mouth) clamped.mouth = { open: clamp01(frame.mouth.open) }
  if (frame.head) clamped.head = clampHead(frame.head, intensity)
  if (frame.light) {
    const channel = (value: number) => Math.max(0, Math.min(255, Math.round(Number.isFinite(value) ? value : 0)))
    clamped.light = {
      r: channel(frame.light.r),
      g: channel(frame.light.g),
      b: channel(frame.light.b),
      ...(frame.light.durationMs !== undefined ? { durationMs: frame.light.durationMs } : {}),
    }
  }
  return clamped
}
