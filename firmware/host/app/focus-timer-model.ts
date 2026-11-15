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
  readonly #data: {
    -readonly [Key in keyof Omit<FocusTimerSnapshot, 'phase' | 'durationMs'>]: Omit<
      FocusTimerSnapshot,
      'phase' | 'durationMs'
    >[Key]
  } = {
    preset: 'focus-25',
    state: 'idle',
    remainingMs: FOCUS_TIMER_PRESETS['focus-25'].durationMs,
    generation: 0,
    pauseReason: undefined,
    interruptionReason: undefined,
  }

  #deadline = 0
  #lastClock: number | undefined

  constructor(now: () => number, saved?: unknown) {
    this.#now = now
    this.restore(saved)
  }

  snapshot(): FocusTimerSnapshot {
    return Object.freeze({
      state: this.#data.state,
      preset: this.#data.preset,
      ...FOCUS_TIMER_PRESETS[this.#data.preset],
      remainingMs: this.#data.remainingMs,
      generation: this.#data.generation,
      ...(this.#data.pauseReason ? { pauseReason: this.#data.pauseReason } : {}),
      ...(this.#data.interruptionReason ? { interruptionReason: this.#data.interruptionReason } : {}),
    })
  }

  select(preset: FocusTimerPreset): boolean {
    if (this.#data.state !== 'idle' || !isFocusTimerPreset(preset) || preset === this.#data.preset) return false
    this.#data.preset = preset
    this.#data.remainingMs = FOCUS_TIMER_PRESETS[preset].durationMs
    this.#data.generation++
    return true
  }

  start(preset: FocusTimerPreset = this.#data.preset): boolean {
    if (this.#data.state === 'running' || this.#data.state === 'paused' || !isFocusTimerPreset(preset)) return false
    this.#data.preset = preset
    this.#data.pauseReason = undefined
    this.#data.interruptionReason = undefined
    this.#lastClock = undefined
    const now = this.#readClock()
    if (now === undefined) return false
    this.#data.remainingMs = FOCUS_TIMER_PRESETS[preset].durationMs
    this.#deadline = now + this.#data.remainingMs
    this.#data.state = 'running'
    this.#data.generation++
    return true
  }

  elapsed(generation = this.#data.generation): boolean {
    if (generation !== this.#data.generation || this.#data.state !== 'running') return false
    const now = this.#readClock()
    if (now === undefined) return false
    this.#data.remainingMs = Math.max(0, this.#deadline - now)
    if (this.#data.remainingMs !== 0) return false
    this.#data.state = 'completed'
    this.#data.generation++
    return true
  }

  pause(reason: 'user' | 'hidden' = 'user', at?: number): boolean {
    if (this.#data.state !== 'running') return false
    // A queued browser visibility event carries its original monotonic instant.
    // Even if RAF/timers stopped, time spent hidden must not count on return.
    const now = this.#readClock(at)
    if (now === undefined) return false
    this.#data.remainingMs = Math.max(0, this.#deadline - now)
    if (this.#data.remainingMs === 0) {
      this.#data.state = 'completed'
    } else {
      this.#data.state = 'paused'
      this.#data.pauseReason = reason
    }
    this.#data.generation++
    return this.#data.state === 'paused'
  }

  resume(): boolean {
    if (this.#data.state !== 'paused') return false
    const now = this.#readClock()
    if (now === undefined) return false
    this.#deadline = now + (this.#data.remainingMs ?? 0)
    this.#data.state = 'running'
    this.#data.pauseReason = undefined
    this.#data.generation++
    return true
  }

  cancel(): boolean {
    if (this.#data.state !== 'running' && this.#data.state !== 'paused') return false
    this.#reset()
    return true
  }

  acknowledge(): boolean {
    if (this.#data.state !== 'completed' && this.#data.state !== 'interrupted') return false
    this.#reset()
    return true
  }

  interrupt(reason: 'reboot' | 'clock'): void {
    this.#data.state = 'interrupted'
    this.#data.remainingMs = null
    this.#data.pauseReason = undefined
    this.#data.interruptionReason = reason
    this.#data.generation++
  }

  serialize(): string {
    // Only settings and the latest state. No history, deadlines or task contents.
    return JSON.stringify({ version: 1, preset: this.#data.preset, state: this.#data.state })
  }

  restore(saved: unknown): void {
    this.#data.preset = 'focus-25'
    this.#data.state = 'idle'
    this.#lastClock = undefined
    this.#data.pauseReason = undefined
    this.#data.interruptionReason = undefined
    this.#data.generation++
    try {
      const value = typeof saved === 'string' ? JSON.parse(saved) : undefined
      if (
        value?.version === 1 &&
        isFocusTimerPreset(value.preset) &&
        ['idle', 'running', 'paused', 'completed', 'interrupted'].includes(value.state)
      ) {
        this.#data.preset = value.preset
        this.#data.state = value.state
        if (this.#data.state === 'running' || this.#data.state === 'paused' || this.#data.state === 'interrupted') {
          this.#data.state = 'interrupted'
          this.#data.interruptionReason = 'reboot'
        }
      }
    } catch {
      // A corrupt or newer record cannot create an active timer.
    }
    this.#data.remainingMs =
      this.#data.state === 'interrupted'
        ? null
        : this.#data.state === 'completed'
          ? 0
          : FOCUS_TIMER_PRESETS[this.#data.preset].durationMs
  }

  #readClock(at?: number): number | undefined {
    let now: number
    try {
      now = at ?? this.#now()
    } catch {
      this.interrupt('clock')
      return undefined
    }
    if (
      !Number.isFinite(now) ||
      now < 0 ||
      now > Number.MAX_SAFE_INTEGER - FOCUS_TIMER_PRESETS['focus-25'].durationMs ||
      (this.#lastClock !== undefined && now < this.#lastClock)
    ) {
      this.interrupt('clock')
      return undefined
    }
    this.#lastClock = now
    return now
  }

  #reset(): void {
    this.#data.state = 'idle'
    this.#data.remainingMs = FOCUS_TIMER_PRESETS[this.#data.preset].durationMs
    this.#data.pauseReason = undefined
    this.#data.interruptionReason = undefined
    this.#lastClock = undefined
    this.#data.generation++
  }
}
