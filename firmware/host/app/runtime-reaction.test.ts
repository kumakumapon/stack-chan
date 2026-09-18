import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'

// Everything runtime-reaction.ts pulls in transitively (see its own header comment for why it
// avoids 'hands' and a relative import of capabilities.ts) is either a real npm package or needs
// a Node-runnable alias, the same way performance-player.test.ts and reaction-catalog.test.ts set
// theirs up.
const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(hostRoot, 'time', resolve(hostRoot, 'modules/testing/fakes/time.js'), { hasDefaultExport: true })
writeAliasPackage(hostRoot, 'timer', resolve(hostRoot, 'modules/testing/fakes/timer.js'), { hasDefaultExport: true })
writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
writeAliasPackage(hostRoot, 'reaction-types', resolve(hostRoot, 'modules/reaction/reaction-types.js'))
writeAliasPackage(hostRoot, 'reaction-limits', resolve(hostRoot, 'modules/reaction/reaction-limits.js'))
writeAliasPackage(hostRoot, 'reaction-player', resolve(hostRoot, 'modules/reaction/reaction-player.js'))
writeAliasPackage(hostRoot, 'reaction-catalog', resolve(hostRoot, 'modules/reaction/reaction-catalog.js'))
writeAliasPackage(hostRoot, 'timeline-clock', resolve(hostRoot, 'modules/reaction/timeline-clock.js'))
writeAliasPackage(hostRoot, 'performance-types', resolve(hostRoot, 'modules/performance/performance-types.js'))
writeAliasPackage(hostRoot, 'performance-player', resolve(hostRoot, 'modules/performance/performance-player.js'))
writeAliasPackage(hostRoot, 'performance-catalog', resolve(hostRoot, 'modules/performance/performance-catalog.js'))
writeAliasPackage(hostRoot, 'motion-catalog', resolve(hostRoot, 'modules/performance/motion-catalog.js'))

const { default: Timer } = await import('timer')
const { createReactionRuntime, createReactionStage } = await import('./runtime-reaction.js')
type ReactionRuntimeDeps = import('./runtime-reaction.js').ReactionRuntimeDeps

type Pose = { position: { x: number; y: number; z: number }; rotation: { y: number; p: number; r: number } }

type Fakes = {
  deps: ReactionRuntimeDeps
  faceCalls: Array<{ method: string; args: unknown[] }>
  handAnimation: string
  effects: unknown[]
  torqueCalls: boolean[]
  setPoseCalls: Array<{ pose: Pose; time: number | undefined }>
  lightCalls: Array<{ ledName: string; r: number; g: number; b: number; durationMs: number | undefined }>
  sayCalls: Array<{ text: string; volume: number | undefined }>
  singCalls: Array<{ koe: string; volume: number | undefined }>
  audioActive: { value: boolean }
  now_: { value: number }
  tick(ms: number): void
}

function createFakes(): Fakes {
  // Timer's fake module state is shared across this whole test file (it's a singleton ESM
  // module), so each test starts from a clean slate the way performance-player.test.ts does.
  Timer.reset()
  const faceCalls: Fakes['faceCalls'] = []
  let handAnimation = 'none'
  const effects: unknown[] = []
  const torqueCalls: boolean[] = []
  const setPoseCalls: Fakes['setPoseCalls'] = []
  const lightCalls: Fakes['lightCalls'] = []
  const sayCalls: Fakes['sayCalls'] = []
  const singCalls: Fakes['singCalls'] = []
  const audioActive = { value: false }
  const now_ = { value: 0 }
  let pose: Pose = { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0, p: 0, r: 0 } }

  const deps: ReactionRuntimeDeps = {
    face: {
      setEmotion: (emotion) => faceCalls.push({ method: 'setEmotion', args: [emotion] }),
      setEyeOpen: (key, value) => faceCalls.push({ method: 'setEyeOpen', args: [key, value] }),
      setMouthOpen: (value) => faceCalls.push({ method: 'setMouthOpen', args: [value] }),
    },
    ui: {
      setHandAnimation: (name) => {
        handAnimation = name
      },
      addEffect: (effect) => effects.push(effect),
      removeEffect: (effect) => {
        const index = effects.indexOf(effect)
        if (index >= 0) effects.splice(index, 1)
      },
    },
    motion: {
      get pose() {
        return { body: pose }
      },
      setPose: (nextPose, time) => {
        setPoseCalls.push({ pose: nextPose, time })
        pose = { position: { ...nextPose.position }, rotation: { ...nextPose.rotation } }
        return Promise.resolve()
      },
      setTorque: (torque) => {
        torqueCalls.push(torque)
        return Promise.resolve()
      },
    },
    audio: {
      say: (text, volume) => {
        sayCalls.push({ text, volume })
        return Promise.resolve({ success: true })
      },
      sing: (koe, volume) => {
        singCalls.push({ koe, volume })
        return Promise.resolve({ success: true })
      },
      get isActive() {
        return audioActive.value
      },
    },
    lighting: {
      led: { front: {} },
      lightOn: (ledName, r, g, b, durationMs) => lightCalls.push({ ledName, r, g, b, durationMs }),
    },
    createEffect: (key) => ({ key }),
    isHandAnimationName: (value) => value === 'none' || value === 'wave' || value === 'cheer',
    now: () => now_.value,
  }

  return {
    deps,
    faceCalls,
    get handAnimation() {
      return handAnimation
    },
    effects,
    torqueCalls,
    setPoseCalls,
    lightCalls,
    sayCalls,
    singCalls,
    audioActive,
    now_,
    tick(ms) {
      now_.value += ms
      Timer.advance(ms)
    },
  } as Fakes
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/**
 * Advances the fake clock in small steps, flushing microtasks after each one, until
 * `isActive()` reports done or `maxMs` is exceeded. A single big `tick()` can fire several
 * frames back to back before a torque-enable promise from the *first* of them has resolved,
 * which would let that stale, already-superseded head move re-apply itself later; small steps
 * (well under the reaction/motion catalogs' own minimum frame spacing) keep at most one such
 * transition in flight at a time, the way real elapsed device time would.
 */
