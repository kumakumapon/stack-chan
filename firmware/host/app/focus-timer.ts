import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { registerFocusTimerApp } from 'focus-timer-mini-app'
import { FOCUS_TIMER_DOMAIN, FOCUS_TIMER_KEY, FocusTimerService } from 'focus-timer-service'
import Modules from 'modules'
import Preference from 'preference'
import Time from 'time'
import Timer from 'timer'

/** Called by the host, before MOD context behaviors (which may replace the default ones). */
export function installFocusTimer(context: StackchanContext): void {
  const platform = Modules.has('focus-timer-platform')
    ? (Modules.importNow('focus-timer-platform') as { now(): number; takeHiddenAt(): number | undefined })
    : undefined
  const service = new FocusTimerService({
    now: platform ? () => platform.now() : () => Time.ticks,
    takeHiddenAt: platform ? () => platform.takeHiddenAt() : undefined,
    schedule: (callback, delay) => {
      const timer = Timer.set(callback, delay)
      return () => Timer.clear(timer)
    },
    storage: {
      get: () => Preference.get(FOCUS_TIMER_DOMAIN, FOCUS_TIMER_KEY),
      set: (value) => Preference.set(FOCUS_TIMER_DOMAIN, FOCUS_TIMER_KEY, value),
    },
    suppressIdle: () => suppressCompanionIdle(context),
  })
  registerFocusTimerApp(service, context.ui.miniApps, (close) => context.lifecycle.onClose(close))
}
