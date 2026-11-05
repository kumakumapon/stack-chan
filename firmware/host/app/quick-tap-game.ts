/** Offline reaction-time game. Time, randomness, sound and storage are injected by the host. */
export const QUICK_TAP_APP_ID = 'stackchan.quick-tap'
export const QUICK_TAP_ROUNDS = 5
export const QUICK_TAP_TIMING = Object.freeze({
  /** Random wait before "now!", so the signal cannot be anticipated by rhythm. */
  minDelay: 1500,
  maxDelay: 4000,
  /** No tap within this window after "now!" counts as too slow. */
  window: 1500,
  /** How long each round's verdict stays on screen before the next round arms. */
  result: 1300,
  /** Faster than this is a guess, not a reaction. */
  anticipation: 100,
})
export const QUICK_TAP_DOMAIN = 'sc_quicktap'
export const QUICK_TAP_KEY = 'state'
export type QuickTapPhase = 'ready' | 'waiting' | 'go' | 'hit' | 'early' | 'slow' | 'complete' | 'closed'
export type QuickTapRank = 'lightning' | 'fast' | 'good' | 'relaxed'
export type QuickTapSnapshot = Readonly<{
  phase: QuickTapPhase
  round: number
  lastMs: number | null
  /** Fastest hit in the current set. */
  bestMs: number | null
  /** Saved personal best across sets. */
  recordMs: number | null
  newRecord: boolean
  hits: number
  sound: boolean
  muted: boolean
  saveFailed: boolean
}>
export type QuickTapStorage = { get(): unknown; set(value: string): void }
export type QuickTapGameOptions = {
  now(): number
  random(): number
  schedule(callback: () => void, delayMs: number): () => void
  /** Starts a short cue, returning an owner-scoped cancel handle; undefined means busy/unavailable. */
  tone?(): (() => void) | undefined
  storage?: QuickTapStorage
  onResult?(score: number): void
}

export function quickTapRank(ms: number): QuickTapRank {
  if (ms < 250) return 'lightning'
  if (ms < 350) return 'fast'
  if (ms < 500) return 'good'
  return 'relaxed'
}

/** A saved record is a whole number of milliseconds inside the playable window. */
export function parseQuickTapRecord(raw: unknown): number | null {
  const value = typeof raw === 'string' && /^[0-9]{1,5}$/.test(raw) ? Number(raw) : raw
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < QUICK_TAP_TIMING.anticipation ||
    value > QUICK_TAP_TIMING.window
  )
    return null
  return value
}

export class QuickTapGame {
  readonly #options: QuickTapGameOptions
  #phase: QuickTapPhase = 'ready'
  #round = 1
  #lastMs: number | null = null
  #bestMs: number | null = null
  #recordMs: number | null
  #newRecord = false
  #hits = 0
  #sound = true
  #muted = false
  #saveFailed = false
  #goAt = 0
  #generation = 0
  #cancelTimer: (() => void) | undefined
  #cancelTone: (() => void) | undefined
  #listeners = new Set<(snapshot: QuickTapSnapshot) => void>()

  constructor(options: QuickTapGameOptions) {
    this.#options = options
    let raw: unknown
    try {
      raw = options.storage?.get()
    } catch {
      raw = undefined
    }
    this.#recordMs = parseQuickTapRecord(raw)
  }

  snapshot(): QuickTapSnapshot {
    return {
      phase: this.#phase,
      round: this.#round,
      lastMs: this.#lastMs,
      bestMs: this.#bestMs,
      recordMs: this.#recordMs,
      newRecord: this.#newRecord,
      hits: this.#hits,
      sound: this.#sound,
      muted: this.#muted,
      saveFailed: this.#saveFailed,
    }
  }

  subscribe(listener: (snapshot: QuickTapSnapshot) => void): () => void {
    if (this.#phase === 'closed') return () => undefined
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  /** Starts a set of rounds. Only an explicit call starts one; a set always ends after the last round. */
  start(): void {
    if (this.#phase !== 'ready' && this.#phase !== 'complete') return
    this.#stopPending()
    this.#round = 1
    this.#lastMs = null
    this.#bestMs = null
    this.#newRecord = false
    this.#saveFailed = false
    this.#hits = 0
    this.#arm()
  }

  /** Judge one press, stamped with the host clock at its input edge. */
  tap(at: number): void {
    if (!Number.isFinite(at)) return
    if (this.#phase === 'waiting') {
      this.#verdict('early', null)
      return
    }
    if (this.#phase !== 'go') return
    const elapsed = at - this.#goAt
    if (elapsed < QUICK_TAP_TIMING.anticipation) {
      this.#verdict('early', null)
      return
    }
    const ms = Math.round(elapsed)
    this.#hits++
    if (this.#bestMs === null || ms < this.#bestMs) this.#bestMs = ms
    this.#verdict('hit', ms)
  }

  setSound(enabled: boolean): void {
    if (this.#phase === 'closed') return
    this.#sound = enabled
    this.#muted = false
    if (!enabled) this.#stopTone()
    this.#publish()
  }

  close(): void {
    if (this.#phase === 'closed') return
    this.#phase = 'closed'
    this.#stopPending()
    this.#listeners.clear()
  }

  #arm(): void {
    this.#phase = 'waiting'
    this.#lastMs = null
    this.#muted = false
    this.#publish()
    const random = this.#options.random()
    const fraction = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5
    const delay =
      QUICK_TAP_TIMING.minDelay + Math.floor(fraction * (QUICK_TAP_TIMING.maxDelay - QUICK_TAP_TIMING.minDelay))
    this.#wait(delay, () => this.#go())
  }

  #go(): void {
    this.#phase = 'go'
    this.#goAt = this.#options.now()
    if (this.#sound) {
      try {
        this.#cancelTone = this.#options.tone?.()
        this.#muted = !this.#cancelTone
      } catch {
        this.#muted = true
      }
    }
    this.#publish()
    this.#wait(QUICK_TAP_TIMING.window, () => this.#verdict('slow', null))
  }

  #verdict(phase: 'hit' | 'early' | 'slow', ms: number | null): void {
    this.#stopTone()
    this.#phase = phase
    this.#lastMs = ms
    this.#publish()
    this.#wait(QUICK_TAP_TIMING.result, () => {
      if (this.#round < QUICK_TAP_ROUNDS) {
        this.#round++
        this.#arm()
      } else this.#complete()
    })
  }

  #complete(): void {
    this.#phase = 'complete'
    if (this.#bestMs !== null && (this.#recordMs === null || this.#bestMs < this.#recordMs)) {
      this.#newRecord = true
      this.#recordMs = this.#bestMs
      try {
        this.#options.storage?.set(String(this.#bestMs))
        this.#saveFailed = false
      } catch {
        this.#saveFailed = true
      }
    }
    this.#publish()
    this.#options.onResult?.(this.#hits)
  }

  #wait(delayMs: number, callback: () => void): void {
    if (this.#phase === 'closed') return
    const generation = ++this.#generation
    this.#cancelTimer?.()
    this.#cancelTimer = this.#options.schedule(() => {
      if (this.#phase === 'closed' || generation !== this.#generation) return
      this.#cancelTimer = undefined
      callback()
    }, delayMs)
  }

  #stopTone(): void {
    const cancel = this.#cancelTone
    this.#cancelTone = undefined
    cancel?.()
  }

  #stopPending(): void {
    this.#generation++
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#stopTone()
  }

  #publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
