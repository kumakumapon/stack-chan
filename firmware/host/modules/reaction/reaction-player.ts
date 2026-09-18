/**
 * Plays one reaction timeline against a ReactionStage, then puts the stage
 * back. Frames land on an absolute-time clock, so a slow head move never
 * shifts the later face frames. Everything is callback-driven: a Timer
 * callback in this module never awaits.
 */

import { clampFrame, REACTION_LIMITS, validateTimeline } from 'reaction-limits'
import type {
  ReactionEndReason,
  ReactionFrame,
  ReactionName,
  ReactionOptions,
  ReactionPlayResult,
  ReactionStage,
  ReactionStatus,
  ReactionTimeline,
  StageSnapshot,
} from 'reaction-types'
import { TimelineClock } from 'timeline-clock'

export type ReactionPlayerOptions = {
  stage: ReactionStage
  /** Called once per reaction when it ends, whatever the reason. */
  onEnd?: (name: ReactionName, reason: ReactionEndReason) => void
  /** Diagnostics sink. Defaults to Moddable's global trace when present. */
  trace?: (message: string) => void
  maxCatchUpMs?: number
}

export function defaultTrace(message: string): void {
  const sink = (globalThis as { trace?: (message: string) => void }).trace
  sink?.(message)
}

/**
 * Puts face, hands and effect back to `baseline`, and the head too when
 * `head` is set: torque is released only once the head move reports done.
 * Shared by the reaction and performance players so both restore the same way.
 */
export function restoreStage(
  stage: ReactionStage,
  baseline: StageSnapshot,
  options: { head: boolean },
  trace: (message: string) => void,
): void {
  const safely = (action: () => void) => {
    try {
      action()
    } catch (error) {
      trace(`[reaction] restore failed: ${String(error)}\n`)
    }
  }
  safely(() => {
    stage.setEmotion(baseline.emotion)
    stage.setEyeOpen(1, 1)
    if (!stage.isAudioActive()) stage.setMouthOpen(0)
    stage.setHand(baseline.hand)
    stage.setEffect(baseline.effect)
  })
  if (!options.head) return
  safely(() =>
    stage.setHead(baseline.head, REACTION_LIMITS.defaultHeadDurationMs, () => safely(() => stage.releaseHead())),
  )
}

export class ReactionPlayer {
  readonly #stage: ReactionStage
  readonly #clock: TimelineClock
  readonly #onEnd: ReactionPlayerOptions['onEnd']
  readonly #trace: (message: string) => void

  #active: ReactionTimeline | undefined
  #frames: readonly ReactionFrame[] = []
  #restore = true
  /**
   * The stage before the first reaction of a chain. A reaction that interrupts
   * another restores to this, not to the interrupted reaction's half-way look.
   */
  #baseline: StageSnapshot | undefined
  #headTouched = false
  #eyes = { left: 1, right: 1 }

  constructor(options: ReactionPlayerOptions) {
    this.#stage = options.stage
    this.#onEnd = options.onEnd
    this.#trace = options.trace ?? defaultTrace
    this.#clock = new TimelineClock({ now: () => this.#stage.now(), maxCatchUpMs: options.maxCatchUpMs })
  }

  status(): ReactionStatus {
    return { active: this.#active?.name ?? null, startedAt: this.#active ? this.#clock.startedAt : null }
  }

  play(timeline: ReactionTimeline, options: ReactionOptions = {}): ReactionPlayResult {
    const problem = validateTimeline(timeline)
    if (problem !== undefined) return { ok: false, error: problem }
    const intensity = Math.min(1, Math.max(0, options.intensity ?? 1))

    if (this.#active !== undefined) this.#end('interrupted', true)
    if (this.#baseline === undefined) {
      try {
        this.#baseline = this.#stage.snapshot()
      } catch (error) {
        return { ok: false, error: `stage snapshot failed: ${String(error)}` }
      }
    }
    this.#active = timeline
    this.#restore = options.restore ?? timeline.restore ?? true
    this.#frames = timeline.frames.map((frame) => clampFrame(frame, intensity))
    this.#clock.start(this.#frames, timeline.durationMs, {
      fire: (index) => this.#apply(this.#frames[index]),
      skip: (index, lateMs) => this.#trace(`[reaction] ${timeline.name} frame ${index} skipped, ${lateMs} ms late\n`),
      done: () => this.#end('completed'),
    })
    return { ok: true }
  }

  cancel(): boolean {
    if (this.#active === undefined) return false
    this.#end('cancelled')
    return true
  }

  #apply(frame: ReactionFrame): void {
    const stage = this.#stage
    try {
      if (frame.emotion !== undefined && !stage.setEmotion(frame.emotion)) {
        this.#trace(`[reaction] unknown emotion ${frame.emotion}\n`)
      }
      if (frame.eyes !== undefined) {
        this.#eyes = { left: frame.eyes.leftOpen ?? this.#eyes.left, right: frame.eyes.rightOpen ?? this.#eyes.right }
        stage.setEyeOpen(this.#eyes.left, this.#eyes.right)
      }
      if (frame.mouth?.open !== undefined && !stage.isAudioActive()) stage.setMouthOpen(frame.mouth.open)
      if (frame.hand !== undefined && !stage.setHand(frame.hand)) this.#trace(`[reaction] unknown hand ${frame.hand}\n`)
      if (frame.effect !== undefined) stage.setEffect(frame.effect)
      if (frame.light !== undefined) stage.lightOn(frame.light.r, frame.light.g, frame.light.b, frame.light.durationMs)
      if (frame.head !== undefined) {
        const base = this.#baseline?.head ?? { yaw: 0, pitch: 0 }
        this.#headTouched = true
        stage.setHead(
          { yaw: frame.head.yaw ?? base.yaw, pitch: frame.head.pitch ?? base.pitch },
          frame.head.durationMs ?? REACTION_LIMITS.defaultHeadDurationMs,
          (ok) => {
            if (!ok) this.#trace('[reaction] head move failed\n')
          },
        )
      }
    } catch (error) {
      this.#trace(`[reaction] frame failed: ${String(error)}\n`)
      this.#end('error')
    }
  }

  /**
   * Stops the clock and, unless the reaction opted out, restores the stage.
   * `chained` means another reaction takes over right away: face and hands
   * are reset so the newcomer starts clean, but the head is left for it and
   * the baseline is kept for the final restore.
   */
  #end(reason: ReactionEndReason, chained = false): void {
    const active = this.#active
    if (active === undefined) return
    this.#clock.stop()
    this.#active = undefined
    const baseline = this.#baseline
    if (this.#restore && baseline !== undefined) {
      this.#restoreStage(baseline, chained)
    } else if (!chained && this.#headTouched) {
      this.#safely(() => this.#stage.releaseHead())
    }
    if (!chained) {
      this.#baseline = undefined
      this.#headTouched = false
    }
    this.#onEnd?.(active.name, reason)
  }

  #restoreStage(baseline: StageSnapshot, chained: boolean): void {
    restoreStage(this.#stage, baseline, { head: !chained && this.#headTouched }, this.#trace)
    if (!chained) this.#eyes = { left: 1, right: 1 }
  }

  #safely(action: () => void): void {
    try {
      action()
    } catch (error) {
      this.#trace(`[reaction] restore failed: ${String(error)}\n`)
    }
  }
}