async function runToCompletion(fakes: Fakes, isActive: () => boolean, maxMs = 10000, stepMs = 50): Promise<void> {
  let elapsed = 0
  while (isActive() && elapsed < maxMs) {
    fakes.tick(stepMs)
    await flush()
    elapsed += stepMs
  }
}

test('setHead enables torque once, moves the head in seconds, and reports done', async () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)
  let doneResult: boolean | undefined
  stage.setHead({ yaw: 0.1, pitch: -0.2 }, 500, (ok) => {
    doneResult = ok
  })
  await flush()
  assert.deepEqual(fakes.torqueCalls, [true])
  assert.equal(fakes.setPoseCalls.length, 1)
  assert.equal(fakes.setPoseCalls[0].time, 0.5)
  assert.deepEqual(fakes.setPoseCalls[0].pose.rotation, { r: 0, p: -0.2, y: 0.1 })
  assert.equal(doneResult, true)

  // A second head move while torque is already held does not re-enable it.
  stage.setHead({ yaw: 0, pitch: 0 }, 200, () => {})
  await flush()
  assert.deepEqual(fakes.torqueCalls, [true])
  assert.equal(fakes.setPoseCalls.length, 2)
})

test('releaseHead releases torque and lets a later setHead re-enable it', async () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)
  stage.setHead({ yaw: 0, pitch: 0 }, 200, () => {})
  await flush()
  stage.releaseHead()
  await flush()
  assert.deepEqual(fakes.torqueCalls, [true, false])

  stage.setHead({ yaw: 0, pitch: 0 }, 200, () => {})
  await flush()
  assert.deepEqual(fakes.torqueCalls, [true, false, true])
})

test('setEffect adds an effect for a key and removes the previous one; null just removes', () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)
  stage.setEffect('heart')
  assert.deepEqual(fakes.effects, [{ key: 'heart' }])

  stage.setEffect('tear')
  assert.deepEqual(fakes.effects, [{ key: 'tear' }])

  stage.setEffect(null)
  assert.deepEqual(fakes.effects, [])
})

test('setEmotion and setHand report false for unknown names without calling the capability', () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)

  assert.equal(stage.setEmotion('NOT_A_REAL_EMOTION'), false)
  assert.equal(fakes.faceCalls.length, 0)
  assert.equal(stage.setEmotion('happy'), true)
  assert.equal(fakes.faceCalls.length, 1)

  assert.equal(stage.setHand('not-a-hand'), false)
  assert.equal(fakes.handAnimation, 'none')
  assert.equal(stage.setHand('wave'), true)
  assert.equal(fakes.handAnimation, 'wave')
})

test('isAudioActive reflects the audio fake', () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)
  assert.equal(stage.isAudioActive(), false)
  fakes.audioActive.value = true
  assert.equal(stage.isAudioActive(), true)
})

test('snapshot/restore round trip: setting emotion, hand, effect and head changes the snapshot, and applying it back restores the stage', async () => {
  const fakes = createFakes()
  const stage = createReactionStage(fakes.deps)

  const baseline = stage.snapshot()
  assert.deepEqual(baseline, { emotion: 'NEUTRAL', hand: 'none', effect: null, head: { yaw: 0, pitch: 0 } })

  stage.setEmotion('happy')
  stage.setHand('wave')
  stage.setEffect('heart')
  stage.setHead({ yaw: 0.3, pitch: -0.1 }, 200, () => {})
  await flush()

  const changed = stage.snapshot()
  assert.deepEqual(changed, { emotion: 'HAPPY', hand: 'wave', effect: 'heart', head: { yaw: 0.3, pitch: -0.1 } })

  // Apply the baseline back through the same setters restoreStage() in reaction-player.ts uses.
  stage.setEmotion(baseline.emotion)
  stage.setEyeOpen(1, 1)
  stage.setMouthOpen(0)
  stage.setHand(baseline.hand)
  stage.setEffect(baseline.effect)
  let headDone: boolean | undefined
  stage.setHead(baseline.head, 220, (ok) => {
    headDone = ok
  })
  await flush()

  assert.deepEqual(stage.snapshot(), baseline)
  assert.equal(headDone, true)
  assert.deepEqual(fakes.effects, [])
})

