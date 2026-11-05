import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  HOI_DIRECTIONS,
  HOI_REACTIONS,
  JANKEN_HANDS,
  JANKEN_TARGET_POINTS,
  JANKEN_TIMING,
  JankenGame,
  type JankenGameOptions,
  type JankenHand,
  jankenOutcome,
  pickFrom,
} from './janken-game.js'

function harness(options: Partial<JankenGameOptions> = {}) {
  let now = 0
  const randoms: number[] = []
  const timers: { at: number; active: boolean; fire(): void }[] = []
  const reactions: { name: string; active: boolean }[] = []
  const results: number[] = []
  let blocked: 'conversation' | 'busy' | null = null
  const game = new JankenGame({
    random: () => randoms.shift() ?? 0,
    schedule(fire, delay) {
      const timer = { at: now + delay, active: true, fire }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    react(name) {
      const reaction = { name, active: true }
      reactions.push(reaction)
      return () => {
        reaction.active = false
      }
    },
    motionBlockReason: () => blocked,
    onResult: (score) => results.push(score),
    ...options,
  })
  const advance = (ms: number) => {
    const target = now + ms
    while (true) {
      const timer = timers.filter((entry) => entry.active && entry.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!timer) break
      now = timer.at
      timer.active = false
      timer.fire()
    }
    now = target
  }
  /** Random value that makes `pickFrom` select `item`. */
  const pick = <T>(items: readonly T[], item: T) => (items.indexOf(item) + 0.5) / items.length
  const toChoose = () => {
    advance(JANKEN_TIMING.call)
    assert.equal(game.snapshot().phase, 'choose')
  }
  const toHoi = () => {
    advance(JANKEN_TIMING.reveal + JANKEN_TIMING.hoiCall)
    assert.equal(game.snapshot().phase, 'hoi')
  }
  return {
    game,
    randoms,
    reactions,
    results,
    timers,
    advance,
    pick,
    toChoose,
    toHoi,
    block(reason: 'conversation' | 'busy' | null) {
      blocked = reason
    },
  }
}

test('jankenOutcome is a cyclic relation where every hand beats exactly one other', () => {
  for (const player of JANKEN_HANDS) {
    const outcomes = JANKEN_HANDS.map((robot) => jankenOutcome(player, robot))
    assert.deepEqual(outcomes.filter((outcome) => outcome === 'draw').length, 1)
    assert.deepEqual(outcomes.filter((outcome) => outcome === 'win').length, 1)
    for (const robot of JANKEN_HANDS) {
      const forward = jankenOutcome(player, robot)
      const reverse = jankenOutcome(robot, player)
      assert.equal(forward === 'draw', reverse === 'draw')
      if (forward === 'win') assert.equal(reverse, 'lose')
    }
  }
  assert.equal(jankenOutcome('rock', 'scissors'), 'win')
  assert.equal(jankenOutcome('paper', 'scissors'), 'lose')
})

test('pickFrom stays in range for boundary and invalid random values', () => {
  for (const value of [0, 0.999999, 1, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.ok(HOI_DIRECTIONS.includes(pickFrom(HOI_DIRECTIONS, value)))
  assert.equal(pickFrom(JANKEN_HANDS, 0.5), JANKEN_HANDS[1])
})

test('every hoi direction maps to a distinct head reaction', () => {
  assert.equal(new Set(HOI_DIRECTIONS.map((direction) => HOI_REACTIONS[direction])).size, HOI_DIRECTIONS.length)
})

test('choices are ignored until the call finishes, and the robot draws its hand after the choice', () => {
  const { game, randoms, pick, advance } = harness()
  game.choose('rock')
  assert.equal(game.snapshot().phase, 'ready', 'no choice before start')
  game.start()
  assert.equal(game.snapshot().phase, 'call')
  game.choose('rock')
  assert.equal(game.snapshot().playerHand, null, 'no choice during the call')
  advance(JANKEN_TIMING.call)
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  const state = game.snapshot()
  assert.equal(state.phase, 'reveal')
  assert.equal(state.robotHand, 'scissors')
  assert.equal(state.outcome, 'win')
  assert.equal(state.attacker, 'player')
  game.choose('paper')
  assert.equal(game.snapshot().playerHand, 'rock', 'a second tap cannot change a revealed hand')
})

test('a draw counts "aiko" and returns to choosing without a call or a hoi', () => {
  const { game, randoms, pick, advance, toChoose } = harness()
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'paper'))
  game.choose('paper')
  assert.equal(game.snapshot().outcome, 'draw')
  assert.equal(game.snapshot().attacker, null)
  advance(JANKEN_TIMING.draw)
  const state = game.snapshot()
  assert.equal(state.phase, 'choose')
  assert.equal(state.draws, 1)
  assert.equal(state.playerHand, null)
  randoms.push(pick(JANKEN_HANDS, 'rock'))
  game.choose('scissors')
  assert.equal(game.snapshot().attacker, 'robot')
  assert.equal(game.snapshot().draws, 1)
})

test('the pointing side scores only when the directions match; a miss starts the next throw', () => {
  const { game, randoms, pick, advance, toChoose, toHoi } = harness()
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'left'))
  game.look('right')
  let state = game.snapshot()
  assert.equal(state.phase, 'hoi-reveal')
  assert.equal(state.hit, false)
  assert.equal(state.robotDirection, 'left')
  assert.equal(state.playerPoints + state.robotPoints, 0)
  game.look('left')
  assert.equal(game.snapshot().playerDirection, 'right', 'one answer per hoi')
  advance(JANKEN_TIMING.hoiReveal)
  assert.equal(game.snapshot().phase, 'call')
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'up'))
  game.look('up')
  state = game.snapshot()
  assert.equal(state.hit, true)
  assert.equal(state.playerPoints, 1, 'the attacking player scores')
  assert.equal(state.robotPoints, 0)
})

