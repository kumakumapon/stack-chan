/**
 * Energy-based voice activity detector.
 *
 * Frame-granular and clock-free: duration and hangover are counted in samples
 * against `sampleRate`, never `Date.now()` or a timer, so the detector is
 * deterministic and replayable in tests.
 *
 * Hysteresis: crossing `activationLevel` starts speech immediately (so the
 * Gateway can start buffering audio without delay). Crossing back down to
 * `releaseLevel` and staying there for `hangoverMs` ends speech. Short blips
 * that never spend `hangoverMs` continuously below `releaseLevel` never end
 * the utterance at all. Because `speech.start` fires eagerly, a short
 * utterance (one that releases before reaching `minUtteranceMs` of voiced
 * audio) still gets a `speech.start` with no matching `speech.end` -- callers
 * that buffered audio since `speech.start` should discard it in that case.
 */

import { rmsLevel } from './pcm.ts'

export type VadOptions = {
  sampleRate: number
  activationLevel?: number
  releaseLevel?: number
  hangoverMs?: number
  minUtteranceMs?: number
}

export type VadEvent = { type: 'speech.start' } | { type: 'speech.end'; durationMs: number }

const DEFAULT_ACTIVATION_LEVEL = 0.02
const DEFAULT_RELEASE_LEVEL = 0.012
const DEFAULT_HANGOVER_MS = 300
const DEFAULT_MIN_UTTERANCE_MS = 200

export function createEnergyVad(options: VadOptions): {
  push(frame: Int16Array): VadEvent[]
  reset(): void
  readonly speaking: boolean
} {
  const { sampleRate } = options
  const activationLevel = options.activationLevel ?? DEFAULT_ACTIVATION_LEVEL
  const releaseLevel = options.releaseLevel ?? DEFAULT_RELEASE_LEVEL
  const hangoverMs = options.hangoverMs ?? DEFAULT_HANGOVER_MS
  const minUtteranceMs = options.minUtteranceMs ?? DEFAULT_MIN_UTTERANCE_MS

  let speaking = false
  // Samples since `speech.start`, hangover silence included.
  let utteranceSamples = 0
  // Consecutive samples at/under `releaseLevel` since the level last rose above it.
  let belowReleaseRunSamples = 0

  const samplesToMs = (samples: number): number => (samples / sampleRate) * 1000

  const reset = (): void => {
    speaking = false
    utteranceSamples = 0
    belowReleaseRunSamples = 0
  }

  const push = (frame: Int16Array): VadEvent[] => {
    if (frame.length === 0) return []
    const level = rmsLevel(frame)

    if (!speaking) {
      if (level < activationLevel) return []
      speaking = true
      utteranceSamples = frame.length
      belowReleaseRunSamples = level <= releaseLevel ? frame.length : 0
      return [{ type: 'speech.start' }]
    }

    utteranceSamples += frame.length
    belowReleaseRunSamples = level <= releaseLevel ? belowReleaseRunSamples + frame.length : 0

    if (samplesToMs(belowReleaseRunSamples) < hangoverMs) return []

    // Released: the trailing hangover silence doesn't count as voiced duration.
    const durationMs = samplesToMs(utteranceSamples - belowReleaseRunSamples)
    reset()
    return durationMs >= minUtteranceMs ? [{ type: 'speech.end', durationMs }] : []
  }

  return {
    push,
    reset,
    get speaking() {
      return speaking
    },
  }
}
