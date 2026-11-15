/**
 * Offline rock-paper-scissors followed by "look over there" (acchi muite hoi).
 * Timing, randomness and optional body effects are injected; no device imports.
 */
export const JANKEN_APP_ID = 'stackchan.janken'
export const JANKEN_HANDS = ['rock', 'scissors', 'paper'] as const
export type JankenHand = (typeof JANKEN_HANDS)[number]
/** Screen-relative: 'right' is the viewer's right, which is Stack-chan's left. */
export const HOI_DIRECTIONS = ['up', 'down', 'left', 'right'] as const
export type HoiDirection = (typeof HOI_DIRECTIONS)[number]
/** First to two keeps a match around a minute: a hoi scores only one time in four. */
export const JANKEN_TARGET_POINTS = 2
export const JANKEN_TIMING = Object.freeze({
  call: 700,
  draw: 900,
  reveal: 1100,
  hoiCall: 700,
  hoiInput: 3000,
  hoiReveal: 1400,
})
export type JankenPhase =
  | 'ready'
  | 'call'
  | 'choose'
  | 'reveal'
  | 'hoi-call'
  | 'hoi'
  | 'hoi-reveal'
  | 'won'
  | 'lost'
  | 'closed'
export type JankenOutcome = 'win' | 'lose' | 'draw'
export type JankenSide = 'player' | 'robot'
export type JankenMotionBlockReason = 'conversation' | 'busy'
export type JankenReaction = 'look-up' | 'look-down' | 'look-touch-left' | 'look-touch-right' | 'success' | 'proud'

/**
 * Head reaction that turns toward a screen-relative direction. Positive yaw
 * turns toward Stack-chan's left (the viewer's right) and negative pitch looks
 * up, matching `lookAt` and the shipped catalog.
 */
export const HOI_REACTIONS: Readonly<Record<HoiDirection, JankenReaction>> = Object.freeze({
  up: 'look-up',
  down: 'look-down',
  left: 'look-touch-left',
  right: 'look-touch-right',
})

export type JankenSnapshot = Readonly<{
  phase: JankenPhase
  playerHand: JankenHand | null
  robotHand: JankenHand | null
  outcome: JankenOutcome | null
  /** Consecutive draws ("aiko") in the current throw. */
  draws: number
  attacker: JankenSide | null
  playerDirection: HoiDirection | null
  robotDirection: HoiDirection | null
  /** True when the pointing side caught the other side looking the same way. */
  hit: boolean | null
  timedOut: boolean
  playerPoints: number
  robotPoints: number
  motion: boolean
  motionBlockReason: JankenMotionBlockReason | null
}>

export type JankenGameOptions = {
  random(): number
  schedule(callback: () => void, delayMs: number): () => void
  /** Owner-scoped cancel handle; it must never stop another caller's reaction. */
  react?(name: JankenReaction): (() => void) | undefined
  motionBlockReason?(): JankenMotionBlockReason | null
  onResult?(score: number): void
}

export function isJankenHand(value: unknown): value is JankenHand {
  return (JANKEN_HANDS as readonly unknown[]).includes(value)
}

export function isHoiDirection(value: unknown): value is HoiDirection {
  return (HOI_DIRECTIONS as readonly unknown[]).includes(value)
}

export function jankenOutcome(player: JankenHand, robot: JankenHand): JankenOutcome {
  if (player === robot) return 'draw'
  const beats: Readonly<Record<JankenHand, JankenHand>> = { rock: 'scissors', scissors: 'paper', paper: 'rock' }
  return beats[player] === robot ? 'win' : 'lose'
}

export function pickFrom<T>(items: readonly T[], random: number): T {
  const index = Number.isFinite(random) ? Math.min(items.length - 1, Math.max(0, Math.floor(random * items.length))) : 0
  return items[index]
}

