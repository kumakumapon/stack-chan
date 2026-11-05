import loadPreferences from 'loadPreference'
import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { isClockSynced } from 'companion-time'
import { DOMAIN } from 'consts'
import { FORTUNE_DOMAIN, FORTUNE_KEY, localDayNumber } from 'fortune'
import { createFortuneApp } from 'fortune-mini-app'
import type { JankenMotionBlockReason } from 'janken-game'
import { createJankenApp } from 'janken-mini-app'
import { createMemoryGameScheduler } from 'memory-game'
import Modules from 'modules'
import { monotonicNow } from 'monotonic-clock'
import Preference from 'preference'
import { QUICK_TAP_DOMAIN, QUICK_TAP_KEY } from 'quick-tap-game'
import { createQuickTapApp } from 'quick-tap-mini-app'
import Timer from 'timer'
import { getTimezonePreset } from 'timezone-model'
import type { workshopFor } from 'workshop-service'

/**
 * Offline play pack: rock-paper-scissors with "look over there", a reaction-time
 * game and a daily fortune. It is loaded by name from main.ts, not imported there, and
 * not preloaded (the WASM host boots without it).
 */
export function installPlayPack(context: StackchanContext): void {
  const schedule = createMemoryGameScheduler(Timer)
  const suppressIdle = () => suppressCompanionIdle(context)
  const storage = (domain: string, key: string) => ({
    get: () => Preference.get(domain, key),
    set: (value: string) => Preference.set(domain, key, value),
  })
  // Explicit user activity and another MOD's animation always win over game effects.
  const busy = (): JankenMotionBlockReason | null => {
    if (context.conversation.remoteSession?.activationState === 'active') return 'conversation'
    if (context.audio.isActive || context.performance.status().active || context.reaction.status().active) return 'busy'
    return null
  }
  // main.ts applies the saved timezone once at boot, so read the offset once too.
  let offsetMinutes: number | undefined
  const today = () => {
    const epochMs = Date.now()
    if (!isClockSynced(epochMs)) return null
    offsetMinutes ??= getTimezonePreset(loadPreferences(DOMAIN.time).timezone).offsetMinutes
    return localDayNumber(epochMs, offsetMinutes)
  }
  for (const definition of [
    createJankenApp({
      random: Math.random,
      schedule,
      motionBlockReason: busy,
      react(name) {
        // Motion is opt-in, and once on, the glance direction is the game itself: move
        // clearly. The reaction limits still clamp every head target.
        const intensity = name === 'success' || name === 'proud' ? 0.3 : 0.9
        const result = context.reaction.playOwned?.(name, { intensity, restore: true })
        return result?.ok
          ? () => {
              result.cancel()
            }
          : undefined
      },
      suppressIdle,
    }),
    createQuickTapApp({
      now: monotonicNow,
      random: Math.random,
      schedule,
      storage: storage(QUICK_TAP_DOMAIN, QUICK_TAP_KEY),
      tone() {
        if (busy()) return undefined
        const tone = context.audio.toneOwned?.(1320, 120)
        return tone ? () => tone.cancel() : undefined
      },
      subscribeTap(listener) {
        // A press edge is the moment the finger lands; stamp it with the host clock
        // because WASM event ticks may use a different epoch.
        return (
          context.input.touchPanel?.subscribe((event) => {
            if (event.gesture === 'press') listener(monotonicNow())
          }) ?? (() => undefined)
        )
      },
      suppressIdle,
    }),
    createFortuneApp({
      random: Math.random,
      schedule,
      today,
      storage: storage(FORTUNE_DOMAIN, FORTUNE_KEY),
      onReveal(draw) {
        // Optional effects follow the Workshop gesture/sound settings (both off by default).
        // Resolve the service at runtime so no network module joins the preload chain.
        if (!Modules.has('workshop-service')) return undefined
        const workshop = (Modules.importNow('workshop-service') as { workshopFor: typeof workshopFor }).workshopFor(
          context,
        )
        workshop.sound()
        // Returned so closing the slip also stops its gesture.
        return workshop.react(draw.rank === 'great' || draw.rank === 'middle' ? 'success' : 'yes')
      },
      suppressIdle,
    }),
  ]) {
    context.lifecycle.onClose(context.ui.miniApps.register(definition))
  }
}
