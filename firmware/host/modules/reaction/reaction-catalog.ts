/**
 * Named reactions, spelled out as data. Every entry here is a
 * `ReactionTimeline` that satisfies `validateTimeline` from reaction-limits:
 * head moves stay inside the yaw/pitch clamp, frames are in time order, and
 * head targets are never closer together than the minimum servo spacing. A
 * MOD, an agent tool or a PC client can only ever ask for one of these by
 * name — this file is the one place that turns a name into motion.
 */

import type { ReactionFrame, ReactionName, ReactionTimeline } from 'reaction-types'

function timeline(name: ReactionName, frames: readonly ReactionFrame[], durationMs: number): ReactionTimeline {
  for (const frame of frames) Object.freeze(frame)
  return Object.freeze({ name, frames: Object.freeze(frames), durationMs })
}

const YES: ReactionTimeline = timeline(
  'yes',
  [
    { at: 0, emotion: 'HAPPY', head: { pitch: 0.2, durationMs: 220 } },
    { at: 220, head: { pitch: -0.05, durationMs: 200 } },
    { at: 420, head: { pitch: 0.2, durationMs: 200 } },
    { at: 620, head: { pitch: 0, durationMs: 200 } },
  ],
  850,
)

const NO: ReactionTimeline = timeline(
  'no',
  [
    { at: 0, emotion: 'DOUBTFUL', head: { yaw: -0.35, durationMs: 220 } },
    { at: 220, head: { yaw: 0.35, durationMs: 220 } },
    { at: 440, head: { yaw: -0.3, durationMs: 220 } },
    { at: 660, head: { yaw: 0, durationMs: 220 } },
  ],
  900,
)

const GREETING: ReactionTimeline = timeline(
  'greeting',
  [
    { at: 0, emotion: 'HAPPY', hand: 'wave', head: { pitch: -0.12, durationMs: 250 } },
    { at: 250, effect: 'heart' },
    { at: 1200, effect: null },
  ],
  1400,
)

const THINKING: ReactionTimeline = timeline(
  'thinking',
  [
    { at: 0, emotion: 'DOUBTFUL', hand: 'thinking', head: { yaw: 0.18, durationMs: 300 } },
    { at: 1400, effect: 'sweat' },
  ],
  1800,
)

const DELIGHTED: ReactionTimeline = timeline(
  'delighted',
  [
    {
      at: 0,
      emotion: 'HAPPY',
      hand: 'cheer',
      effect: 'heart',
      light: { r: 255, g: 180, b: 60, durationMs: 400 },
      head: { pitch: -0.1, durationMs: 180 },
    },
    { at: 180, head: { pitch: 0.08, durationMs: 180 } },
    { at: 360, head: { pitch: -0.05, durationMs: 180 } },
    { at: 540, head: { pitch: 0, durationMs: 180 } },
  ],
  900,
)

const SLEEPY_YAWN: ReactionTimeline = timeline(
  'sleepy-yawn',
  [
    { at: 0, emotion: 'SLEEPY', mouth: { open: 0 }, eyes: { leftOpen: 0.8, rightOpen: 0.8 } },
    { at: 400, mouth: { open: 0.5 } },
    {
      at: 800,
      mouth: { open: 0.8 },
      eyes: { leftOpen: 0.4, rightOpen: 0.4 },
      effect: 'sleepy',
      head: { pitch: 0.18, durationMs: 900 },
    },
    { at: 1700, mouth: { open: 0.3 }, eyes: { leftOpen: 0.2, rightOpen: 0.2 } },
    { at: 2200, mouth: { open: 0 }, eyes: { leftOpen: 0.1, rightOpen: 0.1 } },
  ],
  2500,
)

const SUCCESS: ReactionTimeline = timeline(
  'success',
  [
    {
      at: 0,
      emotion: 'HAPPY',
      hand: 'clap',
      effect: 'heart',
      light: { r: 60, g: 220, b: 90, durationMs: 600 },
      head: { pitch: -0.1, durationMs: 220 },
    },
    { at: 220, head: { pitch: 0, durationMs: 220 } },
  ],
  850,
)

const FAILURE: ReactionTimeline = timeline(
  'failure',
  [
    {
      at: 0,
      emotion: 'SAD',
      effect: 'tear',
      light: { r: 70, g: 110, b: 200, durationMs: 500 },
      head: { pitch: 0.22, durationMs: 260 },
    },
    { at: 260, head: { pitch: 0.28, durationMs: 260 } },
  ],
  850,
)

export const REACTION_CATALOG: Readonly<Record<ReactionName, ReactionTimeline>> = Object.freeze({
  yes: YES,
  no: NO,
  greeting: GREETING,
  thinking: THINKING,
  delighted: DELIGHTED,
  'sleepy-yawn': SLEEPY_YAWN,
  success: SUCCESS,
  failure: FAILURE,
})

export function reactionTimeline(name: ReactionName): ReactionTimeline {
  return REACTION_CATALOG[name]
}
