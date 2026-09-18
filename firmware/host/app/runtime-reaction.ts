/**
 * Wires the reaction and performance capabilities (issues #35/#36) onto the
 * app runtime context. This builds one `PerformanceStage` over a small,
 * structural slice of the other runtime capabilities and plays it through a
 * `ReactionPlayer` (for `reaction.play`) and a `PerformancePlayer` (for
 * `performance.play`).
 *
 * The dependency type here is deliberately its own small structural shape,
 * not the real `capabilities.ts` types: this file is exercised directly by
 * `node --test` (see runtime-reaction.test.ts), and under the Node test
 * project the bare `capabilities` specifier resolves to a fake that does not
 * carry `ReactionCapability`/`PerformanceCapability`, while a *relative*
 * import of the real `host/app/capabilities.ts` would drag in `hands`
 * (Piu-backed, not resolvable or runtime-loadable under Node). The object
 * this module returns is structurally identical to the real
 * `ReactionCapability`/`PerformanceCapability`, so `runtime-context.ts` can
 * hand it out through the real types without this file ever importing them.
 *
 * For the same reason, anything that fundamentally needs Piu — validating a
 * hand-animation name against the real catalog in 'hands', and creating a
 * `UIEffect` (an `Emoticon`) — is taken as an injected dependency instead of
 * a static import. `isHandAnimationName` has a safe default (a local copy of
 * the same name list 'hands' and reaction-catalog.test.ts both already
 * duplicate); `createEffect` has no safe default and must be supplied by the
 * caller.
 */

import { emotionFromName, toEmotionName } from 'face-state'
import { motionDefinition } from 'motion-catalog'
import { performanceTimeline } from 'performance-catalog'
import { PerformancePlayer, type PerformanceStage } from 'performance-player'
import {
  isMotionName,
  isPerformanceName,
  PERFORMANCE_NAMES,
  type PerformanceName,
  type PerformanceOptions,
  type PerformancePlayResult,
  type PerformanceStatus,
} from 'performance-types'
import { reactionTimeline } from 'reaction-catalog'
import { defaultTrace, ReactionPlayer } from 'reaction-player'
import {
  isReactionName,
  REACTION_NAMES,
  type ReactionName,
  type ReactionOptions,
  type ReactionPlayResult,
  type ReactionStatus,
} from 'reaction-types'
import Time from 'time'

type Vector3ish = { x: number; y: number; z: number }
type Rotationish = { y: number; p: number; r: number }
type Poseish = { position: Vector3ish; rotation: Rotationish }

export type ReactionRuntimeFaceDeps = {
  setEmotion(emotion: number): void
  setEyeOpen(key: 'left' | 'right', value: number): void
  setMouthOpen(value: number): void
}

export type ReactionRuntimeUIDeps = {
  setHandAnimation(name: string): void
  addEffect(effect: unknown, key?: string): void
  removeEffect(effect: unknown): void
}

export type ReactionRuntimeMotionDeps = {
  readonly pose: { body: Poseish }
  setPose(pose: Poseish, time?: number): Promise<void>
  setTorque(torque: boolean): Promise<void>
}

export type ReactionRuntimeAudioResult = { success: boolean }

export type ReactionRuntimeAudioDeps = {
  say(text: string, volume?: number): Promise<ReactionRuntimeAudioResult>
  sing(koe: string, volume?: number): Promise<ReactionRuntimeAudioResult>
  /** True while speech or singing is playing. Mirrors `StackchanRuntimeAudio#isActive`. */
  readonly isActive: boolean
}

export type ReactionRuntimeLightingDeps = {
  readonly led: Readonly<Record<string, unknown>>
  lightOn(ledName: string, r: number, g: number, b: number, durationMs?: number): void
}

