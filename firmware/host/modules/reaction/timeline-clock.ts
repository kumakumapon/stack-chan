/**
 * Fires timeline entries at absolute times measured from a start instant.
 *
 * Every wait is computed from `start + entry.at - now()`, never from the
 * previous entry, so a Timer that fires late (a busy servo transaction, a
 * long TTS chunk) delays that one entry only: the rest of the timeline stays
 * on the beat. Entries the clock finds far enough behind that catching up
 * would look wrong are dropped through `skip` instead of being replayed in a
 * burst.
 */

import Timer from 'timer'

export type TimelineEntry = {
  /** Milliseconds from the timeline's start. Entries must be sorted ascending. */
  at: number
}

export type TimelineClockCallbacks = {
  /** The entry is due (or overdue by `lateMs`, within the catch-up window). */
  fire(index: number, lateMs: number): void
  /** The entry is overdue beyond the catch-up window and will not fire. */
  skip(index: number, lateMs: number): void
  /** Every entry has been handled and the timeline's duration has elapsed. */
  done(): void
}

export type TimelineClockOptions = {
  /** Monotonic milliseconds, e.g. `() => Time.ticks`. */
  now(): number
  /** Overdue entries later than this are skipped rather than fired. Default 1000. */
  maxCatchUpMs?: number
}

export class TimelineClock {
  readonly #now: () => number
  readonly #maxCatchUpMs: number
  #timer: ReturnType<typeof Timer.set> | undefined
  #entries: readonly TimelineEntry[] = []
  #durationMs = 0
  #callbacks: TimelineClockCallbacks | undefined
  #startedAt: number | null = null
  #next = 0
  /** Bumped on every start/stop so a callback that restarts the clock ends the stale tick loop. */
  #generation = 0

  constructor(options: TimelineClockOptions) {
    this.#now = options.now
    this.#maxCatchUpMs = options.maxCatchUpMs ?? 1000
  }

  get running(): boolean {
    return this.#startedAt !== null
  }

  get startedAt(): number | null {
    return this.#startedAt
  }

  /** Index of the next entry to fire; equals the entry count once all have fired. */
  get nextIndex(): number {
    return this.#next
  }

  /** Milliseconds since start, or 0 while stopped. */
  elapsed(): number {
    return this.#startedAt === null ? 0 : this.#now() - this.#startedAt
  }

  /**
   * Starts the timeline. Entries at 0 fire synchronously before this returns
   * so the first frame lands with the call that asked for it.
   */
  start(entries: readonly TimelineEntry[], durationMs: number, callbacks: TimelineClockCallbacks): void {
    this.stop()
    this.#entries = entries
    this.#durationMs = durationMs
    this.#callbacks = callbacks
    this.#startedAt = this.#now()
    this.#next = 0
    this.#tick(this.#generation)
  }

  stop(): void {
    this.#generation += 1
    if (this.#timer !== undefined) {
      Timer.clear(this.#timer)
      this.#timer = undefined
    }
    this.#startedAt = null
    this.#callbacks = undefined
  }

  #arm(generation: number): void {
    if (this.#startedAt === null) return
    const target = this.#next < this.#entries.length ? this.#entries[this.#next].at : this.#durationMs
    const delay = Math.max(0, this.#startedAt + target - this.#now())
    this.#timer = Timer.set(() => {
      this.#timer = undefined
      this.#tick(generation)
    }, delay)
  }

  #tick(generation: number): void {
    const callbacks = this.#callbacks
    if (callbacks === undefined || this.#startedAt === null) return
    const elapsed = this.#now() - this.#startedAt
    while (this.#next < this.#entries.length && this.#entries[this.#next].at <= elapsed) {
      const index = this.#next
      const lateMs = elapsed - this.#entries[index].at
      this.#next = index + 1
      if (lateMs > this.#maxCatchUpMs) callbacks.skip(index, lateMs)
      else callbacks.fire(index, lateMs)
      // A callback may have stopped or restarted the clock; this loop belongs to the old run then.
      if (generation !== this.#generation) return
    }
    if (this.#next >= this.#entries.length && elapsed >= this.#durationMs) {
      this.stop()
      callbacks.done()
      return
    }
    this.#arm(generation)
  }
}
