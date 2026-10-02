/** Offline timer state. Deadlines use a monotonic clock, never calendar time. */
export const FOCUS_TIMER_PRESETS = Object.freeze({
  'focus-5': { phase: 'focus', durationMs: 5 * 60 * 1000 },
  'focus-15': { phase: 'focus', durationMs: 15 * 60 * 1000 },
  'focus-25': { phase: 'focus', durationMs: 25 * 60 * 1000 },
  'break-5': { phase: 'break', durationMs: 5 * 60 * 1000 },
} as const)

export type FocusTimerPreset = keyof typeof FOCUS_TIMER_PRESETS
export type FocusTimerState = 'idle' | 'running' | 'paused' | 'completed' | 'interrupted'
export type FocusTimerSnapshot = Readonly<{
  state: FocusTimerState
  preset: FocusTimerPreset
  phase: 'focus' | 'break'
  durationMs: number
  /** Unknown after an interrupted session; power-off time is never inferred. */
  remainingMs: number | null
  generation: number
  pauseReason?: 'user' | 'hidden'
  interruptionReason?: 'reboot' | 'clock'
}>

export function isFocusTimerPreset(value: unknown): value is FocusTimerPreset {
  return typeof value === 'string' && Object.hasOwn(FOCUS_TIMER_PRESETS, value)
}

export class FocusTimerModel {
  #now: () => number
  #preset: FocusTimerPreset = 'focus-25'
  #state: FocusTimerState = 'idle'
  #remainingMs: number | null = FOCUS_TIMER_PRESETS['focus-25'].durationMs
  #deadline = 0
  #lastClock: number | undefined
  #generation = 0
  #pauseReason: FocusTimerSnapshot['pauseReason']
  #interruptionReason: FocusTimerSnapshot['interruptionReason']

  constructor(now: () => number, saved?: unknown) {
    this.#now = now
    this.restore(saved)
  }

  snapshot(): FocusTimerSnapshot {
    return Object.freeze({
      state: this.#state,
      preset: this.#preset,
      ...FOCUS_TIMER_PRESETS[this.#preset],
      remainingMs: this.#remainingMs,
      generation: this.#generation,
      ...(this.#pauseReason ? { pauseReason: this.#pauseReason } : {}),
      ...(this.#interruptionReason ? { interruptionReason: this.#interruptionReason } : {}),
    })
  }

  select(preset: FocusTimerPreset): boolean {
    if (this.#state !== 'idle' || !isFocusTimerPreset(preset) || preset === this.#preset) return false
    this.#preset = preset
    this.#remainingMs = FOCUS_TIMER_PRESETS[preset].durationMs
    this.#generation++
    return true
  }

  start(preset: FocusTimerPreset = this.#preset): boolean {
    if (this.#state === 'running' || this.#state === 'paused' || !isFocusTimerPreset(preset)) return false
    this.#preset = preset
    this.#pauseReason = undefined
    this.#interruptionReason = undefined
    this.#lastClock = undefined
    const now = this.#readClock()
    if (now === undefined) return false
    this.#remainingMs = FOCUS_TIMER_PRESETS[preset].durationMs
    this.#deadline = now + this.#remainingMs
    this.#state = 'running'
    this.#generation++
    return true
  }

  elapsed(generation = this.#generation): boolean {
    if (generation !== this.#generation || this.#state !== 'running') return false
    const now = this.#readClock()
    if (now === undefined) return false
    this.#remainingMs = Math.max(0, this.#deadline - now)
    if (this.#remainingMs !== 0) return false
    this.#state = 'completed'
    this.#generation++
    return true
  }

  pause(reason: 'user' | 'hidden' = 'user', at?: number): boolean {
    if (this.#state !== 'running') return false
    // A queued browser visibility event carries its original monotonic instant.
    // Even if RAF/timers stopped, time spent hidden must not count on return.
    const now = this.#readClock(at)
    if (now === undefined) return false
    this.#remainingMs = Math.max(0, this.#deadline - now)
    if (this.#remainingMs === 0) {
      this.#state = 'completed'
    } else {
      this.#state = 'paused'
      this.#pauseReason = reason
    }
    this.#generation++
    return this.#state === 'paused'
  }

  resume(): boolean {
    if (this.#state !== 'paused') return false
    const now = this.#readClock()
    if (now === undefined) return false
    this.#deadline = now + (this.#remainingMs ?? 0)
    this.#state = 'running'
    this.#pauseReason = undefined
    this.#generation++
    return true
  }

  cancel(): boolean {
    if (this.#state !== 'running' && this.#state !== 'paused') return false
    this.#reset()
    return true
  }

  acknowledge(): boolean {
    if (this.#state !== 'completed' && this.#state !== 'interrupted') return false
    this.#reset()
    return true
  }

  interrupt(reason: 'reboot' | 'clock'): void {
    this.#state = 'interrupted'
    this.#remainingMs = null
    this.#pauseReason = undefined
    this.#interruptionReason = reason
    this.#generation++
  }

  serialize(): string {
    // Only settings and the latest state. No history, deadlines or task contents.
    return JSON.stringify({ version: 1, preset: this.#preset, state: this.#state })
  }

  restore(saved: unknown): void {
    this.#preset = 'focus-25'
    this.#state = 'idle'
    this.#lastClock = undefined
    this.#pauseReason = undefined
    this.#interruptionReason = undefined
    this.#generation++
    try {
      const value = typeof saved === 'string' ? JSON.parse(saved) : undefined
      if (
        value?.version === 1 &&
        isFocusTimerPreset(value.preset) &&
        ['idle', 'running', 'paused', 'completed', 'interrupted'].includes(value.state)
      ) {
        this.#preset = value.preset
        this.#state = value.state
        if (this.#state === 'running' || this.#state === 'paused' || this.#state === 'interrupted') {
          this.#state = 'interrupted'
          this.#interruptionReason = 'reboot'
        }
      }
    } catch {
      // A corrupt or newer record cannot create an active timer.
    }
    this.#remainingMs =
      this.#state === 'interrupted'
        ? null
        : this.#state === 'completed'
          ? 0
          : FOCUS_TIMER_PRESETS[this.#preset].durationMs
  }

  #readClock(at?: number): number | undefined {
    let now: number
    try {
      now = at ?? this.#now()
    } catch {
      this.interrupt('clock')
      return undefined
    }
    if (!Number.isFinite(now) || now < 0 || (this.#lastClock !== undefined && now < this.#lastClock)) {
      this.interrupt('clock')
      return undefined
    }
    this.#lastClock = now
    return now
  }

  #reset(): void {
    this.#state = 'idle'
    this.#remainingMs = FOCUS_TIMER_PRESETS[this.#preset].durationMs
    this.#pauseReason = undefined
    this.#interruptionReason = undefined
    this.#lastClock = undefined
    this.#generation++
  }
}