export type ReactionRuntimeDeps = {
  face: ReactionRuntimeFaceDeps
  ui: ReactionRuntimeUIDeps
  motion: ReactionRuntimeMotionDeps
  audio: ReactionRuntimeAudioDeps
  lighting: ReactionRuntimeLightingDeps
  /** Builds a `UIEffect` for an EmoticonKey-like key. No safe non-Piu default exists. */
  createEffect(key: string): unknown
  /** Validates a hand-animation name. Defaults to a local copy of the built-in catalog. */
  isHandAnimationName?(value: string): boolean
  /** Monotonic milliseconds. Defaults to `Time.ticks`. */
  now?(): number
  trace?(message: string): void
}

/** Structurally identical to `capabilities.ts`'s `ReactionCapability` — see the file header. */
export type ReactionCapability = {
  readonly names: readonly ReactionName[]
  play(name: ReactionName, options?: ReactionOptions): ReactionPlayResult
  cancel(): boolean
  status(): ReactionStatus
}

/** Structurally identical to `capabilities.ts`'s `PerformanceCapability` — see the file header. */
export type PerformanceCapability = {
  readonly names: readonly PerformanceName[]
  play(name: PerformanceName, options?: PerformanceOptions): PerformancePlayResult
  cancel(): boolean
  status(): PerformanceStatus
}

export type ReactionRuntime = {
  reaction: ReactionCapability
  performance: PerformanceCapability
  close(): void
}

// Mirrors HAND_ANIMATION_NAMES in host/modules/ui/components/hands/hands.ts. Duplicated (rather
// than imported) because that module pulls in Piu and cannot be loaded under Node; the reaction
// catalog's own test does the same duplication for the same reason.
const DEFAULT_HAND_ANIMATION_NAMES = ['none', 'rock-paper-scissors', 'clap', 'thinking', 'wave', 'cheer']

function defaultIsHandAnimationName(value: string): boolean {
  return DEFAULT_HAND_ANIMATION_NAMES.includes(value)
}

function lookupReaction(name: string) {
  return isReactionName(name) ? reactionTimeline(name) : undefined
}

function lookupMotion(name: string) {
  return isMotionName(name) ? motionDefinition(name) : undefined
}

function lookupPerformance(name: string) {
  return isPerformanceName(name) ? performanceTimeline(name) : undefined
}

/**
 * Builds the `PerformanceStage` over `deps` without the players. Exported mainly so
 * runtime-reaction.test.ts can exercise stage behavior (unknown names, head moves,
 * effect bookkeeping, snapshot/restore) directly, without going through a full
 * catalog timeline for every case.
 */
