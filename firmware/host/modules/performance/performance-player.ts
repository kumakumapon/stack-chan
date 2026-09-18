/**
 * Plays a performance: speech, song, reactions, named motions, face, hands,
 * effects and light on one absolute-time clock. Every cue fires at its own
 * `at`, so a servo move or a TTS hand-off that runs long shifts nothing after
 * it. Reactions inside a performance run on the reaction player over the same
 * stage; motions expand into their servo steps at schedule time.
 *
 * Cancel stops the clock, cancels the running reaction and restores the
 * stage. Speech or song already handed to the TTS finishes on its own: the
 * audio capability has no stop, and this module does not pretend otherwise.
 */

import {
  type MotionDefinition,
  type MotionName,
  PERFORMANCE_LIMITS,
  type PerformanceCue,
  type PerformanceEndReason,
  type PerformanceName,
  type PerformanceOptions,
  type PerformancePlayResult,
  type PerformanceStatus,
  type PerformanceTimeline,
} from 'performance-types'
import { clampHead } from 'reaction-limits'
import { defaultTrace, ReactionPlayer, restoreStage } from 'reaction-player'
import type { ReactionName, ReactionStage, ReactionTimeline, StageSnapshot } from 'reaction-types'
import { TimelineClock } from 'timeline-clock'

export type PerformanceStage = ReactionStage & {
  /** Hands text to the TTS. `done(false)` when it was refused (busy, no TTS). */
  say(text: string, volume: number | undefined, done: (ok: boolean) => void): void
  sing(koe: string, volume: number | undefined, done: (ok: boolean) => void): void
}

export type PerformanceLookups = {
  reactions: (name: ReactionName) => ReactionTimeline | undefined
  motions: (name: MotionName) => MotionDefinition | undefined
}

export type PerformancePlayerOptions = PerformanceLookups & {
  stage: PerformanceStage
  onEnd?: (name: PerformanceName, reason: PerformanceEndReason) => void
  trace?: (message: string) => void
  maxCatchUpMs?: number
}

type Entry =
  | { at: number; kind: 'cue'; cue: PerformanceCue }
  | { at: number; kind: 'step'; yaw: number; pitch: number; durationMs: number }

function movesHead(cue: PerformanceCue): boolean {
  return cue.motion !== undefined || cue.head !== undefined
}

/** Structural checks shared by the player and by catalog tests. */
export function validatePerformance(timeline: PerformanceTimeline, lookups: PerformanceLookups): string | undefined {
  const { cues, durationMs } = timeline
  if (cues.length === 0) return 'performance has no cues'
  if (cues.length > PERFORMANCE_LIMITS.maxCues) return `performance exceeds ${PERFORMANCE_LIMITS.maxCues} cues`
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'performance duration must be positive'
  if (durationMs > PERFORMANCE_LIMITS.maxDurationMs) return `performance exceeds ${PERFORMANCE_LIMITS.maxDurationMs} ms`
  let previousAt = -1
  let headBusyUntil = -Infinity
  for (const [index, cue] of cues.entries()) {
    if (!Number.isFinite(cue.at) || cue.at < 0) return `cue ${index} has an invalid time`
    if (cue.at < previousAt) return `cue ${index} is out of order`
    if (cue.at > durationMs) return `cue ${index} starts after the performance ends`
    previousAt = cue.at
    if (cue.reaction !== undefined && lookups.reactions(cue.reaction) === undefined) {
      return `cue ${index} names unknown reaction ${cue.reaction}`
    }
    if (cue.motion !== undefined && lookups.motions(cue.motion) === undefined) {
      return `cue ${index} names unknown motion ${cue.motion}`
    }
    if (movesHead(cue)) {
      if (cue.at < headBusyUntil) {
        return `cue ${index} moves the head before the previous motion finishes (${headBusyUntil} ms)`
      }
      const motionLength = cue.motion !== undefined ? (lookups.motions(cue.motion)?.durationMs ?? 0) : 0
      headBusyUntil = cue.at + Math.max(motionLength, PERFORMANCE_LIMITS.minHeadCueSpacingMs)
    }
  }
  return undefined
}

export class PerformancePlayer {
  readonly #stage: PerformanceStage
  readonly #lookups: PerformanceLookups
  readonly #reactions: ReactionPlayer
  readonly #clock: TimelineClock
  readonly #onEnd: PerformancePlayerOptions['onEnd']
  readonly #trace: (message: string) => void

  #active: PerformanceTimeline | undefined
  #entries: readonly Entry[] = []
  #intensity = 1
  #restore = true
  #baseline: StageSnapshot | undefined
  #headTouched = false
  #firedCues = 0

