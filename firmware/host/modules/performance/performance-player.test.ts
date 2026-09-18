import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { ReactionTimeline, StageSnapshot } from '../reaction/reaction-types.js'
import { writeAliasPackage } from '../testing/node-alias-package.js'
import type { MotionDefinition, PerformanceCue, PerformanceTimeline } from './performance-types.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
writeAliasPackage(modulesRoot, 'reaction-limits', resolve(modulesRoot, 'reaction/reaction-limits.js'))
writeAliasPackage(modulesRoot, 'reaction-player', resolve(modulesRoot, 'reaction/reaction-player.js'))
writeAliasPackage(modulesRoot, 'timeline-clock', resolve(modulesRoot, 'reaction/timeline-clock.js'))
writeAliasPackage(modulesRoot, 'performance-types', resolve(modulesRoot, 'performance/performance-types.js'))

const { default: Timer } = await import('../testing/fakes/timer.js')
const { PerformancePlayer, validatePerformance } = await import('./performance-player.js')
type PerformanceStage = import('./performance-player.js').PerformanceStage

type FakeStage = PerformanceStage & {
  log: string[]
  now_: number
  state: StageSnapshot
  headMoves: Array<{ done: (ok: boolean) => void }>
  refuseSpeech: boolean
  tick(ms: number): void
}

function createStage(): FakeStage {
  const stage: FakeStage = {
    log: [],
    now_: 0,
    headMoves: [],
    refuseSpeech: false,
    state: { emotion: 'NEUTRAL', hand: 'none', effect: null, head: { yaw: 0, pitch: 0 } },
    now: () => stage.now_,
    snapshot: () => ({ ...stage.state, head: { ...stage.state.head } }),
    setEmotion(name) {
      stage.log.push(`emotion ${name}`)
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
      stage.log.push(`head ${target.yaw.toFixed(2)},${target.pitch.toFixed(2)} ${durationMs}`)
      stage.headMoves.push({ done })
    },
    releaseHead: () => void stage.log.push('release'),
    lightOn: (r, g, b) => void stage.log.push(`light ${r},${g},${b}`),
    isAudioActive: () => false,
    say: (text, volume, done) => {
      stage.log.push(`say ${text} ${volume}`)
      done(!stage.refuseSpeech)
    },
    sing: (koe, volume, done) => {
      stage.log.push(`sing ${koe} ${volume}`)
      done(true)
    },
    tick(ms) {
      stage.now_ += ms
      Timer.advance(ms)
    },
  }
  return stage
}

const nod: MotionDefinition = {
  name: 'nod',
  steps: [
    { at: 0, yaw: 0, pitch: -0.2, durationMs: 200 },
    { at: 200, yaw: 0, pitch: 0, durationMs: 200 },
  ],
  durationMs: 400,
}

const wave: ReactionTimeline = {
  name: 'greeting',
  frames: [
    { at: 0, emotion: 'HAPPY', hand: 'wave' },
    { at: 100, effect: 'heart' },
  ],
  durationMs: 200,
}

const lookups = {
  reactions: (name: string) => (name === 'greeting' ? wave : undefined),
  motions: (name: string) => (name === 'nod' ? nod : undefined),
}

const performance = (cues: PerformanceCue[], durationMs = 1000, restore?: boolean): PerformanceTimeline => ({
  name: 'greeting',
  cues,
  durationMs,
  restore,
})

function setup() {
  Timer.reset()
  const stage = createStage()
  const ended: string[] = []
  const traced: string[] = []
  const player = new PerformancePlayer({
    stage,
    ...lookups,
    onEnd: (name, reason) => ended.push(`${name} ${reason}`),
    trace: (message) => traced.push(message.trim()),
  })
  return { stage, player, ended, traced }
}

test('cues fire at absolute times, motions expand into servo steps, and the stage is restored at the end', () => {
  const { stage, player, ended } = setup()
  const result = player.play(
    performance([
      { at: 0, emotion: 'HAPPY', hand: 'cheer', light: { r: 1, g: 2, b: 3 } },
      { at: 100, motion: 'nod' },
      { at: 600, effect: 'heart' },
    ]),
  )
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(stage.log, ['emotion HAPPY', 'hand cheer', 'light 1,2,3'])
  assert.deepEqual(player.status(), { active: 'greeting', startedAt: 0, nextCue: 1 })
  stage.tick(100)
  assert.deepEqual(stage.log.slice(3), ['head 0.00,-0.20 200'])
  stage.tick(200)
  assert.deepEqual(stage.log.slice(4), ['head 0.00,0.00 200'])
  stage.tick(300)
  assert.deepEqual(stage.log.slice(5), ['effect heart'])
  assert.equal(player.status().nextCue, 3)
  stage.tick(400)
  assert.deepEqual(ended, ['greeting completed'])
  assert.deepEqual(stage.log.slice(6), [
    'emotion NEUTRAL',
    'eyes 1,1',
    'mouth 0',
    'hand none',
    'effect null',
    'head 0.00,0.00 220',
  ])
  stage.headMoves.at(-1)?.done(true)
  assert.equal(stage.log.at(-1), 'release')
  assert.deepEqual(player.status(), { active: null, startedAt: null, nextCue: 0 })
})

test('speech and song are handed to the stage with their volume; a refusal is traced, not fatal', () => {
  const { stage, player, traced, ended } = setup()
  stage.refuseSpeech = true
  player.play(
    performance(
      [
        { at: 0, speech: { text: 'hi', volume: 0.5 } },
        { at: 100, song: { koe: 'ド' } },
      ],
      200,
    ),
  )
  assert.deepEqual(stage.log, ['say hi 0.5'])
  assert.match(traced[0], /speech refused/)
  stage.tick(100)
  assert.deepEqual(stage.log.slice(1), ['sing ド undefined'])
  stage.tick(100)
  assert.deepEqual(ended, ['greeting completed'])
})

