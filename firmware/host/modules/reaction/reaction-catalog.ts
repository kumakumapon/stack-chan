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

const SURPRISED = timeline(
  'surprised',
  [
    { at: 0, emotion: 'SURPRISED', mouth: { open: 0.7 }, head: { pitch: -0.18, durationMs: 200 } },
    { at: 600, mouth: { open: 0.3 } },
    { at: 1000, head: { pitch: 0, durationMs: 250 } },
  ],
  1400,
)
const CURIOUS = timeline(
  'curious',
  [
    { at: 0, emotion: 'CURIOUS', hand: 'thinking', head: { yaw: 0.22, pitch: -0.08, durationMs: 350 } },
    { at: 800, head: { yaw: -0.15, pitch: -0.08, durationMs: 400 } },
    { at: 1400, head: { yaw: 0, pitch: 0, durationMs: 350 } },
  ],
  2000,
)
const SHY = timeline(
  'shy',
  [
    { at: 0, emotion: 'SHY', effect: 'heart', head: { yaw: -0.16, pitch: 0.14, durationMs: 400 } },
    { at: 900, head: { yaw: 0.12, pitch: 0.1, durationMs: 400 } },
    { at: 1500, effect: null },
  ],
  1900,
)
const LAUGH = timeline(
  'laugh',
  [
    { at: 0, emotion: 'LAUGHING', hand: 'clap', mouth: { open: 0.6 }, head: { pitch: -0.08, durationMs: 200 } },
    { at: 250, mouth: { open: 0.2 }, head: { pitch: 0.1, durationMs: 200 } },
    { at: 500, mouth: { open: 0.65 }, head: { pitch: -0.08, durationMs: 200 } },
    { at: 750, mouth: { open: 0.2 }, head: { pitch: 0.08, durationMs: 200 } },
    { at: 1000, mouth: { open: 0 }, head: { pitch: 0, durationMs: 200 } },
  ],
  1400,
)
const WINK = timeline(
  'wink',
  [
    { at: 0, emotion: 'WINK', effect: 'heart', head: { yaw: 0.1, durationMs: 250 } },
    { at: 800, emotion: 'HAPPY', effect: null, head: { yaw: 0, durationMs: 250 } },
  ],
  1200,
)
const LOVE = timeline(
  'love',
  [
    { at: 0, emotion: 'SHY', hand: 'cheer', effect: 'heart', light: { r: 255, g: 100, b: 170, durationMs: 600 } },
    { at: 500, emotion: 'LOVE', head: { pitch: -0.12, durationMs: 300 } },
    { at: 1100, head: { pitch: 0, durationMs: 300 } },
  ],
  1800,
)
const PROUD = timeline(
  'proud',
  [
    { at: 0, emotion: 'CONFIDENT', hand: 'cheer', head: { pitch: -0.2, durationMs: 400 } },
    { at: 1000, head: { pitch: 0, durationMs: 300 } },
  ],
  1600,
)
const WORRIED = timeline(
  'worried',
  [
    { at: 0, emotion: 'WORRIED', hand: 'thinking', effect: 'sweat', head: { yaw: -0.12, pitch: 0.1, durationMs: 350 } },
    { at: 700, head: { yaw: 0.12, pitch: 0.1, durationMs: 350 } },
    { at: 1400, head: { yaw: 0, pitch: 0, durationMs: 350 } },
  ],
  2000,
)
const APOLOGIZE = timeline(
  'apologize',
  [
    { at: 0, emotion: 'SAD', hand: 'none', head: { yaw: 0, pitch: 0.3, durationMs: 500 } },
    { at: 1000, head: { pitch: 0.1, durationMs: 500 } },
    { at: 1700, head: { pitch: 0, durationMs: 350 } },
  ],
  2300,
)
const RELIEVED = timeline(
  'relieved',
  [
    { at: 0, emotion: 'WORRIED', mouth: { open: 0.25 } },
    { at: 500, emotion: 'RELAXED', mouth: { open: 0 }, head: { pitch: 0.08, durationMs: 500 } },
    { at: 1200, head: { pitch: 0, durationMs: 400 } },
  ],
  1900,
)
const LISTENING = timeline(
  'listening',
  [
    { at: 0, emotion: 'CURIOUS', head: { yaw: 0.12, pitch: -0.05, durationMs: 400 } },
    { at: 900, head: { yaw: 0, pitch: 0.12, durationMs: 300 } },
    { at: 1200, head: { pitch: 0, durationMs: 300 } },
  ],
  1800,
)
const LOOK_AROUND = timeline(
  'look-around',
  [
    { at: 0, emotion: 'CURIOUS', head: { yaw: -0.28, durationMs: 500 } },
    { at: 1000, head: { yaw: 0.28, durationMs: 600 } },
    { at: 2100, head: { yaw: 0, durationMs: 500 } },
  ],
  2900,
)
const STRETCH = timeline(
  'stretch',
  [
    { at: 0, emotion: 'RELAXED', hand: 'cheer', head: { pitch: -0.24, durationMs: 650 } },
    { at: 1100, head: { pitch: 0.16, durationMs: 600 } },
    { at: 1900, hand: 'none', head: { pitch: 0, durationMs: 500 } },
  ],
  2700,
)
const DOZE = timeline(
  'doze',
  [
    { at: 0, emotion: 'SLEEPY', eyes: { leftOpen: 0.5, rightOpen: 0.5 }, head: { pitch: 0.12, durationMs: 600 } },
    { at: 900, eyes: { leftOpen: 0.15, rightOpen: 0.15 }, effect: 'sleepy', head: { pitch: 0.22, durationMs: 600 } },
    { at: 2100, eyes: { leftOpen: 0, rightOpen: 0 } },
  ],
  3000,
)
const WAKE_UP = timeline(
  'wake-up',
  [
    { at: 0, emotion: 'SLEEPY', eyes: { leftOpen: 0.2, rightOpen: 0.2 }, head: { pitch: 0.15, durationMs: 400 } },
    { at: 700, emotion: 'SURPRISED', eyes: { leftOpen: 1, rightOpen: 1 }, head: { pitch: -0.15, durationMs: 300 } },
    { at: 1300, emotion: 'HAPPY', head: { pitch: 0, durationMs: 300 } },
  ],
  1900,
)
const GOODBYE = timeline(
  'goodbye',
  [
    { at: 0, emotion: 'HAPPY', hand: 'wave', head: { yaw: -0.15, durationMs: 350 } },
    { at: 700, head: { yaw: 0.15, durationMs: 350 } },
    { at: 1400, emotion: 'WINK', head: { yaw: 0, durationMs: 350 } },
  ],
  2100,
)

