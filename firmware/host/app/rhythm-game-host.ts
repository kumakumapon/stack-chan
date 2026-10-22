import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { createMemoryGameScheduler } from 'memory-game'
import { monotonicNow } from 'monotonic-clock'
import { RHYTHM_TAP_MAX_DURATION } from 'rhythm-game'
import { createRhythmGameApp } from 'rhythm-game-mini-app'
import Timer from 'timer'

export function installRhythmGame(context: StackchanContext): void {
  const unregister = context.ui.miniApps.register(
    createRhythmGameApp({
      now: monotonicNow,
      schedule: createMemoryGameScheduler(Timer),
      tone() {
        if (
          context.conversation.remoteSession?.activationState === 'active' ||
          context.audio.isActive ||
          context.performance.status().active ||
          context.reaction.status().active
        )
          return undefined
        const tone = context.audio.toneOwned?.(880, 90)
        return tone ? () => tone.cancel() : undefined
      },
      subscribeTap(listener) {
        // The recognizer confirms short stationary contacts on release. Use its
        // duration with the host clock: WASM event ticks may use a different epoch.
        return (
          context.input.touchPanel?.subscribe((event) => {
            if (event.gesture !== 'release' || !event.tap) return
            const { durationMs, maxMovement } = event.tap
            if (
              !Number.isFinite(durationMs) ||
              durationMs < 0 ||
              durationMs > RHYTHM_TAP_MAX_DURATION ||
              !Number.isFinite(maxMovement) ||
              maxMovement < 0 ||
              maxMovement > 15
            )
              return
            listener(monotonicNow() - durationMs)
          }) ?? (() => undefined)
        )
      },
      suppressIdle: () => suppressCompanionIdle(context),
    }),
  )
  context.lifecycle.onClose(unregister)
}
