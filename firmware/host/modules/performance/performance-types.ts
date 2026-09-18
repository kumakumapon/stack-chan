/**
 * A performance is minutes-scale choreography: speech, song, reactions, named
 * head motions, hands, effects and light on one timeline. Where a reaction
 * expresses a feeling, a performance stages a routine.
 *
 * Cue times are absolute — milliseconds from the performance's start — never
 * delays from the previous cue. The servo driver sends a fixed goal time
 * regardless of the duration asked for, so the only clock that can keep a
 * dance on the beat is one the player owns. Jitter in one cue must not push
 * every later cue along with it.
 */

import type { ReactionName } from 'reaction-types'

export const MOTION_NAMES = [
  'nod',
  'shake',
  'sway-left',
  'sway-right',
  'bounce',
  'look-up',
  'look-down',
  'head-left',
  'head-right',
  'center',
] as const

export type MotionName = (typeof MOTION_NAMES)[number]

export function isMotionName(value: unknown): value is MotionName {
  return typeof value === 'string' && (MOTION_NAMES as readonly string[]).includes(value)
}

/** One servo target within a named motion. `at` is relative to the motion's own start. */
export type MotionStep = {
  at: number
  yaw: number
  pitch: number
  durationMs: number
}

export type MotionDefinition = {
  name: MotionName
  steps: readonly MotionStep[]
  durationMs: number
}

export type PerformanceCue = {
  /** Milliseconds from the performance's start. */
  at: number
  reaction?: ReactionName
  motion?: MotionName
  head?: { yaw?: number; pitch?: number; durationMs?: number }
  /** Spoken with the active TTS. Cannot be stopped once started: see the player's cancel notes. */
  speech?: { text: string; volume?: number }
  /** stackchan-voice koe notation, sung with the active TTS when it supports singing. */
  song?: { koe: string; volume?: number }
  emotion?: string
  hand?: string
  effect?: string | null
  light?: { r: number; g: number; b: number; durationMs?: number }
}

export const PERFORMANCE_NAMES = ['greeting', 'happy-dance', 'cheer', 'sing-twinkle'] as const

export type PerformanceName = (typeof PERFORMANCE_NAMES)[number]

export function isPerformanceName(value: unknown): value is PerformanceName {
  return typeof value === 'string' && (PERFORMANCE_NAMES as readonly string[]).includes(value)
}

export type PerformanceTimeline = {
  name: PerformanceName
  cues: readonly PerformanceCue[]
  durationMs: number
  restore?: boolean
}

export type PerformanceOptions = {
  intensity?: number
  restore?: boolean
}

export type PerformancePlayResult = { ok: true } | { ok: false; error: string }

export type PerformanceEndReason = 'completed' | 'cancelled' | 'interrupted' | 'error'

export type PerformanceStatus = {
  active: PerformanceName | null
  startedAt: number | null
  /** Index of the next cue to fire, or the cue count once all have fired. */
  nextCue: number
}

export const PERFORMANCE_LIMITS = Object.freeze({
  maxCues: 256,
  maxDurationMs: 180000,
  /** Cues that move the head closer together than this would pile servo targets on top of each other. */
  minHeadCueSpacingMs: 150,
  /** A stalled clock this far behind fires the overdue cues rather than skipping them. Beyond it, they are dropped. */
  maxCatchUpMs: 1000,
})