export class JankenGame {
  readonly #options: JankenGameOptions
  // Snapshot keys already exist in XS. Grouping their data avoids a distinct
  // private key for every field while keeping the mutable state private.
  #state: { -readonly [Key in keyof JankenSnapshot]: JankenSnapshot[Key] } = {
    phase: 'ready',
    playerHand: null,
    robotHand: null,
    outcome: null,
    draws: 0,
    attacker: null,
    playerDirection: null,
    robotDirection: null,
    hit: null,
    timedOut: false,
    playerPoints: 0,
    robotPoints: 0,
    motion: false,
    motionBlockReason: null,
  }
  #generation = 0
  #cancelTimer: (() => void) | undefined
  #cancelReaction: (() => void) | undefined
  #listeners = new Set<(snapshot: JankenSnapshot) => void>()

  constructor(options: JankenGameOptions) {
    this.#options = options
  }

  snapshot(): JankenSnapshot {
    return {
      phase: this.#state.phase,
      playerHand: this.#state.playerHand,
      robotHand: this.#state.robotHand,
      outcome: this.#state.outcome,
      draws: this.#state.draws,
      attacker: this.#state.attacker,
      playerDirection: this.#state.playerDirection,
      robotDirection: this.#state.robotDirection,
      hit: this.#state.hit,
      timedOut: this.#state.timedOut,
      playerPoints: this.#state.playerPoints,
      robotPoints: this.#state.robotPoints,
      motion: this.#state.motion,
      motionBlockReason: this.#state.motionBlockReason,
    }
  }

  subscribe(listener: (snapshot: JankenSnapshot) => void): () => void {
    if (this.#state.phase === 'closed') return () => undefined
    this.#listeners.add(listener)
    listener(this.snapshot())
    return () => this.#listeners.delete(listener)
  }

  /** Starts a new match. Only an explicit call starts one; a finished match stays on its result. */
  start(): void {
    if (this.#state.phase !== 'ready' && this.#state.phase !== 'won' && this.#state.phase !== 'lost') return
    this.#stopPending()
    this.#state.playerPoints = 0
    this.#state.robotPoints = 0
    this.#call()
  }

  /** The robot's hand is drawn only after the player's choice is final, independent of it. */
  choose(hand: JankenHand): void {
    if (this.#state.phase !== 'choose' || !isJankenHand(hand)) return
    const robot = pickFrom(JANKEN_HANDS, this.#options.random())
    this.#state.playerHand = hand
    this.#state.robotHand = robot
    this.#state.outcome = jankenOutcome(hand, robot)
    this.#state.phase = 'reveal'
    if (this.#state.outcome === 'draw') {
      this.#state.draws++
      this.#publish()
      this.#wait(JANKEN_TIMING.draw, () => {
        this.#state.playerHand = null
        this.#state.robotHand = null
        this.#state.outcome = null
        this.#state.phase = 'choose'
        this.#publish()
      })
      return
    }
    this.#state.attacker = this.#state.outcome === 'win' ? 'player' : 'robot'
    this.#publish()
    this.#wait(JANKEN_TIMING.reveal, () => {
      this.#state.phase = 'hoi-call'
      this.#publish()
      this.#wait(JANKEN_TIMING.hoiCall, () => {
        this.#state.phase = 'hoi'
        this.#publish()
        this.#wait(JANKEN_TIMING.hoiInput, () => this.#resolveHoi(null))
      })
    })
  }

  /** The player's pointing (attacking) or facing (defending) direction for this "hoi". */
  look(direction: HoiDirection): void {
    if (this.#state.phase !== 'hoi' || !isHoiDirection(direction)) return
    this.#resolveHoi(direction)
  }

  setMotion(enabled: boolean): void {
    if (this.#state.phase === 'closed') return
    this.#state.motion = enabled
    if (!enabled) this.#stopReaction()
    this.#state.motionBlockReason = enabled ? (this.#options.motionBlockReason?.() ?? null) : null
    this.#publish()
  }

  close(): void {
    if (this.#state.phase === 'closed') return
    this.#state.phase = 'closed'
    this.#stopPending()
    this.#listeners.clear()
  }

  #call(): void {
    this.#state.playerHand = null
    this.#state.robotHand = null
    this.#state.outcome = null
    this.#state.draws = 0
    this.#state.attacker = null
    this.#state.playerDirection = null
    this.#state.robotDirection = null
    this.#state.hit = null
    this.#state.timedOut = false
    this.#state.phase = 'call'
    this.#publish()
    this.#wait(JANKEN_TIMING.call, () => {
      this.#state.phase = 'choose'
      this.#publish()
    })
  }

  #resolveHoi(direction: HoiDirection | null): void {
    const robot = pickFrom(HOI_DIRECTIONS, this.#options.random())
    this.#state.playerDirection = direction
    this.#state.robotDirection = robot
    this.#state.timedOut = direction === null
    this.#state.hit = direction !== null && direction === robot
    if (this.#state.hit) {
      if (this.#state.attacker === 'player') this.#state.playerPoints++
      else this.#state.robotPoints++
    }
    this.#state.phase = 'hoi-reveal'
    this.#react(HOI_REACTIONS[robot])
    this.#publish()
    this.#wait(JANKEN_TIMING.hoiReveal, () => {
      if (this.#state.playerPoints >= JANKEN_TARGET_POINTS) this.#finish('won')
      else if (this.#state.robotPoints >= JANKEN_TARGET_POINTS) this.#finish('lost')
      else this.#call()
    })
  }

  #finish(phase: 'won' | 'lost'): void {
    this.#state.phase = phase
    this.#react(phase === 'won' ? 'success' : 'proud')
    this.#publish()
    this.#options.onResult?.(this.#state.playerPoints)
  }

  #wait(delayMs: number, callback: () => void): void {
    if (this.#state.phase === 'closed') return
    const generation = ++this.#generation
    this.#cancelTimer?.()
    this.#cancelTimer = this.#options.schedule(() => {
      if (this.#state.phase === 'closed' || generation !== this.#generation) return
      this.#cancelTimer = undefined
      callback()
    }, delayMs)
  }

  #react(name: JankenReaction): void {
    this.#stopReaction()
    this.#state.motionBlockReason = this.#state.motion ? (this.#options.motionBlockReason?.() ?? null) : null
    if (!this.#state.motion || this.#state.motionBlockReason) return
    try {
      this.#cancelReaction = this.#options.react?.(name)
    } catch {
      this.#cancelReaction = undefined
    }
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
