/**
 * Named performances, spelled out as data. Cue times are absolute
 * milliseconds from the performance's start (never a delay from the
 * previous cue), matching the contract in performance-types. This file is
 * the one place that turns a performance name into a cue list; the player
 * owns the clock that keeps it on the beat.
 */

import type { PerformanceCue, PerformanceName, PerformanceTimeline } from 'performance-types'

function timeline(name: PerformanceName, cues: readonly PerformanceCue[], durationMs: number): PerformanceTimeline {
  const sorted = [...cues].sort((a, b) => a.at - b.at)
  for (const cue of sorted) Object.freeze(cue)
  return Object.freeze({ name, cues: Object.freeze(sorted), durationMs })
}

const HAPPY_DANCE_BEAT_MS = 650
const HAPPY_DANCE_MOTIONS = ['sway-left', 'sway-right', 'bounce'] as const
const HAPPY_DANCE_BEAT_COUNT = 15
const HAPPY_DANCE_FIRST_BEAT_MS = 300

function buildHappyDanceMotionCues(): PerformanceCue[] {
  const cues: PerformanceCue[] = []
  for (let index = 0; index < HAPPY_DANCE_BEAT_COUNT; index++) {
    cues.push({
      at: HAPPY_DANCE_FIRST_BEAT_MS + index * HAPPY_DANCE_BEAT_MS,
      motion: HAPPY_DANCE_MOTIONS[index % HAPPY_DANCE_MOTIONS.length],
    })
  }
  return cues
}

const HAPPY_DANCE_LAST_MOTION_AT = HAPPY_DANCE_FIRST_BEAT_MS + (HAPPY_DANCE_BEAT_COUNT - 1) * HAPPY_DANCE_BEAT_MS
const HAPPY_DANCE_CENTER_AT = HAPPY_DANCE_LAST_MOTION_AT + HAPPY_DANCE_BEAT_MS

const TWINKLE_KOE = '#C4,400ki#C4,400ra#G4,400ki#G4,400ra#A4,400hi#A4,400ka#G4,800ru'

const SING_TWINKLE_SWAY_BEAT_MS = 1200
const SING_TWINKLE_SWAY_COUNT = 13
const SING_TWINKLE_FIRST_SWAY_MS = 500
const SING_TWINKLE_SWAYS = ['sway-left', 'sway-right'] as const

function buildSingTwinkleSwayCues(): PerformanceCue[] {
  const cues: PerformanceCue[] = []
  for (let index = 0; index < SING_TWINKLE_SWAY_COUNT; index++) {
    cues.push({
      at: SING_TWINKLE_FIRST_SWAY_MS + index * SING_TWINKLE_SWAY_BEAT_MS,
      motion: SING_TWINKLE_SWAYS[index % SING_TWINKLE_SWAYS.length],
    })
  }
  return cues
}

const SING_TWINKLE_LAST_SWAY_AT = SING_TWINKLE_FIRST_SWAY_MS + (SING_TWINKLE_SWAY_COUNT - 1) * SING_TWINKLE_SWAY_BEAT_MS
const SING_TWINKLE_CENTER_AT = SING_TWINKLE_LAST_SWAY_AT + 1600

