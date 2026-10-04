/** Offline sequence game. Scheduling and body effects are injected; no device imports. */
export const MEMORY_GAME_MAX_ROUNDS = 12
export const MEMORY_GAME_SYMBOLS = ['yes', 'no', 'greeting'] as const
export type MemoryGameSymbol = (typeof MEMORY_GAME_SYMBOLS)[number]
export type MemoryGamePhase =
  | 'ready'
  | 'showing'
  | 'gap'
  | 'input'
  | 'feedback'
  | 'won'
  | 'lost'
  | 'complete'
  | 'closed'
export type MemoryGameSnapshot = Readonly<{
  phase: MemoryGamePhase
  symbol: MemoryGameSymbol | null
  round: number
  matched: number
  score: number
  motion: boolean
}>
export type MemoryGameOptions = {
  random(): number
  schedule(callback: () => void, delayMs: number): () => void
  /** An owner-scoped cancel handle: it must never stop another caller's reaction. */
  react?(name: MemoryGameSymbol | 'success' | 'failure'): (() => void) | undefined
  onResult?(score: number): void
}

/** Native WASM one-shot handles must also be cleared after firing. */
export function createMemoryGameScheduler<Handle>(timer: {
  set(callback: (handle: Handle) => void, delayMs: number): Handle
  clear(handle: Handle): void
}): MemoryGameOptions['schedule'] {
  return (callback, delayMs) => {
    let active = true
    const handle = timer.set((expired) => {
      if (!active) return
      active = false
      timer.clear(expired)
      callback()
    }, delayMs)
    return () => {
      if (!active) return
      active = false
      timer.clear(handle)
    }
  }
}

export class MemoryGame {
  readonly #options: MemoryGameOptions
  #phase: MemoryGamePhase = 'ready'
  #sequence: MemoryGameSymbol[] = []
  #symbol: MemoryGameSymbol | null = null
  #matched = 0
  #score = 0
  #motion = false
  #generation = 0
  #cancelTimer: (() => void) | undefined
  #cancelReaction: (() => void) | undefined
  #listeners = new Set<(snapshot: MemoryGameSnapshot) => void>()

  constructor(options: MemoryGameOptions) {
    this.#options = options
  }

  snapshot(): MemoryGameSnapshot {
    return {
      phase: this.#phase,
      symbol: this.#symbol,
      round: this.#sequence.length,
      matched: this.#matched,
      score: this.#score,
      motion: this.#motion,
    }
  }

  subscribe(listener: (snapshot: MemoryGameSnapshot) => void): () => void {
    if (this.#phase === 'closed') return () => undefined
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  start(): void {
    if (this.#phase !== 'ready' && this.#phase !== 'lost' && this.#phase !== 'complete') return
    this.#stopPending()
    this.#sequence = []
    this.#score = 0
    this.#appendRound()
  }

  next(): void {
    if (this.#phase !== 'won') return
    this.#stopPending()
    this.#appendRound()
  }

  answer(symbol: MemoryGameSymbol): void {
    if (this.#phase !== 'input' || !MEMORY_GAME_SYMBOLS.includes(symbol)) return
    if (this.#sequence[this.#matched] !== symbol) {
      this.#symbol = this.#sequence[this.#matched]
      this.#phase = 'lost'
      this.#react('failure')
      this.#publish()
      this.#options.onResult?.(this.#score)
      return
    }
    this.#matched++
    this.#symbol = symbol
    // Lock input briefly, including the final answer, so one rapid burst cannot
    // answer repeated symbols or start the next round.
    this.#phase = 'feedback'
    this.#publish()
    this.#wait(220, () => {
      this.#symbol = null
      if (this.#matched === this.#sequence.length) {
        this.#score = this.#sequence.length
        this.#phase = this.#score === MEMORY_GAME_MAX_ROUNDS ? 'complete' : 'won'
        this.#react('success')
        this.#publish()
        if (this.#phase === 'complete') this.#options.onResult?.(this.#score)
      } else {
        this.#phase = 'input'
        this.#publish()
      }
    })
  }

  setMotion(enabled: boolean): void {
    if (this.#phase === 'closed') return
    this.#motion = enabled
    if (!enabled) this.#stopReaction()
    this.#publish()
  }

  close(): void {
    if (this.#phase === 'closed') return
    this.#phase = 'closed'
    this.#stopPending()
    this.#sequence = []
    this.#symbol = null
    this.#listeners.clear()
  }

  #appendRound(): void {
    const random = this.#options.random()
    const index = Number.isFinite(random) ? Math.min(2, Math.max(0, Math.floor(random * 3))) : 0
    this.#sequence.push(MEMORY_GAME_SYMBOLS[index])
    this.#matched = 0
    this.#symbol = null
    this.#phase = 'gap'
    this.#publish()
    this.#wait(500, () => this.#show(0))
  }

  #show(index: number): void {
    this.#phase = 'showing'
    this.#symbol = this.#sequence[index]
    this.#react(this.#symbol)
    this.#publish()
    // All three named reactions finish within this display interval.
    this.#wait(1600, () => {
      this.#stopReaction()
      this.#symbol = null
      this.#phase = 'gap'
      this.#publish()
      this.#wait(350, () => {
        if (index + 1 < this.#sequence.length) this.#show(index + 1)
        else {
          this.#phase = 'input'
          this.#publish()
        }
      })
    })
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

  #react(name: MemoryGameSymbol | 'success' | 'failure'): void {
    this.#stopReaction()
    if (this.#motion) this.#cancelReaction = this.#options.react?.(name)
  }

  #stopReaction(): void {
    const cancel = this.#cancelReaction
    this.#cancelReaction = undefined
    cancel?.()
  }

  #stopPending(): void {
    this.#generation++
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#stopReaction()
  }

  #publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
