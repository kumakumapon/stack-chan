/**
 * Low-battery tracking for Companion Mode.
 *
 * `nextLowBatteryState` is the pure decision (hysteresis + confirmation), and
 * `createCompanionBattery` is a thin polling adapter whose dependencies are
 * injected so it stays testable from Node without Moddable modules.
 */

export type LowBatteryThresholds = { readonly enterAt: number; readonly exitAt: number }
export type LowBatteryEvent = 'enter' | 'recover'
export type LowBatteryState = {
  /** Confirmed low state. */
  readonly low: boolean
  /** Consecutive valid samples on the opposite side of the current state. */
  readonly pending: number
  /** Whether any valid sample has been seen. */
  readonly seen: boolean
}
export type LowBatteryStep = { readonly state: LowBatteryState; readonly event?: LowBatteryEvent }

export const LOW_BATTERY_THRESHOLDS: LowBatteryThresholds = { enterAt: 20, exitAt: 25 }
export const INITIAL_LOW_BATTERY_STATE: LowBatteryState = { low: false, pending: 0, seen: false }

/** Samples that must agree before a transition is confirmed (rejects single-sample dips). */
const CONFIRM_SAMPLES = 2

function isValidLevel(level: unknown): level is number {
  return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 100
}

export function nextLowBatteryState(
  previous: LowBatteryState,
  level: number | undefined,
  thresholds: LowBatteryThresholds = LOW_BATTERY_THRESHOLDS,
): LowBatteryStep {
  // Missing or out-of-range readings carry no information: keep the state as is.
  if (!isValidLevel(level)) return { state: previous }
  if (!previous.seen && level <= thresholds.enterAt) {
    // Start-up already low: report once without waiting for confirmation.
    return { state: { low: true, pending: 0, seen: true }, event: 'enter' }
  }
  const crossing = previous.low ? level >= thresholds.exitAt : level <= thresholds.enterAt
  if (!crossing) return { state: { low: previous.low, pending: 0, seen: true } }
  const pending = previous.pending + 1
  if (pending < CONFIRM_SAMPLES) return { state: { low: previous.low, pending, seen: true } }
  return {
    state: { low: !previous.low, pending: 0, seen: true },
    event: previous.low ? 'recover' : 'enter',
  }
}

export type CompanionBatteryTimer = {
  set(callback: () => void, delay: number): unknown
  clear(handle: unknown): void
}

export type CompanionBatteryOptions = {
  readLevel: (() => number | undefined) | null | undefined
  timer: CompanionBatteryTimer
  /**
   * Called when a low-battery notice is due. Return true once the notice was
   * actually shown; returning false keeps it pending for the next poll.
   */
  onLow: () => boolean
  firstDelayMs?: number
  intervalMs?: number
}

export type CompanionBattery = {
  isLow(): boolean
  close(): void
}

export function createCompanionBattery(options: CompanionBatteryOptions): CompanionBattery | undefined {
  const { readLevel, timer, onLow } = options
  if (typeof readLevel !== 'function') return undefined
  const intervalMs = options.intervalMs ?? 60000
  let state = INITIAL_LOW_BATTERY_STATE
  let announcePending = false
  let closed = false
  let handle: unknown
  const poll = () => {
    let level: number | undefined
    try {
      level = readLevel()
    } catch {
      level = undefined
    }
    const step = nextLowBatteryState(state, level)
    state = step.state
    if (step.event === 'enter') announcePending = true
    else if (step.event === 'recover') announcePending = false
    if (announcePending && onLow()) announcePending = false
  }
  const tick = () => {
    if (closed) return
    poll()
    if (!closed) handle = timer.set(tick, intervalMs)
  }
  handle = timer.set(tick, options.firstDelayMs ?? 5000)
  return {
    isLow: () => state.low,
    close() {
      closed = true
      timer.clear(handle)
    },
  }
}
