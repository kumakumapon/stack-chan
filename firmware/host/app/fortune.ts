/**
 * Daily fortune slip ("omikuji"). Pure state and storage format; the host
 * supplies randomness, the local day, timers and optional effects.
 */
export const FORTUNE_APP_ID = 'stackchan.fortune'
export const FORTUNE_RANKS = ['great', 'middle', 'small', 'good', 'future'] as const
export type FortuneRank = (typeof FORTUNE_RANKS)[number]
/** Relative draw weights. There is deliberately no unlucky slip. */
export const FORTUNE_WEIGHTS: Readonly<Record<FortuneRank, number>> = Object.freeze({
  great: 16,
  middle: 22,
  small: 22,
  good: 24,
  future: 16,
})
export const FORTUNE_ACTIONS = ['breathe', 'water', 'stretch', 'sky', 'thanks', 'tidy', 'praise', 'song'] as const
export type FortuneAction = (typeof FORTUNE_ACTIONS)[number]
export const FORTUNE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple', 'pink', 'white', 'orange'] as const
export type FortuneColor = (typeof FORTUNE_COLORS)[number]
export const FORTUNE_DOMAIN = 'sc_fortune'
export const FORTUNE_KEY = 'state'
export const FORTUNE_SHAKE_FRAMES = 8
export const FORTUNE_SHAKE_INTERVAL = 150

export type FortuneDraw = Readonly<{ rank: FortuneRank; action: FortuneAction; color: FortuneColor }>
export type FortuneRecord = Readonly<{ version: 1; day: number } & FortuneDraw>
export type FortunePhase = 'ready' | 'shaking' | 'revealed' | 'closed'
export type FortuneSnapshot = Readonly<{
  phase: FortunePhase
  draw: FortuneDraw | null
  /** Animation frame while shaking, 0 otherwise. */
  shake: number
  /** False while the clock is unsynced: slips are then neither saved nor limited to one a day. */
  dated: boolean
  /** True when the slip on screen was already drawn earlier today. */
  repeat: boolean
  canDraw: boolean
  saveFailed: boolean
}>
export type FortuneStorage = { get(): unknown; set(value: string): void }
export type FortuneOptions = {
  random(): number
  schedule(callback: () => void, delayMs: number): () => void
  /** Local calendar day number, or null when the clock is not synced. */
  today(): number | null
  storage?: FortuneStorage
  /** Optional effects; a returned function cancels them when the slip closes or is redrawn. */
  onReveal?(draw: FortuneDraw): (() => void) | undefined
}

const DAY_MS = 86400000

/** Days since 1970-01-01 in a fixed UTC offset. */
export function localDayNumber(epochMs: number, utcOffsetMinutes: number): number | null {
  if (!Number.isFinite(epochMs) || !Number.isFinite(utcOffsetMinutes)) return null
  return Math.floor((epochMs + utcOffsetMinutes * 60000) / DAY_MS)
}

function pick<T>(items: readonly T[], random: number): T {
  const index = Number.isFinite(random) ? Math.min(items.length - 1, Math.max(0, Math.floor(random * items.length))) : 0
  return items[index]
}

export function fortuneRankFor(random: number): FortuneRank {
  const total = FORTUNE_RANKS.reduce((sum, rank) => sum + FORTUNE_WEIGHTS[rank], 0)
  let remaining = (Number.isFinite(random) ? Math.max(0, Math.min(0.999999, random)) : 0) * total
  for (const rank of FORTUNE_RANKS) {
    remaining -= FORTUNE_WEIGHTS[rank]
    if (remaining < 0) return rank
  }
  return FORTUNE_RANKS[FORTUNE_RANKS.length - 1]
}

export function drawFortune(random: () => number): FortuneDraw {
  return {
    rank: fortuneRankFor(random()),
    action: pick(FORTUNE_ACTIONS, random()),
    color: pick(FORTUNE_COLORS, random()),
  }
}

