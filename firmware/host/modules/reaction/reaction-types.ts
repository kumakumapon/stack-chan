/**
 * A reaction is a short, named performance of one feeling: a few hundred
 * milliseconds to a few seconds of face, hands, head and effect changing on a
 * timeline, then restoring. These types are plain data on purpose, so the same
 * definitions drive the device and the WASM simulator, and so a MOD, an agent
 * tool or a PC client can only ever ask for a reaction by name — never hand the
 * robot raw servo angles.
 */

export const REACTION_NAMES = [
  'yes',
  'no',
  'greeting',
  'thinking',
  'delighted',
  'sleepy-yawn',
  'success',
  'failure',
] as const

export type ReactionName = (typeof REACTION_NAMES)[number]

export function isReactionName(value: unknown): value is ReactionName {
  return typeof value === 'string' && (REACTION_NAMES as readonly string[]).includes(value)
}

/** Head target in radians, absolute (not relative to the current pose). */
export type HeadTarget = {
  yaw?: number
  pitch?: number
  /** How long the move should take. Clamped to the limits in reaction-limits. */
  durationMs?: number
}

/**
 * One keyframe. `at` is milliseconds from the reaction's start. Every field is
 * optional: a frame changes only what it names, so a frame that sets a hand
 * leaves the emotion alone.
 */
export type ReactionFrame = {
  at: number
  /** An EmotionName such as 'HAPPY'. The stage resolves it; an unknown name is ignored and traced. */
  emotion?: string
  eyes?: { leftOpen?: number; rightOpen?: number }
  mouth?: { open?: number }
  head?: HeadTarget
  /** A HandAnimationName such as 'wave' or 'none'. The stage validates it. */
  hand?: string
  /** An EmoticonKey such as 'heart'; null removes the current effect. */
  effect?: string | null
  light?: { r: number; g: number; b: number; durationMs?: number }
}

export type ReactionTimeline = {
  name: ReactionName
  frames: readonly ReactionFrame[]
  /** Total length. The player restores at this time unless `restore` is false. */
  durationMs: number
  restore?: boolean
}

export type ReactionOptions = {
  /** 0..1, scales head amplitude. Default 1. */
  intensity?: number
  /** Return face, hands, effect and head to the pre-reaction state at the end. Default true. */
  restore?: boolean
}

export type ReactionPlayResult = { ok: true } | { ok: false; error: string }

export type ReactionEndReason = 'completed' | 'cancelled' | 'interrupted' | 'error'

export type ReactionStatus = {
  active: ReactionName | null
  startedAt: number | null
}

/** What the stage looked like before a reaction, so it can be put back. */
export type StageSnapshot = {
  emotion: string
  hand: string
  effect: string | null
  head: { yaw: number; pitch: number }
}

/**
 * Everything a reaction can touch, as the player sees it. The app builds one
 * over the runtime context; tests build one over plain records. Head moves are
 * callback-based rather than Promise-based so the player's Timer-driven
 * scheduling never has to await inside a timer callback.
 */
export type ReactionStage = {
  now(): number
  snapshot(): StageSnapshot
  setEmotion(name: string): boolean
  setEyeOpen(left: number, right: number): void
  setMouthOpen(value: number): void
  setHand(name: string): boolean
  setEffect(key: string | null): void
  setHead(target: { yaw: number; pitch: number }, durationMs: number, done: (ok: boolean) => void): void
  /** Releases servo torque once the head is back where it started. */
  releaseHead(): void
  lightOn(r: number, g: number, b: number, durationMs?: number): void
  /**
   * True while speech or singing is playing. The player then leaves the mouth
   * alone, because lip sync already owns it and a reaction closing the mouth
   * mid-word would look like a glitch.
   */
  isAudioActive(): boolean
}
