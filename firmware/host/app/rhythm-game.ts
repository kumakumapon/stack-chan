/** Offline rhythm practice. All time and sound ownership is supplied by the host. */
export const RHYTHM_GAME_ROUNDS = 6
export const RHYTHM_TAP_MAX_DURATION = 300
const PATTERNS: readonly (readonly number[])[] = [
  [600, 600],
  [600, 1200],
  [1200, 600, 600],
  [600, 600, 1200],
  [600, 1200, 600, 600],
  [600, 600, 1200, 600, 1200],
]
export type RhythmGamePhase = 'ready' | 'showing' | 'input' | 'won' | 'lost' | 'complete' | 'closed'
export type RhythmGameSnapshot = Readonly<{
  phase: RhythmGamePhase
  round: number
  beats: number
  matched: number
  cue: number
  pulse: boolean
  sound: boolean
  muted: boolean
  reason: 'early' | 'late' | 'timeout' | null
}>
export type RhythmGameOptions = {
  now(): number
  schedule(callback: () => void, delayMs: number): () => void
  /** Starts a short cue, returning an owner-scoped cancel handle; undefined means busy/unavailable. */
  tone?(): (() => void) | undefined
  onResult?(score: number): void
}

export class RhythmGame {
  readonly #options: RhythmGameOptions
  #phase: RhythmGamePhase = 'ready'
  #round = 1
  #matched = 0
  #cue = 0
  #pulse = false
  #sound = true
  #muted = false
  #reason: RhythmGameSnapshot['reason'] = null
  #inputSince = 0
  #lastTap: number | undefined
  #generation = 0
  #wakeId = 0
  #cancelTimer: (() => void) | undefined
  #cancelPulse: (() => void) | undefined
  #cancelTone: (() => void) | undefined
  #listeners = new Set<(snapshot: RhythmGameSnapshot) => void>()

  constructor(options: RhythmGameOptions) {
    this.#options = options
  }

  snapshot(): RhythmGameSnapshot {
    return {
      phase: this.#phase,
      round: this.#round,
      beats: this.#pattern.length + 1,
      matched: this.#matched,
      cue: this.#cue,
      pulse: this.#pulse,
      sound: this.#sound,
      muted: this.#muted,
      reason: this.#reason,
    }
  }

  subscribe(listener: (snapshot: RhythmGameSnapshot) => void): () => void {
    if (this.#phase === 'closed') return () => undefined
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  start(): void {
    if (!['ready', 'lost', 'won', 'complete'].includes(this.#phase)) return
    if (this.#phase === 'complete') this.#round = 1
    else if (this.#phase === 'won') this.#round++
    this.#demonstrate()
  }

  replay(): void {
    if (this.#phase === 'input' || this.#phase === 'lost') this.#demonstrate()
  }

  /** Judge press times, after the input adapter has confirmed a short, stationary tap. */
  tap(at: number): void {
    if (this.#phase !== 'input' || !Number.isFinite(at) || at < this.#inputSince || at > this.#options.now()) return
    if (this.#lastTap !== undefined) {
      const interval = at - this.#lastTap
      // Ignore duplicated edges/contact bounce, but reject deliberate rapid tapping.
      if (interval < 120) return
      const expected = this.#pattern[this.#matched - 1]
      const tolerance = Math.max(150, expected * 0.25)
      if (Math.abs(interval - expected) > tolerance) {
        this.#lose(interval < expected ? 'early' : 'late')
        return
      }
    }
    this.#lastTap = at
    this.#matched++
    this.#wakeId++
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#flash()
    if (this.#matched === this.#pattern.length + 1) {
      this.#phase = this.#round === RHYTHM_GAME_ROUNDS ? 'complete' : 'won'
      this.#publish()
      if (this.#phase === 'complete') this.#options.onResult?.(RHYTHM_GAME_ROUNDS)
      return
    }
    const expected = this.#pattern[this.#matched - 1]
    // A valid press may only be delivered on release, up to 300 ms later.
    const deadline = at + expected + Math.max(150, expected * 0.25) + RHYTHM_TAP_MAX_DURATION
    this.#wait(Math.max(0, deadline - this.#options.now()), () => this.#lose('timeout'))
    this.#publish()
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

  get #pattern(): readonly number[] {
    return PATTERNS[this.#round - 1]
  }

  #demonstrate(): void {
    this.#stopPending()
    this.#matched = 0
    this.#cue = 0
    this.#lastTap = undefined
    this.#reason = null
    this.#muted = false
    this.#phase = 'showing'
    this.#publish()
    this.#wait(600, () => this.#show(0))
  }

  #show(index: number): void {
    this.#cue = index + 1
    this.#flash()
    this.#publish()
    this.#wait(this.#pattern[index] ?? 800, () => {
      if (index < this.#pattern.length) this.#show(index + 1)
      else {
        this.#phase = 'input'
        this.#cue = 0
        this.#inputSince = this.#options.now()
        this.#wait(12000, () => this.#lose('timeout'))
        this.#publish()
      }
    })
  }

  #flash(): void {
    this.#cancelPulse?.()
    this.#stopTone()
    this.#pulse = true
    if (this.#sound) {
      try {
        this.#cancelTone = this.#options.tone?.()
        this.#muted = !this.#cancelTone
      } catch {
        this.#muted = true
      }
    }
    const generation = this.#generation
    this.#cancelPulse = this.#options.schedule(() => {
      if (this.#phase === 'closed' || generation !== this.#generation) return
      this.#cancelPulse = undefined
      this.#pulse = false
      this.#stopTone()
      this.#publish()
    }, 140)
  }

  #lose(reason: RhythmGameSnapshot['reason']): void {
    this.#stopPending()
    this.#phase = 'lost'
    this.#reason = reason
    this.#publish()
  }

  #wait(delayMs: number, callback: () => void): void {
    this.#cancelTimer?.()
    const generation = this.#generation
    const wakeId = ++this.#wakeId
    this.#cancelTimer = this.#options.schedule(() => {
      if (this.#phase === 'closed' || generation !== this.#generation || wakeId !== this.#wakeId) return
      this.#cancelTimer = undefined
      callback()
    }, delayMs)
  }

  #stopTone(): void {
    this.#cancelTone?.()
    this.#cancelTone = undefined
  }

  #stopPending(): void {
    this.#generation++
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#cancelPulse?.()
    this.#cancelPulse = undefined
    this.#pulse = false
    this.#stopTone()
  }

  #publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