test('a reaction cue plays the looked-up timeline on the same stage', () => {
  const { stage, player } = setup()
  player.play(performance([{ at: 0, reaction: 'greeting' }], 500))
  assert.deepEqual(stage.log, ['emotion HAPPY', 'hand wave'])
  stage.tick(100)
  assert.deepEqual(stage.log.slice(2), ['effect heart'])
  stage.tick(100)
  // The reaction restores itself when it ends.
  assert.deepEqual(stage.log.slice(3), ['emotion NEUTRAL', 'eyes 1,1', 'mouth 0', 'hand none', 'effect null'])
})

test('cancel stops scheduling, cancels the running reaction and restores; speech already started is not undone', () => {
  const { stage, player, ended } = setup()
  player.play(
    performance([
      { at: 0, speech: { text: 'hello' }, motion: 'nod' },
      { at: 300, reaction: 'greeting' },
      { at: 800, effect: 'heart' },
    ]),
  )
  stage.tick(300)
  assert.equal(stage.log.includes('hand wave'), true)
  stage.log.length = 0
  assert.equal(player.cancel(), true)
  assert.deepEqual(ended, ['greeting cancelled'])
  // Reaction restore first, then the performance's own restore including the head.
  assert.deepEqual(stage.log, [
    'emotion NEUTRAL',
    'eyes 1,1',
    'mouth 0',
    'hand none',
    'effect null',
    'emotion NEUTRAL',
    'eyes 1,1',
    'mouth 0',
    'hand none',
    'effect null',
    'head 0.00,0.00 220',
  ])
  stage.tick(1000)
  assert.equal(stage.log.includes('effect heart'), false)
  assert.equal(stage.log.filter((line) => line.startsWith('say')).length, 0)
  assert.equal(player.cancel(), false)
})

test('validation refuses structurally broken performances before touching the stage', () => {
  const { stage, player } = setup()
  const refused = (cues: PerformanceCue[], durationMs = 1000) => {
    const result = player.play(performance(cues, durationMs))
    assert.equal(result.ok, false)
    return result.ok ? '' : result.error
  }
  assert.match(refused([]), /no cues/)
  assert.match(refused([{ at: 100 }, { at: 50 }]), /out of order/)
  assert.match(refused([{ at: 0, motion: 'moonwalk' as never }]), /unknown motion/)
  assert.match(refused([{ at: 0, reaction: 'tantrum' as never }]), /unknown reaction/)
  assert.match(
    refused([
      { at: 0, motion: 'nod' },
      { at: 300, head: { yaw: 0.1 } },
    ]),
    /before the previous motion/,
  )
  assert.match(
    refused([
      { at: 0, head: { yaw: 0.1 } },
      { at: 100, head: { yaw: 0.2 } },
    ]),
    /before the previous motion/,
  )
  assert.match(refused([{ at: 2000 }]), /after the performance ends/)
  assert.match(refused([{ at: 0 }], 200000), /exceeds/)
  assert.deepEqual(stage.log, [])
  assert.equal(
    validatePerformance(
      performance([
        { at: 0, motion: 'nod' },
        { at: 400, head: { yaw: 0.1 } },
      ]),
      lookups,
    ),
    undefined,
  )
})

test('a performance that interrupts another restores to the original baseline at its own end', () => {
  const { stage, player, ended } = setup()
  stage.state.head = { yaw: 0.1, pitch: 0.1 }
  player.play(performance([{ at: 0, emotion: 'HAPPY', motion: 'nod' }], 2000))
  stage.tick(50)
  stage.log.length = 0
  player.play({ ...performance([{ at: 0, emotion: 'SAD' }], 100), name: 'cheer' })
  assert.deepEqual(ended, ['greeting interrupted'])
  assert.equal(
    stage.log.some((line) => line.startsWith('head')),
    false,
  )
  assert.equal(stage.log.at(-1), 'emotion SAD')
  stage.tick(100)
  assert.deepEqual(ended, ['greeting interrupted', 'cheer completed'])
  assert.equal(stage.log.at(-1), 'head 0.10,0.10 220')
})

test('intensity scales motion steps and head cues', () => {
  const { stage, player } = setup()
  player.play(
    performance([
      { at: 0, motion: 'nod' },
      { at: 500, head: { yaw: 0.4, pitch: 0 } },
    ]),
    { intensity: 0.5 },
  )
  assert.deepEqual(stage.log, ['head 0.00,-0.10 200'])
  stage.tick(500)
  assert.equal(stage.log.at(-1), 'head 0.20,0.00 220')
})

test('a stall beyond the catch-up window skips the overdue cues and keeps counting them', () => {
  const { stage, player, traced } = setup()
  player.play(
    performance(
      [
        { at: 100, effect: 'heart' },
        { at: 200, effect: 'sweat' },
        { at: 2000, effect: 'tear' },
      ],
      2500,
    ),
  )
  Timer.advance(100)
  stage.tick(1500) // the 100 ms timer fires at wall clock 1500
  assert.deepEqual(stage.log, [])
  assert.equal(traced.filter((line) => /skipped/.test(line)).length, 2)
  assert.equal(player.status().nextCue, 2)
  stage.tick(500)
  assert.deepEqual(stage.log, ['effect tear'])
})

test('restore: false leaves the stage but releases the head after a motion', () => {
  const { stage, player } = setup()
  player.play(performance([{ at: 0, emotion: 'HAPPY', motion: 'nod' }], 500, false))
  stage.tick(500)
  assert.equal(stage.log.includes('emotion NEUTRAL'), false)
  assert.equal(stage.log.at(-1), 'release')
})
