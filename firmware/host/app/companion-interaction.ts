import type { TouchPanelGestureType, TouchPanelTap } from '../modules/input/touch-panel-gesture.js'
import type {
  OwnedReactionPlayResult,
  ReactionName,
  ReactionOptions,
  ReactionStatus,
} from '../modules/reaction/reaction-types.js'

type Pending = 'hold' | 'taps' | 'stroke' | 'watch'
type Variant = 'tap' | 'double' | 'hold'
type InteractionDependencies = {
  now(): number
  available(): boolean
  intensity(): number
  timer: { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void }
  reaction: {
    status(): ReactionStatus
    playOwned?(name: ReactionName, options?: ReactionOptions): OwnedReactionPlayResult
  }
  trace(message: string): void
}

/** Additional touch play. Legacy reciprocal petting keeps its own five-second routine. */
export class CompanionInteraction {
  #deps: InteractionDependencies
  #timers: Partial<Record<Pending, unknown>> = {}
  #owner: { cancel(): boolean } | undefined
  #closed = false
  #pressed = false
  #swiped = false
  #held = false
  #taps = 0
  #stroke: { direction: string; at: number } | undefined
  #nextAction = -Infinity
  #blockedUntil = -Infinity
  #lastEvent = { ticks: -Infinity, gesture: '' }
  #variants = { tap: 0, double: 0, hold: 0 }

  constructor(deps: InteractionDependencies) {
    this.#deps = deps
  }

  touch(event: { gesture: TouchPanelGestureType; ticks: number; tap?: TouchPanelTap }): void {
    if (!Number.isFinite(event.ticks) || event.ticks < this.#lastEvent.ticks) return
    if (event.ticks === this.#lastEvent.ticks && event.gesture === this.#lastEvent.gesture) return
    this.#lastEvent = { ticks: event.ticks, gesture: event.gesture }
    if (!this.#available()) {
      this.cancel()
      return
    }
    if (this.#deps.now() < this.#blockedUntil) return
    if (this.#deps.reaction.status().active && (event.gesture === 'press' || !this.#owner)) {
      // Decide at the input edge: a manual reaction ending before our tap/hold
      // delay must not turn a previously ignored gesture into a queued action.
      const owned = this.#owner?.cancel() === true
      this.cancel()
      if (!owned) return
    }
    if (event.gesture === 'press') {
      this.#pressed = true
      this.#swiped = false
      this.#held = false
      this.#schedule('hold', 900, () => {
        if (!this.#pressed || this.#swiped) return
        this.#clear('taps')
        this.#taps = 0
        this.#held = this.#alternate('hold', ['head-cuddle', 'bashful'])
      })
    } else if (event.gesture === 'release') {
      const pressed = this.#pressed
      this.#pressed = false
      this.#clear('hold')
      if (!pressed || this.#swiped || this.#held || !event.tap) return
      this.#taps = Math.min(3, this.#taps + 1)
      this.#schedule('taps', 350, () => {
        const taps = this.#taps
        this.#taps = 0
        if (taps > 1) this.#alternate('double', ['tickled', 'happy-sparkle'])
        else this.#alternate('tap', ['head-hello', 'nose-boop'])
      })
    } else {
      this.#swiped = true
      this.#clear('hold')
      this.#clear('taps')
      this.#taps = 0
      const now = this.#deps.now()
      if (this.#stroke && this.#stroke.direction !== event.gesture && now - this.#stroke.at <= 1500) {
        // The existing petting subscriber takes over on this same event.
        this.reserveLegacy()
        return
      }
      this.#stroke = { direction: event.gesture, at: now }
      this.#schedule('stroke', 1600, () => {
        this.#stroke = undefined
        this.#play(event.gesture === 'forwardSwipe' ? 'look-touch-right' : 'look-touch-left')
      })
    }
  }

  faceTap(): boolean {
    return this.#alternate('tap', ['head-hello', 'nose-boop'])
  }

  /** Reserve face/head ownership for the existing petting or IMU response. */
  reserveLegacy(): boolean {
    const available = this.#available()
    if (this.#deps.reaction.status().active && !this.#owner?.cancel()) return false
    this.cancel()
    if (!available) return false
    this.#blockedUntil = this.#deps.now() + 5000
    return true
  }

  cancel(): void {
    for (const key of ['hold', 'taps', 'stroke', 'watch'] as const) this.#clear(key)
    this.#owner?.cancel()
    this.#owner = undefined
    this.#pressed = false
    this.#swiped = false
    this.#held = false
    this.#taps = 0
    this.#stroke = undefined
  }

  close(): void {
    this.cancel()
    this.#closed = true
  }

  #available(): boolean {
    return !this.#closed && this.#deps.available()
  }

  #alternate(key: Variant, names: readonly ReactionName[]): boolean {
    const index = this.#variants[key]
    if (!this.#play(names[index % names.length])) return false
    this.#variants[key]++
    return true
  }

  #play(name: ReactionName): boolean {
    const now = this.#deps.now()
    if (!this.#available() || now < this.#blockedUntil || now < this.#nextAction) return false
    if (this.#deps.reaction.status().active && !this.#owner?.cancel()) return false
    this.#owner = undefined
    const result = this.#deps.reaction.playOwned?.(name, { intensity: this.#deps.intensity() })
    if (!result?.ok) return false
    this.#owner = result
    this.#nextAction = now + 900
    this.#deps.trace(`[interaction] ${name}\n`)
    this.#watch()
    return true
  }

  #watch(): void {
    this.#schedule('watch', 100, () => {
      if (!this.#available()) this.cancel()
      else if (!this.#deps.reaction.status().active) this.#owner = undefined
      else this.#watch()
    })
  }

  #schedule(key: Pending, delay: number, callback: () => void): void {
    this.#clear(key)
    this.#timers[key] = this.#deps.timer.set(() => {
      delete this.#timers[key]
      if (!this.#closed) callback()
    }, delay)
  }

  #clear(key: Pending): void {
    if (!(key in this.#timers)) return
    this.#deps.timer.clear(this.#timers[key])
    delete this.#timers[key]
  }
}