test('reaction.play refuses an unknown name', () => {
  const runtime = createReactionRuntime(createFakes().deps)
  const result = runtime.reaction.play('not-a-reaction' as never)
  assert.deepEqual(result, { ok: false, error: 'unknown reaction: not-a-reaction' })
})

test('performance.play refuses an unknown name', () => {
  const runtime = createReactionRuntime(createFakes().deps)
  const result = runtime.performance.play('not-a-performance' as never)
  assert.deepEqual(result, { ok: false, error: 'unknown performance: not-a-performance' })
})

test('reaction.play is refused while a performance is active', async () => {
  const fakes = createFakes()
  const runtime = createReactionRuntime(fakes.deps)
  const started = runtime.performance.play('cheer')
  assert.equal(started.ok, true)
  assert.equal(runtime.performance.status().active, 'cheer')

  const result = runtime.reaction.play('yes')
  assert.deepEqual(result, { ok: false, error: 'performance active' })
  assert.equal(runtime.reaction.status().active, null)
})

test('performance.play cancels a direct reaction that is already running', async () => {
  const fakes = createFakes()
  const runtime = createReactionRuntime(fakes.deps)
  const started = runtime.reaction.play('yes')
  assert.equal(started.ok, true)
  assert.equal(runtime.reaction.status().active, 'yes')

  const result = runtime.performance.play('cheer')
  assert.equal(result.ok, true)
  assert.equal(runtime.reaction.status().active, null)
  assert.equal(runtime.performance.status().active, 'cheer')
})

test('close cancels both an active reaction and an active performance', async () => {
  const reactionRuntime = createReactionRuntime(createFakes().deps)
  reactionRuntime.reaction.play('yes')
  assert.equal(reactionRuntime.reaction.status().active, 'yes')
  reactionRuntime.close()
  assert.equal(reactionRuntime.reaction.status().active, null)

  const performanceRuntime = createReactionRuntime(createFakes().deps)
  performanceRuntime.performance.play('cheer')
  assert.equal(performanceRuntime.performance.status().active, 'cheer')
  performanceRuntime.close()
  assert.equal(performanceRuntime.performance.status().active, null)
})

test('reaction.play("yes") runs its timeline and restores emotion, head and torque at the end', async () => {
  const fakes = createFakes()
  const runtime = createReactionRuntime(fakes.deps)
  const result = runtime.reaction.play('yes')
  assert.equal(result.ok, true)
  assert.equal(fakes.faceCalls.at(-1)?.method, 'setEmotion')

  await runToCompletion(fakes, () => runtime.reaction.status().active !== null, 2000)

  assert.equal(runtime.reaction.status().active, null)
  assert.deepEqual(fakes.deps.motion.pose.body.rotation, { y: 0, p: 0, r: 0 })
  assert.equal(fakes.torqueCalls.at(-1), false)
})

test('performance.play("greeting") sets its hand and effect from the nested reaction, then restores at the end', async () => {
  const fakes = createFakes()
  const runtime = createReactionRuntime(fakes.deps)
  const result = runtime.performance.play('greeting')
  assert.equal(result.ok, true)
  // The performance's first cue plays the 'greeting' reaction, whose own first frame sets the
  // hand and fires synchronously (TimelineClock applies an `at: 0` entry before `play` returns).
  assert.equal(fakes.handAnimation, 'wave')

  await runToCompletion(fakes, () => fakes.effects.length === 0, 2000)
  assert.deepEqual(fakes.effects, [{ key: 'heart' }])

  await runToCompletion(fakes, () => fakes.effects.length > 0, 2000)
  assert.deepEqual(fakes.effects, [])

  // The greeting performance runs a further 4.6s of speech/motion/hand cues after its opening
  // reaction restores; run it all the way out and check it lands back in a clean state.
  await runToCompletion(fakes, () => runtime.performance.status().active !== null, 8000)

  assert.equal(runtime.performance.status().active, null)
  assert.equal(fakes.handAnimation, 'none')
  assert.deepEqual(fakes.effects, [])
  assert.deepEqual(fakes.deps.motion.pose.body.rotation, { y: 0, p: 0, r: 0 })
})