const HEAD_HELLO = timeline(
  'head-hello',
  [
    { at: 0, emotion: 'CURIOUS', head: { pitch: -0.08, durationMs: 250 } },
    { at: 400, emotion: 'WINK', head: { pitch: 0, durationMs: 250 } },
  ],
  1100,
)
const NOSE_BOOP = timeline(
  'nose-boop',
  [
    { at: 0, emotion: 'SURPRISED', mouth: { open: 0.35 } },
    { at: 350, emotion: 'MISCHIEVOUS', mouth: { open: 0 } },
  ],
  1100,
)
const TICKLED = timeline(
  'tickled',
  [
    { at: 0, emotion: 'LAUGHING', mouth: { open: 0.6 }, hand: 'cheer' },
    { at: 250, mouth: { open: 0.15 } },
    { at: 500, mouth: { open: 0.65 } },
    { at: 850, emotion: 'SPARKLING', mouth: { open: 0 } },
  ],
  1500,
)
const HEAD_CUDDLE = timeline(
  'head-cuddle',
  [
    { at: 0, emotion: 'RELAXED', eyes: { leftOpen: 0.7, rightOpen: 0.7 } },
    { at: 450, emotion: 'LOVE', eyes: { leftOpen: 1, rightOpen: 1 }, effect: 'heart' },
    { at: 1300, effect: null },
  ],
  1800,
)
const LOOK_TOUCH_LEFT = timeline(
  'look-touch-left',
  [
    { at: 0, emotion: 'FOCUSED', head: { yaw: -0.24, pitch: -0.05, durationMs: 350 } },
    { at: 500, emotion: 'CURIOUS' },
    { at: 900, head: { yaw: 0, pitch: 0, durationMs: 350 } },
  ],
  1500,
)
const LOOK_TOUCH_RIGHT = timeline(
  'look-touch-right',
  [
    { at: 0, emotion: 'FOCUSED', head: { yaw: 0.24, pitch: -0.05, durationMs: 350 } },
    { at: 500, emotion: 'CURIOUS' },
    { at: 900, head: { yaw: 0, pitch: 0, durationMs: 350 } },
  ],
  1500,
)
const HAPPY_SPARKLE = timeline(
  'happy-sparkle',
  [
    { at: 0, emotion: 'STARSTRUCK', hand: 'cheer' },
    { at: 450, emotion: 'SPARKLING', mouth: { open: 0.3 } },
    { at: 900, mouth: { open: 0 } },
  ],
  1500,
)
const BASHFUL = timeline(
  'bashful',
  [
    { at: 0, emotion: 'SHY', eyes: { leftOpen: 0.75, rightOpen: 0.75 } },
    { at: 500, emotion: 'LOVE', eyes: { leftOpen: 1, rightOpen: 1 } },
  ],
  1600,
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
  surprised: SURPRISED,
  curious: CURIOUS,
  shy: SHY,
  laugh: LAUGH,
  wink: WINK,
  love: LOVE,
  proud: PROUD,
  worried: WORRIED,
  apologize: APOLOGIZE,
  relieved: RELIEVED,
  listening: LISTENING,
  'look-around': LOOK_AROUND,
  stretch: STRETCH,
  doze: DOZE,
  'wake-up': WAKE_UP,
  goodbye: GOODBYE,
  'head-hello': HEAD_HELLO,
  'nose-boop': NOSE_BOOP,
  tickled: TICKLED,
  'head-cuddle': HEAD_CUDDLE,
  'look-touch-left': LOOK_TOUCH_LEFT,
  'look-touch-right': LOOK_TOUCH_RIGHT,
  'happy-sparkle': HAPPY_SPARKLE,
  bashful: BASHFUL,
})

export function reactionTimeline(name: ReactionName): ReactionTimeline {
  return REACTION_CATALOG[name]
}