  constructor(options: PerformancePlayerOptions) {
    this.#stage = options.stage
    this.#lookups = { reactions: options.reactions, motions: options.motions }
    this.#onEnd = options.onEnd
    this.#trace = options.trace ?? defaultTrace
    this.#reactions = new ReactionPlayer({
      stage: options.stage,
      trace: this.#trace,
      maxCatchUpMs: options.maxCatchUpMs,
    })
    this.#clock = new TimelineClock({
      now: () => this.#stage.now(),
      maxCatchUpMs: options.maxCatchUpMs ?? PERFORMANCE_LIMITS.maxCatchUpMs,
    })
  }

  status(): PerformanceStatus {
    return {
      active: this.#active?.name ?? null,
      startedAt: this.#active ? this.#clock.startedAt : null,
      nextCue: this.#active ? this.#firedCues : 0,
    }
  }

  play(timeline: PerformanceTimeline, options: PerformanceOptions = {}): PerformancePlayResult {
    const problem = validatePerformance(timeline, this.#lookups)
    if (problem !== undefined) return { ok: false, error: problem }

    if (this.#active !== undefined) this.#end('interrupted', true)
    if (this.#baseline === undefined) {
      try {
        this.#baseline = this.#stage.snapshot()
      } catch (error) {
        return { ok: false, error: `stage snapshot failed: ${String(error)}` }
      }
    }
    this.#active = timeline
    this.#intensity = Math.min(1, Math.max(0, options.intensity ?? 1))
    this.#restore = options.restore ?? timeline.restore ?? true
    this.#entries = this.#expand(timeline)
    this.#firedCues = 0
    this.#clock.start(this.#entries, timeline.durationMs, {
      fire: (index) => this.#fire(this.#entries[index]),
      skip: (index, lateMs) => {
        const entry = this.#entries[index]
        if (entry.kind === 'cue') this.#firedCues += 1
        this.#trace(`[performance] ${timeline.name} ${entry.kind} at ${entry.at} skipped, ${lateMs} ms late\n`)
      },
      done: () => this.#end('completed'),
    })
    return { ok: true }
  }

  cancel(): boolean {
    if (this.#active === undefined) return false
    this.#end('cancelled')
    return true
  }

  /** Flattens cues plus the servo steps of every motion cue into one sorted list. */
  #expand(timeline: PerformanceTimeline): Entry[] {
    const entries: Entry[] = []
    for (const cue of timeline.cues) {
      entries.push({ at: cue.at, kind: 'cue', cue })
      const motion = cue.motion !== undefined ? this.#lookups.motions(cue.motion) : undefined
      if (motion === undefined) continue
      for (const step of motion.steps) {
        const head = clampHead({ yaw: step.yaw, pitch: step.pitch, durationMs: step.durationMs }, this.#intensity)
        entries.push({
          at: cue.at + step.at,
          kind: 'step',
          yaw: head.yaw ?? 0,
          pitch: head.pitch ?? 0,
          durationMs: head.durationMs,
        })
      }
    }
    // Stable by construction order, so a cue always fires before the steps it spawned at the same time.
    return entries.sort((a, b) => a.at - b.at)
  }

  #fire(entry: Entry): void {
    try {
      if (entry.kind === 'step') {
        this.#moveHead(entry.yaw, entry.pitch, entry.durationMs)
        return
      }
      this.#firedCues += 1
      this.#applyCue(entry.cue)
    } catch (error) {
      this.#trace(`[performance] cue failed: ${String(error)}\n`)
      this.#end('error')
    }
  }

  #applyCue(cue: PerformanceCue): void {
    const stage = this.#stage
    const name = this.#active?.name ?? 'performance'
    if (cue.emotion !== undefined && !stage.setEmotion(cue.emotion)) {
      this.#trace(`[performance] unknown emotion ${cue.emotion}\n`)
    }
    if (cue.hand !== undefined && !stage.setHand(cue.hand)) this.#trace(`[performance] unknown hand ${cue.hand}\n`)
    if (cue.effect !== undefined) stage.setEffect(cue.effect)
    if (cue.light !== undefined) stage.lightOn(cue.light.r, cue.light.g, cue.light.b, cue.light.durationMs)
    if (cue.speech !== undefined) {
      stage.say(cue.speech.text, cue.speech.volume, (ok) => {
        if (!ok) this.#trace(`[performance] ${name}: speech refused\n`)
      })
    }
    if (cue.song !== undefined) {
      stage.sing(cue.song.koe, cue.song.volume, (ok) => {
        if (!ok) this.#trace(`[performance] ${name}: song refused\n`)
      })
    }
    if (cue.head !== undefined) {
      const base = this.#baseline?.head ?? { yaw: 0, pitch: 0 }
      const head = clampHead(cue.head, this.#intensity)
      this.#moveHead(head.yaw ?? base.yaw, head.pitch ?? base.pitch, head.durationMs)
    }
    if (cue.reaction !== undefined) {
      const timeline = this.#lookups.reactions(cue.reaction)
      if (timeline === undefined) {
        this.#trace(`[performance] unknown reaction ${cue.reaction}\n`)
        return
      }
      const result = this.#reactions.play(timeline, { intensity: this.#intensity })
      if ('error' in result) this.#trace(`[performance] reaction ${cue.reaction} refused: ${result.error}\n`)
      else this.#headTouched = this.#headTouched || timeline.frames.some((frame) => frame.head !== undefined)
    }
  }

  #moveHead(yaw: number, pitch: number, durationMs: number): void {
    this.#headTouched = true
    this.#stage.setHead({ yaw, pitch }, durationMs, (ok) => {
      if (!ok) this.#trace('[performance] head move failed\n')
    })
  }

  /** See ReactionPlayer#end: `chained` keeps the baseline for the performance taking over. */
  #end(reason: PerformanceEndReason, chained = false): void {
    const active = this.#active
    if (active === undefined) return
    this.#clock.stop()
    this.#active = undefined
    // A reaction still running belongs to this performance; its own restore runs first.
    this.#reactions.cancel()
    const baseline = this.#baseline
    if (this.#restore && baseline !== undefined) {
      restoreStage(this.#stage, baseline, { head: !chained && this.#headTouched }, this.#trace)
    } else if (!chained && this.#headTouched) {
      try {
        this.#stage.releaseHead()
      } catch (error) {
        this.#trace(`[performance] release failed: ${String(error)}\n`)
      }
    }
    if (!chained) {
      this.#baseline = undefined
      this.#headTouched = false
    }
    this.#onEnd?.(active.name, reason)
  }
}
