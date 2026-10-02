import { FocusTimerModel, type FocusTimerPreset, type FocusTimerSnapshot } from 'focus-timer-model'

export const FOCUS_TIMER_DOMAIN = 'stackchan_focus'
export const FOCUS_TIMER_KEY = 'state'
export type FocusTimerViewState = FocusTimerSnapshot & Readonly<{ storageFailed: boolean }>
export type FocusTimerServiceOptions = {
  now(): number
  /** Return a cancellation handle. Only one one-shot callback is armed at a time. */
  schedule(callback: () => void, delayMs: number): () => void
  storage: { get(): unknown; set(value: string): void }
  suppressIdle(): () => void
  /** WASM only: consume the earliest queued hidden instant, in the same clock domain. */
  takeHiddenAt?(): number | undefined
}

export class FocusTimerService {
  #model: FocusTimerModel
  #options: FocusTimerServiceOptions
  #listeners = new Set<(snapshot: FocusTimerViewState) => void>()
  #cancelTimer: (() => void) | undefined
  #releaseIdle: (() => void) | undefined
  #storageFailed = false
  #closed = false

  constructor(options: FocusTimerServiceOptions) {
    this.#options = options
    let saved: unknown
    try {
      saved = options.storage.get()
    } catch {
      this.#storageFailed = true
    }
    this.#model = new FocusTimerModel(options.now, saved)
    if (this.#model.snapshot().state === 'interrupted') this.#save()
  }

  getSnapshot(): FocusTimerViewState {
    this.#update(() => this.#model.elapsed())
    return this.#snapshot()
  }

  select(preset: FocusTimerPreset): void {
    this.#update(() => this.#model.select(preset))
  }

  start(preset?: FocusTimerPreset): void {
    this.#update(() => this.#model.start(preset))
  }

  pause(): void {
    this.#update(() => this.#model.pause())
  }

  resume(): void {
    this.#update(() => this.#model.resume())
  }

  cancel(): void {
    this.#update(() => this.#model.cancel())
  }

  acknowledge(): void {
    this.#update(() => this.#model.acknowledge())
  }

  subscribe(listener: (snapshot: FocusTimerViewState) => void): () => void {
    const snapshot = this.getSnapshot()
    if (this.#closed) return () => undefined
    this.#listeners.add(listener)
    listener(snapshot)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#releaseIdle?.()
    this.#releaseIdle = undefined
    if (this.#model.snapshot().state === 'running' || this.#model.snapshot().state === 'paused') {
      this.#model.interrupt('reboot')
      this.#save()
    }
    this.#listeners.clear()
  }

  #snapshot(): FocusTimerViewState {
    return Object.freeze({ ...this.#model.snapshot(), storageFailed: this.#storageFailed })
  }

  #update(action: () => unknown): void {
    if (this.#closed) return
    const before = this.#snapshot()
    const hiddenAt = this.#options.takeHiddenAt?.()
    if (hiddenAt !== undefined) this.#model.pause('hidden', hiddenAt)
    action()
    const after = this.#snapshot()
    if (before.generation !== after.generation) {
      this.#cancelTimer?.()
      this.#cancelTimer = undefined
      if (after.state === 'running') this.#releaseIdle ??= this.#options.suppressIdle()
      else {
        this.#releaseIdle?.()
        this.#releaseIdle = undefined
      }
      this.#save()
    }
    const snapshot = this.#snapshot()
    if (
      before.generation !== snapshot.generation ||
      before.storageFailed !== snapshot.storageFailed ||
      Math.ceil((before.remainingMs ?? 0) / 1000) !== Math.ceil((snapshot.remainingMs ?? 0) / 1000)
    ) {
      for (const listener of this.#listeners) listener(snapshot)
    }
    // A subscriber may close, cancel or restart; arm the current generation only.
    if (!this.#closed && !this.#cancelTimer && this.#model.snapshot().state === 'running') {
      const current = this.#model.snapshot()
      this.#cancelTimer = this.#options.schedule(
        () => {
          if (this.#closed || this.#model.snapshot().generation !== current.generation) return
          this.#cancelTimer = undefined
          this.#update(() => this.#model.elapsed(current.generation))
        },
        Math.min(1000, current.remainingMs ?? 0),
      )
    }
  }

  #save(): void {
    try {
      this.#options.storage.set(this.#model.serialize())
      this.#storageFailed = false
    } catch {
      this.#storageFailed = true
    }
  }
}
