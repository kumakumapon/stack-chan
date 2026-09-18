import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'
import type { ReactionFrame, ReactionStage, ReactionTimeline, StageSnapshot } from './reaction-types.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
writeAliasPackage(modulesRoot, 'reaction-limits', resolve(modulesRoot, 'reaction/reaction-limits.js'))
writeAliasPackage(modulesRoot, 'timeline-clock', resolve(modulesRoot, 'reaction/timeline-clock.js'))

const { default: Timer } = await import('../testing/fakes/timer.js')
const { ReactionPlayer } = await import('./reaction-player.js')

type FakeStage = ReactionStage & {
  log: string[]
  audioActive: boolean
  headMoves: Array<{ yaw: number; pitch: number; durationMs: number; done: (ok: boolean) => void }>
  state: StageSnapshot
  throwOnEmotion: boolean
}

function createStage(): FakeStage {
  let now = 0
  const stage: FakeStage = {
    log: [],
    audioActive: false,
    headMoves: [],
    throwOnEmotion: false,
    state: { emotion: 'NEUTRAL', hand: 'none', effect: null, head: { yaw: 0.1, pitch: -0.05 } },
    now: () => now,
    snapshot: () => ({ ...stage.state, head: { ...stage.state.head } }),
    setEmotion(name) {
      if (stage.throwOnEmotion) throw new Error('face offline')
      stage.log.push(`emotion ${name}`)
      if (name === 'BOGUS') return false
      stage.state.emotion = name
      return true
    },
    setEyeOpen: (left, right) => void stage.log.push(`eyes ${left},${right}`),
    setMouthOpen: (value) => void stage.log.push(`mouth ${value}`),
    setHand(name) {
      stage.log.push(`hand ${name}`)
      stage.state.hand = name
      return true
    },
    setEffect: (key) => void stage.log.push(`effect ${key}`),
    setHead(target, durationMs, done) {
      stage.log.push(`head ${target.yaw.toFixed(3)},${target.pitch.toFixed(3)} ${durationMs}`)
      stage.headMoves.push({ ...target, durationMs, done })
    },
    releaseHead: () => void stage.log.push('release'),
    lightOn: (r, g, b, durationMs) => void stage.log.push(`light ${r},${g},${b},${durationMs}`),
    isAudioActive: () => stage.audioActive,
  }
  // The stage clock advances with the fake Timer.
  ;(stage as unknown as { tick: (ms: number) => void }).tick = (ms) => {
    now += ms
    Timer.advance(ms)
  }
  return stage
}

function advance(stage: FakeStage, ms: number): void {
  ;(stage as unknown as { tick: (ms: number) => void }).tick(ms)
}

const timeline = (frames: ReactionFrame[], durationMs = 600, restore?: boolean): ReactionTimeline => ({
  name: 'yes',
  frames,
  durationMs,
  restore,
})

function setup() {
  Timer.reset()
  const stage = createStage()
  const ended: string[] = []
  const traced: string[] = []
  const player = new ReactionPlayer({
    stage,
    onEnd: (name, reason) => ended.push(`${name} ${reason}`),
    trace: (message) => traced.push(message.trim()),
  })
  return { stage, player, ended, traced }
}

test('frames apply at their times, touching only the fields they name, then the stage is restored', () => {
  const { stage, player, ended } = setup()
  const result = player.play(
    timeline([
      { at: 0, emotion: 'HAPPY', head: { pitch: 0.2 } },
      { at: 200, hand: 'wave', effect: 'heart' },
      { at: 400, eyes: { leftOpen: 0.2 }, mouth: { open: 0.5 }, light: { r: 1, g: 2, b: 3, durationMs: 100 } },
    ]),
  )
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(player.status(), { active: 'yes', startedAt: 0 })
  // Missing yaw holds the baseline yaw; the pitch is clamped to the limit (π/8 ≈ 0.393 > 0.2 so unchanged).
  assert.deepEqual(stage.log, ['emotion HAPPY', 'head 0.100,0.200 220'])
  advance(stage, 200)
  assert.deepEqual(stage.log.slice(2), ['hand wave', 'effect heart'])
  advance(stage, 200)
  assert.deepEqual(stage.log.slice(4), ['eyes 0.2,1', 'mouth 0.5', 'light 1,2,3,100'])
  assert.deepEqual(ended, [])
  advance(stage, 200)
  assert.deepEqual(ended, ['yes completed'])
  assert.deepEqual(stage.log.slice(7), [
    'emotion NEUTRAL',
    'eyes 1,1',
    'mouth 0',
    'hand none',
    'effect null',
    'head 0.100,-0.050 220',
  ])
  // Torque is released only once the head is back.
  assert.equal(stage.log.includes('release'), false)
  stage.headMoves.at(-1)?.done(true)
  assert.equal(stage.log.at(-1), 'release')
  assert.deepEqual(player.status(), { active: null, startedAt: null })
})

test('a reaction that never moved the head neither moves nor releases it on restore', () => {
  const { stage, player } = setup()
  player.play(timeline([{ at: 0, emotion: 'HAPPY' }], 100))
  advance(stage, 100)
  assert.equal(
    stage.log.some((line) => line.startsWith('head') || line === 'release'),
    false,
  )
})