export function parseFortuneRecord(raw: unknown): FortuneRecord | undefined {
  if (typeof raw !== 'string') return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (
    record.version !== 1 ||
    typeof record.day !== 'number' ||
    !Number.isSafeInteger(record.day) ||
    record.day < 0 ||
    !(FORTUNE_RANKS as readonly unknown[]).includes(record.rank) ||
    !(FORTUNE_ACTIONS as readonly unknown[]).includes(record.action) ||
    !(FORTUNE_COLORS as readonly unknown[]).includes(record.color)
  )
    return undefined
  return {
    version: 1,
    day: record.day,
    rank: record.rank as FortuneRank,
    action: record.action as FortuneAction,
    color: record.color as FortuneColor,
  }
}

export class FortuneTeller {
  readonly #options: FortuneOptions
  #phase: FortunePhase = 'ready'
  #draw: FortuneDraw | null = null
  #drawnDay: number | null = null
  #shake = 0
  #repeat = false
  #saveFailed = false
  #generation = 0
  #cancelTimer: (() => void) | undefined
  #cancelEffect: (() => void) | undefined
  #listeners = new Set<(snapshot: FortuneSnapshot) => void>()

  constructor(options: FortuneOptions) {
    this.#options = options
    const today = this.#today()
    if (today === null) return
    let raw: unknown
    try {
      raw = options.storage?.get()
    } catch {
      raw = undefined
    }
    const record = parseFortuneRecord(raw)
    if (record?.day === today) {
      this.#phase = 'revealed'
      this.#draw = { rank: record.rank, action: record.action, color: record.color }
      this.#drawnDay = today
      this.#repeat = true
    }
  }

  snapshot(): FortuneSnapshot {
    const today = this.#today()
    return {
      phase: this.#phase,
      draw: this.#draw,
      shake: this.#shake,
      dated: today !== null,
      repeat: this.#repeat,
      canDraw: this.#canDraw(today),
      saveFailed: this.#saveFailed,
    }
  }

  subscribe(listener: (snapshot: FortuneSnapshot) => void): () => void {
    if (this.#phase === 'closed') return () => undefined
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  draw(): void {
    if (!this.#canDraw(this.#today())) return
    this.#stopEffect()
    this.#draw = null
    this.#repeat = false
    this.#phase = 'shaking'
    this.#shake = 0
    this.#shakeFrame()
  }

  close(): void {
    if (this.#phase === 'closed') return
    this.#phase = 'closed'
    this.#generation++
    this.#cancelTimer?.()
    this.#cancelTimer = undefined
    this.#stopEffect()
    this.#listeners.clear()
  }

  #today(): number | null {
    try {
      const day = this.#options.today()
      return typeof day === 'number' && Number.isSafeInteger(day) && day >= 0 ? day : null
    } catch {
      return null
    }
  }

  #canDraw(today: number | null): boolean {
    if (this.#phase === 'ready') return true
    if (this.#phase !== 'revealed') return false
    // One slip per local day; an unsynced clock cannot tell days apart, so it never locks.
    return today === null || this.#drawnDay === null || today !== this.#drawnDay
  }

  #shakeFrame(): void {
    this.#shake++
    this.#publish()
    const generation = ++this.#generation
    this.#cancelTimer = this.#options.schedule(() => {
      if (this.#phase !== 'shaking' || generation !== this.#generation) return
      this.#cancelTimer = undefined
      if (this.#shake < FORTUNE_SHAKE_FRAMES) this.#shakeFrame()
      else this.#reveal()
    }, FORTUNE_SHAKE_INTERVAL)
  }

  #reveal(): void {
    const draw = drawFortune(this.#options.random)
    const day = this.#today()
    this.#phase = 'revealed'
    this.#shake = 0
    this.#draw = draw
    this.#drawnDay = day
    this.#saveFailed = false
    if (day !== null && this.#options.storage) {
      try {
        this.#options.storage.set(JSON.stringify({ version: 1, day, ...draw }))
      } catch {
        this.#saveFailed = true
      }
    }
    this.#publish()
    try {
      const cancel = this.#options.onReveal?.(draw)
      if (typeof cancel === 'function') this.#cancelEffect = cancel
    } catch {
      // Optional effects never change the slip.
    }
  }

  #stopEffect(): void {
    const cancel = this.#cancelEffect
    this.#cancelEffect = undefined
    try {
      cancel?.()
    } catch {
      // A failed cleanup of an optional effect must not block closing.
    }
  }

  #publish(): void {
    const snapshot = this.snapshot()
    for (const listener of this.#listeners) listener(snapshot)
  }
}