export function createReactionStage(deps: ReactionRuntimeDeps): PerformanceStage {
  const now = deps.now ?? (() => Time.ticks)
  const trace = deps.trace ?? defaultTrace
  const isHandAnimationName = deps.isHandAnimationName ?? defaultIsHandAnimationName

  let lastEmotion = 'NEUTRAL'
  let lastHand = 'none'
  let lastEffectKey: string | null = null
  let currentEffect: unknown
  let torqueHeld = false
  // Bumped per setHead so a move still waiting on torque never lands after a newer target.
  let headSequence = 0

  const poseForRotation = (rotation: Rotationish): Poseish => ({
    position: { ...deps.motion.pose.body.position },
    rotation,
  })

  const stage: PerformanceStage = {
    now,
    snapshot() {
      const rotation = deps.motion.pose.body.rotation
      return {
        emotion: lastEmotion,
        hand: lastHand,
        effect: lastEffectKey,
        head: { yaw: rotation.y, pitch: rotation.p },
      }
    },
    setEmotion(name) {
      const emotion = emotionFromName(name)
      if (emotion === undefined) return false
      deps.face.setEmotion(emotion)
      lastEmotion = toEmotionName(emotion)
      return true
    },
    setEyeOpen(left, right) {
      deps.face.setEyeOpen('left', left)
      deps.face.setEyeOpen('right', right)
    },
    setMouthOpen(value) {
      deps.face.setMouthOpen(value)
    },
    setHand(name) {
      if (!isHandAnimationName(name)) return false
      deps.ui.setHandAnimation(name)
      lastHand = name
      return true
    },
    setEffect(key) {
      if (currentEffect !== undefined) {
        try {
          deps.ui.removeEffect(currentEffect)
        } catch (error) {
          trace(`[reaction] removeEffect failed: ${String(error)}\n`)
        }
        currentEffect = undefined
      }
      lastEffectKey = key
      if (key === null) return
      try {
        currentEffect = deps.createEffect(key)
        deps.ui.addEffect(currentEffect)
      } catch (error) {
        trace(`[reaction] addEffect failed: ${String(error)}\n`)
        currentEffect = undefined
      }
    },
    setHead(target, durationMs, done) {
      headSequence += 1
      const sequence = headSequence
      try {
        const move = () => {
          if (sequence !== headSequence) {
            done(true)
            return
          }
          try {
            deps.motion.setPose(poseForRotation({ r: 0, p: target.pitch, y: target.yaw }), durationMs / 1000).then(
              () => done(true),
              (error) => {
                trace(`[reaction] head move failed: ${String(error)}\n`)
                done(false)
              },
            )
          } catch (error) {
            trace(`[reaction] head move failed: ${String(error)}\n`)
            done(false)
          }
        }
        if (torqueHeld) {
          move()
          return
        }
        torqueHeld = true
        deps.motion.setTorque(true).then(move, (error) => {
          torqueHeld = false
          trace(`[reaction] torque enable failed: ${String(error)}\n`)
          done(false)
        })
      } catch (error) {
        trace(`[reaction] head move failed: ${String(error)}\n`)
        done(false)
      }
    },
    releaseHead() {
      torqueHeld = false
      try {
        deps.motion.setTorque(false).catch((error) => {
          trace(`[reaction] torque release failed: ${String(error)}\n`)
        })
      } catch (error) {
        trace(`[reaction] torque release failed: ${String(error)}\n`)
      }
    },
    lightOn(r, g, b, durationMs) {
      const ledName = Object.keys(deps.lighting.led)[0]
      if (!ledName) return
      deps.lighting.lightOn(ledName, r, g, b, durationMs)
    },
    isAudioActive() {
      return deps.audio.isActive
    },
    say(text, volume, done) {
      deps.audio.say(text, volume).then(
        (result) => done(result.success),
        (error) => {
          trace(`[reaction] say failed: ${String(error)}\n`)
          done(false)
        },
      )
    },
    sing(koe, volume, done) {
      deps.audio.sing(koe, volume).then(
        (result) => done(result.success),
        (error) => {
          trace(`[reaction] sing failed: ${String(error)}\n`)
          done(false)
        },
      )
    },
  }

  return stage
}

export function createReactionRuntime(deps: ReactionRuntimeDeps): ReactionRuntime {
  const trace = deps.trace ?? defaultTrace
  const stage = createReactionStage(deps)

  const reactionPlayer = new ReactionPlayer({ stage, trace })
  const performancePlayer = new PerformancePlayer({
    stage,
    reactions: lookupReaction,
    motions: lookupMotion,
    trace,
  })

  const reaction: ReactionCapability = {
    names: REACTION_NAMES,
    play(name, options) {
      if (performancePlayer.status().active !== null) return { ok: false, error: 'performance active' }
      const timeline = lookupReaction(name)
      if (timeline === undefined) return { ok: false, error: `unknown reaction: ${name}` }
      return reactionPlayer.play(timeline, options)
    },
    cancel() {
      return reactionPlayer.cancel()
    },
    status() {
      return reactionPlayer.status()
    },
  }

  const performance: PerformanceCapability = {
    names: PERFORMANCE_NAMES,
    play(name, options) {
      if (reactionPlayer.status().active !== null) reactionPlayer.cancel()
      const timeline = lookupPerformance(name)
      if (timeline === undefined) return { ok: false, error: `unknown performance: ${name}` }
      return performancePlayer.play(timeline, options)
    },
    cancel() {
      return performancePlayer.cancel()
    },
    status() {
      return performancePlayer.status()
    },
  }

  return {
    reaction,
    performance,
    close() {
      reactionPlayer.cancel()
      performancePlayer.cancel()
    },
  }
}