test('the robot scores when it attacks and the player looks the same way', () => {
  const { game, randoms, pick, toChoose, toHoi } = harness()
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'paper'))
  game.choose('rock')
  assert.equal(game.snapshot().attacker, 'robot')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'down'))
  game.look('down')
  assert.equal(game.snapshot().robotPoints, 1)
  assert.equal(game.snapshot().playerPoints, 0)
})

test('an unanswered hoi times out without a point', () => {
  const { game, randoms, pick, advance, toChoose, toHoi } = harness()
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'paper'))
  game.choose('rock')
  toHoi()
  advance(JANKEN_TIMING.hoiInput - 1)
  assert.equal(game.snapshot().phase, 'hoi')
  advance(1)
  const state = game.snapshot()
  assert.equal(state.phase, 'hoi-reveal')
  assert.equal(state.timedOut, true)
  assert.equal(state.hit, false)
  assert.equal(state.robotPoints, 0)
})

function playPoint(h: ReturnType<typeof harness>, player: 'player' | 'robot'): void {
  const { game, randoms, pick, advance, toChoose, toHoi } = h
  toChoose()
  const robotHand: JankenHand = player === 'player' ? 'scissors' : 'paper'
  randoms.push(pick(JANKEN_HANDS, robotHand))
  game.choose('rock')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'right'))
  game.look('right')
  advance(JANKEN_TIMING.hoiReveal)
}

test('the first side to the target wins once, reports once and waits for an explicit restart', () => {
  const h = harness()
  const { game, results, advance } = h
  game.start()
  playPoint(h, 'robot')
  for (let point = 0; point < JANKEN_TARGET_POINTS; point++) playPoint(h, 'player')
  let state = game.snapshot()
  assert.equal(state.phase, 'won')
  assert.equal(state.playerPoints, JANKEN_TARGET_POINTS)
  assert.equal(state.robotPoints, 1)
  assert.deepEqual(results, [JANKEN_TARGET_POINTS])
  advance(60000)
  assert.equal(game.snapshot().phase, 'won', 'no automatic rematch')
  assert.deepEqual(results, [JANKEN_TARGET_POINTS])
  game.start()
  state = game.snapshot()
  assert.equal(state.phase, 'call')
  assert.equal(state.playerPoints + state.robotPoints, 0)
  for (let point = 0; point < JANKEN_TARGET_POINTS; point++) playPoint(h, 'robot')
  assert.equal(game.snapshot().phase, 'lost')
  assert.deepEqual(results, [JANKEN_TARGET_POINTS, 0])
})

test('motion is opt-in, owner-scoped and skipped while the host is busy', () => {
  const h = harness()
  const { game, randoms, pick, reactions, toChoose, toHoi, block } = h
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'up'))
  game.look('down')
  assert.equal(reactions.length, 0, 'motion is off by default')
  h.advance(JANKEN_TIMING.hoiReveal)
  game.setMotion(true)
  assert.equal(game.snapshot().motion, true)
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  randoms.push(pick(HOI_DIRECTIONS, 'right'))
  game.look('left')
  assert.deepEqual(
    reactions.map((reaction) => reaction.name),
    [HOI_REACTIONS.right],
  )
  assert.equal(reactions[0].active, true)
  game.setMotion(false)
  assert.equal(reactions[0].active, false, 'turning motion off cancels only our reaction')
  game.setMotion(true)
  block('conversation')
  h.advance(JANKEN_TIMING.hoiReveal)
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  game.look('up')
  assert.equal(reactions.length, 1, 'no reaction while the host is busy')
  assert.equal(game.snapshot().motionBlockReason, 'conversation')
})

test('close cancels pending timers and our reaction, and ignores later input', () => {
  const h = harness()
  const { game, randoms, pick, reactions, timers, toChoose, toHoi } = h
  game.setMotion(true)
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  game.look('up')
  const snapshots: string[] = []
  game.subscribe((state) => snapshots.push(state.phase))
  game.close()
  assert.equal(
    timers.some((timer) => timer.active),
    false,
  )
  assert.equal(
    reactions.some((reaction) => reaction.active),
    false,
  )
  game.start()
  game.setMotion(false)
  h.advance(60000)
  assert.equal(game.snapshot().phase, 'closed')
  assert.deepEqual(snapshots, ['hoi-reveal'])
})

test('a throwing reaction does not break the game', () => {
  const h = harness({
    react() {
      throw new Error('servo unavailable')
    },
  })
  const { game, randoms, pick, toChoose, toHoi } = h
  game.setMotion(true)
  game.start()
  toChoose()
  randoms.push(pick(JANKEN_HANDS, 'scissors'))
  game.choose('rock')
  toHoi()
  game.look('up')
  assert.equal(game.snapshot().phase, 'hoi-reveal')
})