test('cancel restores immediately and reports cancelled', () => {
  const { stage, player, ended } = setup()
  player.play(
    timeline([
      { at: 0, hand: 'clap', head: { yaw: 0.3 } },
      { at: 300, effect: 'heart' },
    ]),
  )
  assert.equal(player.cancel(), true)
  assert.deepEqual(ended, ['yes cancelled'])
  assert.equal(stage.log.includes('hand none'), true)
  assert.equal(stage.log.at(-1), 'head 0.100,-0.050 220')
  advance(stage, 1000)
  assert.equal(stage.log.includes('effect heart'), false)
  assert.equal(player.cancel(), false)
})

test('an interrupting reaction ends the first one and the final restore returns to the original stage', () => {
  const { stage, player, ended } = setup()
  player.play(timeline([{ at: 0, emotion: 'HAPPY', hand: 'wave', head: { yaw: 0.3 } }], 1000))
  advance(stage, 100)
  stage.log.length = 0
  player.play({ ...timeline([{ at: 0, emotion: 'SAD', head: { pitch: -0.2 } }], 300), name: 'no' })
  assert.deepEqual(ended, ['yes interrupted'])
  // Face and hands reset for the newcomer, but no head restore in between.
  assert.deepEqual(stage.log.slice(0, 5), ['emotion NEUTRAL', 'eyes 1,1', 'mouth 0', 'hand none', 'effect null'])
  assert.deepEqual(stage.log.slice(5), ['emotion SAD', 'head 0.100,-0.200 220'])
  assert.equal(player.status().active, 'no')
  advance(stage, 300)
  assert.deepEqual(ended, ['yes interrupted', 'no completed'])
  assert.equal(stage.log.at(-1), 'head 0.100,-0.050 220')
  assert.equal(stage.state.emotion, 'NEUTRAL')
})

test('intensity scales head amplitude and out-of-range targets are clamped', () => {
  const { stage, player } = setup()
  player.play(timeline([{ at: 0, head: { yaw: 0.4, pitch: -2 } }], 100), { intensity: 0.5 })
  assert.equal(stage.log[0], `head ${(0.2).toFixed(3)},${(-Math.PI / 16).toFixed(3)} 220`)
})

test('mouth frames are left alone while audio plays, and an unknown emotion is traced without aborting', () => {
  const { stage, player, traced, ended } = setup()
  stage.audioActive = true
  player.play(
    timeline(
      [
        { at: 0, emotion: 'BOGUS', mouth: { open: 1 } },
        { at: 100, effect: 'heart' },
      ],
      200,
    ),
  )
  assert.equal(stage.log.includes('mouth 1'), false)
  assert.match(traced[0], /unknown emotion BOGUS/)
  advance(stage, 100)
  assert.equal(stage.log.includes('effect heart'), true)
  advance(stage, 100)
  assert.deepEqual(ended, ['yes completed'])
  assert.equal(stage.log.includes('mouth 0'), false)
})

test('restore: false leaves the stage as the reaction left it but still releases the head', () => {
  const { stage, player } = setup()
  player.play(timeline([{ at: 0, emotion: 'HAPPY', head: { yaw: 0.2 } }], 100, false))
  advance(stage, 100)
  assert.equal(stage.log.includes('emotion NEUTRAL'), false)
  assert.equal(stage.log.at(-1), 'release')
  assert.equal(stage.state.emotion, 'HAPPY')
})

test('a timeline that fails validation is refused before the stage is touched', () => {
  const { stage, player } = setup()
  const result = player.play(timeline([], 100))
  assert.equal(result.ok, false)
  assert.deepEqual(stage.log, [])
  assert.equal(player.status().active, null)
})

test('a stage failure ends the reaction with error and still restores', () => {
  const { stage, player, ended, traced } = setup()
  player.play(
    timeline(
      [
        { at: 0, hand: 'wave' },
        { at: 100, emotion: 'HAPPY' },
      ],
      300,
    ),
  )
  stage.throwOnEmotion = true
  advance(stage, 100)
  assert.deepEqual(ended, ['yes error'])
  assert.match(traced.join('\n'), /frame failed: Error: face offline/)
  // The restore's own emotion call throws too; the rest of the restore is skipped but the player stays usable.
  advance(stage, 500)
  assert.equal(player.status().active, null)
  stage.throwOnEmotion = false
  assert.deepEqual(player.play(timeline([{ at: 0, hand: 'clap' }], 100)), { ok: true })
})

test('a slow frame does not delay the frames after it', () => {
  const { stage, player } = setup()
  player.play(
    timeline(
      [
        { at: 100, effect: 'heart' },
        { at: 200, effect: 'sweat' },
      ],
      300,
    ),
  )
  // The 100 ms timer fires 80 ms late.
  const tick = (stage as unknown as { tick: (ms: number) => void }).tick
  Timer.advance(100)
  tick(180)
  assert.deepEqual(stage.log, ['effect heart'])
  // At wall clock 200 the second frame is due regardless of the first one's lateness.
  assert.deepEqual(stage.log, ['effect heart'])
  tick(20)
  assert.deepEqual(stage.log, ['effect heart', 'effect sweat'])
})