export const PERFORMANCE_CATALOG: Readonly<Record<PerformanceName, PerformanceTimeline>> = Object.freeze({
  greeting: timeline(
    'greeting',
    [
      { at: 0, reaction: 'greeting' },
      { at: 1600, speech: { text: 'こんにちは！' } },
      { at: 2600, motion: 'nod' },
      { at: 4200, hand: 'wave' },
      { at: 5200, motion: 'center', hand: 'none' },
    ],
    6000,
  ),
  'happy-dance': timeline(
    'happy-dance',
    [
      { at: 0, emotion: 'HAPPY', hand: 'cheer', effect: 'heart', light: { r: 255, g: 120, b: 180, durationMs: 500 } },
      ...buildHappyDanceMotionCues(),
      { at: 4000, light: { r: 120, g: 200, b: 255, durationMs: 500 } },
      { at: 8000, light: { r: 255, g: 220, b: 90, durationMs: 500 } },
      { at: HAPPY_DANCE_CENTER_AT, motion: 'center', hand: 'none', effect: null },
    ],
    12000,
  ),
  cheer: timeline(
    'cheer',
    [
      { at: 0, speech: { text: 'がんばれー！' }, hand: 'cheer' },
      { at: 600, motion: 'bounce' },
      { at: 1300, motion: 'bounce' },
      { at: 2000, motion: 'bounce' },
      { at: 2700, motion: 'bounce' },
      { at: 3400, motion: 'bounce' },
      { at: 4100, motion: 'bounce' },
      { at: 4800, motion: 'bounce' },
      { at: 6800, reaction: 'delighted' },
    ],
    8000,
  ),
  'sing-twinkle': timeline(
    'sing-twinkle',
    [
      { at: 0, emotion: 'HAPPY', song: { koe: TWINKLE_KOE } },
      ...buildSingTwinkleSwayCues(),
      { at: SING_TWINKLE_CENTER_AT, motion: 'center' },
      { at: 18000, effect: 'heart' },
    ],
    20000,
  ),
  'morning-stretch': timeline(
    'morning-stretch',
    [
      { at: 0, reaction: 'wake-up' },
      { at: 2200, emotion: 'RELAXED', hand: 'cheer', motion: 'stretch' },
      { at: 5100, reaction: 'delighted' },
      { at: 6300, motion: 'center', hand: 'none', effect: null },
    ],
    6800,
  ),
  'curiosity-tour': timeline(
    'curiosity-tour',
    [
      { at: 0, reaction: 'curious' },
      { at: 2300, motion: 'peek-left', emotion: 'CURIOUS' },
      { at: 3800, motion: 'peek-right' },
      { at: 5300, reaction: 'surprised' },
      { at: 7000, reaction: 'yes' },
      { at: 8100, motion: 'center', hand: 'none' },
    ],
    8700,
  ),
  celebrate: timeline(
    'celebrate',
    [
      { at: 0, reaction: 'success' },
      { at: 1100, emotion: 'EXCITED', hand: 'cheer', motion: 'bounce', effect: 'heart' },
      { at: 1800, motion: 'sway-left' },
      { at: 2500, motion: 'sway-right' },
      { at: 3200, reaction: 'laugh' },
      { at: 4900, reaction: 'proud' },
      { at: 6800, motion: 'center', hand: 'none', effect: null },
    ],
    7400,
  ),
  'shy-hello': timeline(
    'shy-hello',
    [
      { at: 0, reaction: 'shy' },
      { at: 2200, emotion: 'SHY', hand: 'wave', motion: 'peek-right' },
      { at: 3700, reaction: 'wink' },
      { at: 5200, motion: 'bow', hand: 'none', effect: null },
    ],
    7000,
  ),
  'thinking-hard': timeline(
    'thinking-hard',
    [
      { at: 0, reaction: 'thinking' },
      { at: 2100, emotion: 'DOUBTFUL', hand: 'thinking', motion: 'scan' },
      { at: 5100, reaction: 'worried' },
      { at: 7400, reaction: 'surprised' },
      { at: 9100, reaction: 'proud' },
      { at: 11000, motion: 'center', hand: 'none', effect: null },
    ],
    11600,
  ),
  'sleepy-bedtime': timeline(
    'sleepy-bedtime',
    [
      { at: 0, reaction: 'sleepy-yawn' },
      { at: 2800, reaction: 'stretch' },
      { at: 5800, reaction: 'doze' },
      { at: 9100, emotion: 'RELAXED', motion: 'center', hand: 'none', effect: null },
    ],
    10000,
  ),
  'thank-you': timeline(
    'thank-you',
    [
      { at: 0, reaction: 'love' },
      { at: 2100, emotion: 'HAPPY', motion: 'bow', hand: 'none' },
      { at: 3800, reaction: 'wink' },
      { at: 5300, motion: 'center', effect: null },
    ],
    5900,
  ),
  goodbye: timeline(
    'goodbye',
    [
      { at: 0, reaction: 'goodbye' },
      { at: 2400, emotion: 'HAPPY', motion: 'bow', hand: 'none' },
      { at: 4100, reaction: 'love' },
      { at: 6200, motion: 'center', hand: 'none', effect: null },
    ],
    6900,
  ),
})

export function performanceTimeline(name: PerformanceName): PerformanceTimeline {
  return PERFORMANCE_CATALOG[name]
}
