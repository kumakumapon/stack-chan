import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RealtimeFunctionTool } from 'stackchan-realtime-session'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'

// 'face-state', 'reaction-types' and 'performance-types' are real value imports (Emotion,
// emotionFromName, REACTION_NAMES, PERFORMANCE_NAMES), so `node --test` needs a resolvable
// package for each the way tsc's path mapping already resolves them for type-checking.
const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(hostRoot, 'face-state', resolve(hostRoot, 'modules/ui/state/face-state.js'))
writeAliasPackage(hostRoot, 'reaction-types', resolve(hostRoot, 'modules/reaction/reaction-types.js'))
writeAliasPackage(hostRoot, 'performance-types', resolve(hostRoot, 'modules/performance/performance-types.js'))

const { Emotion } = await import('face-state')
const { default: createRealtimeToolProvider } = await import('./realtime-tools.js')

const TOOL_NAMES = [
  'stackchan.say',
  'stackchan.face.setEmotion',
  'stackchan.motion.setPose',
  'stackchan.motion.lookAt',
  'stackchan.light.set',
  'stackchan.camera.capture',
  'stackchan.react',
  'stackchan.perform',
]

type MaybeResult = { success: boolean; value?: string; reason?: string }
type FullContextOverrides = {
  say?: (text: string, volume?: number) => Promise<MaybeResult>
  setEmotion?: (emotion: number) => void
  setPose?: (pose: unknown, time?: number) => Promise<void>
  lookAt?: (position: unknown) => void
  led?: Record<string, unknown>
  lightOn?: (...arguments_: unknown[]) => void
  lightOff?: (...arguments_: unknown[]) => void
  cameraStart?: (options: unknown) => Promise<void>
  cameraCapture?: (options: unknown) => Promise<unknown>
  cameraStop?: () => Promise<void>
  reactionPlay?: (name: unknown, options?: unknown) => { ok: true } | { ok: false; error: string }
  performancePlay?: (name: unknown, options?: unknown) => { ok: true } | { ok: false; error: string }
}

function fullContext(overrides: FullContextOverrides = {}) {
  return {
    audio: {
      say: overrides.say ?? (async () => ({ success: true, value: 'said' })),
    },
    face: {
      setEmotion: overrides.setEmotion ?? (() => undefined),
    },
    motion: {
      setPose: overrides.setPose ?? (async () => undefined),
      lookAt: overrides.lookAt ?? (() => undefined),
    },
    lighting: {
      led: overrides.led ?? { front: {} },
      lightOn: overrides.lightOn ?? (() => undefined),
      lightOff: overrides.lightOff ?? (() => undefined),
    },
    camera: {
      start: overrides.cameraStart ?? (async () => undefined),
      capture:
        overrides.cameraCapture ??
        (async () => ({ width: 320, height: 240, imageType: 'rgb565le', buffer: new ArrayBuffer(0) })),
      stop: overrides.cameraStop ?? (async () => undefined),
    },
    reaction: {
      play: overrides.reactionPlay ?? ((() => ({ ok: true })) as NonNullable<FullContextOverrides['reactionPlay']>),
    },
    performance: {
      play:
        overrides.performancePlay ?? ((() => ({ ok: true })) as NonNullable<FullContextOverrides['performancePlay']>),
    },
  }
}

function functionTools(context: unknown): RealtimeFunctionTool[] {
  return createRealtimeToolProvider(context as never).tools.filter(
    (tool): tool is RealtimeFunctionTool => tool.type === 'function',
  )
}

function toolNames(context: unknown): string[] {
  return functionTools(context).map((tool) => tool.name)
}

function findTool(context: unknown, name: string): RealtimeFunctionTool {
  const tool = functionTools(context).find((candidate) => candidate.name === name)
  assert.ok(tool, `expected a tool named ${name}`)
  return tool as RealtimeFunctionTool
}

test('provider always carries instructions steering the Agent toward the tools', () => {
  const provider = createRealtimeToolProvider(fullContext() as never)
  assert.equal(typeof provider.instructions, 'string')
  assert.ok(provider.instructions && provider.instructions.length > 0)
})

test('exposes every embodiment tool when every capability is present', () => {
  assert.deepEqual(toolNames(fullContext()).sort(), [...TOOL_NAMES].sort())
})

test('omits stackchan.say when the audio capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.audio
  const names = toolNames(context)
  assert.equal(names.includes('stackchan.say'), false)
  assert.equal(names.length, TOOL_NAMES.length - 1)
})

test('omits the face tool when the face capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.face
  assert.equal(toolNames(context).includes('stackchan.face.setEmotion'), false)
})

test('omits both motion tools when the motion capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.motion
  const names = toolNames(context)
  assert.equal(names.includes('stackchan.motion.setPose'), false)
  assert.equal(names.includes('stackchan.motion.lookAt'), false)
})

test('omits the light tool when lighting is missing entirely, or when it has no led map', () => {
  const withoutLighting = fullContext() as Record<string, unknown>
  delete withoutLighting.lighting
  assert.equal(toolNames(withoutLighting).includes('stackchan.light.set'), false)

  const withoutLed = fullContext() as Record<string, unknown>
  ;(withoutLed.lighting as Record<string, unknown>).led = undefined
  assert.equal(toolNames(withoutLed).includes('stackchan.light.set'), false)
})

test('omits the camera tool when the camera capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.camera
  assert.equal(toolNames(context).includes('stackchan.camera.capture'), false)
})

test('omits stackchan.react when the reaction capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.reaction
  assert.equal(toolNames(context).includes('stackchan.react'), false)
})

test('omits stackchan.perform when the performance capability is missing', () => {
  const context = fullContext() as Record<string, unknown>
  delete context.performance
  assert.equal(toolNames(context).includes('stackchan.perform'), false)
})

test('stackchan.say speaks the text and reports the TTS result', async () => {
  const said: Array<{ text: string; volume?: number }> = []
  const context = fullContext({
    say: async (text, volume) => {
      said.push({ text, volume })
      return { success: true, value: 'spoken-id' }
    },
  })
  const tool = findTool(context, 'stackchan.say')
  const result = await tool.execute({ text: 'hello', volume: 0.5 })
  assert.deepEqual(result, { ok: true, said: 'spoken-id' })
  assert.deepEqual(said, [{ text: 'hello', volume: 0.5 }])
})

test('stackchan.say rejects an empty text argument without calling the capability', async () => {
  let called = false
  const context = fullContext({
    say: async () => {
      called = true
      return { success: true, value: '' }
    },
  })
  const tool = findTool(context, 'stackchan.say')
  const result = await tool.execute({})
  assert.equal((result as { ok: boolean }).ok, false)
  assert.equal(called, false)
})

test('stackchan.say turns a failed TTS Maybe result into ok:false', async () => {
  const context = fullContext({ say: async () => ({ success: false, reason: 'tts unavailable' }) })
  const tool = findTool(context, 'stackchan.say')
  const result = await tool.execute({ text: 'hi' })
  assert.deepEqual(result, { ok: false, error: 'tts unavailable' })
})

test('stackchan.say turns a thrown capability error into ok:false instead of throwing', async () => {
  const context = fullContext({
    say: async () => {
      throw new Error('speaker offline')
    },
  })
  const tool = findTool(context, 'stackchan.say')
  const result = await tool.execute({ text: 'hi' })
  assert.deepEqual(result, { ok: false, error: 'speaker offline' })
})

test('stackchan.face.setEmotion coerces the emotion name and calls the capability', () => {
  const seen: number[] = []
  const context = fullContext({ setEmotion: (emotion) => seen.push(emotion) })
  const tool = findTool(context, 'stackchan.face.setEmotion')
  const result = tool.execute({ emotion: 'HAPPY' })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(seen, [Emotion.HAPPY])
})

test('stackchan.face.setEmotion accepts lowercase emotion names', () => {
  const seen: number[] = []
  const context = fullContext({ setEmotion: (emotion) => seen.push(emotion) })
  const tool = findTool(context, 'stackchan.face.setEmotion')
  tool.execute({ emotion: 'sad' })
  assert.deepEqual(seen, [Emotion.SAD])
})

test('stackchan.face.setEmotion rejects an unknown emotion name without calling the capability', () => {
  let called = false
  const context = fullContext({
    setEmotion: () => {
      called = true
    },
  })
  const tool = findTool(context, 'stackchan.face.setEmotion')
  const result = tool.execute({ emotion: 'ECSTATIC' })
  assert.equal((result as { ok: boolean }).ok, false)
  assert.equal(called, false)
})

test('stackchan.face.setEmotion turns a capability failure into ok:false', () => {
  const context = fullContext({
    setEmotion: () => {
      throw new Error('face driver error')
    },
  })
  const tool = findTool(context, 'stackchan.face.setEmotion')
  assert.deepEqual(tool.execute({ emotion: 'SAD' }), { ok: false, error: 'face driver error' })
})

test('stackchan.motion.setPose forwards a fully-formed pose to the capability', async () => {
  const seen: unknown[] = []
  const context = fullContext({
    setPose: async (pose, time) => {
      seen.push({ pose, time })
    },
  })
  const tool = findTool(context, 'stackchan.motion.setPose')
  const result = await tool.execute({
    position: { x: 0.1, y: 0.2, z: 0.3 },
    rotation: { r: 0, p: 0.1, y: -0.1 },
    time: 1.5,
  })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(seen, [
    { pose: { position: { x: 0.1, y: 0.2, z: 0.3 }, rotation: { r: 0, p: 0.1, y: -0.1 } }, time: 1.5 },
  ])
})

test('stackchan.motion.setPose rejects incomplete arguments without calling the capability', async () => {
  let called = false
  const context = fullContext({
    setPose: async () => {
      called = true
    },
  })
  const tool = findTool(context, 'stackchan.motion.setPose')
  const result = await tool.execute({ position: { x: 0, y: 0 }, rotation: { r: 0, p: 0, y: 0 } })
  assert.equal((result as { ok: boolean }).ok, false)
  assert.equal(called, false)
})

test('stackchan.motion.setPose turns a capability failure into ok:false', async () => {
  const context = fullContext({
    setPose: async () => {
      throw new Error('actuator stalled')
    },
  })
  const tool = findTool(context, 'stackchan.motion.setPose')
  const result = await tool.execute({ position: { x: 0, y: 0, z: 0 }, rotation: { r: 0, p: 0, y: 0 } })
  assert.deepEqual(result, { ok: false, error: 'actuator stalled' })
})

test('stackchan.motion.lookAt forwards a Vector3 to the capability', () => {
  const seen: unknown[] = []
  const context = fullContext({ lookAt: (position) => seen.push(position) })
  const tool = findTool(context, 'stackchan.motion.lookAt')
  const result = tool.execute({ x: 1, y: 2, z: 3 })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(seen, [[1, 2, 3]])
})

test('stackchan.motion.lookAt rejects non-numeric coordinates', () => {
  let called = false
  const context = fullContext({
    lookAt: () => {
      called = true
    },
  })
  const tool = findTool(context, 'stackchan.motion.lookAt')
  const result = tool.execute({ x: 1, y: 'two', z: 3 })
  assert.equal((result as { ok: boolean }).ok, false)
  assert.equal(called, false)
})

test('stackchan.light.set defaults to the first light and full brightness', () => {
  const seen: unknown[] = []
  const context = fullContext({
    led: { front: {}, back: {} },
    lightOn: (...arguments_) => seen.push(arguments_),
  })
  const tool = findTool(context, 'stackchan.light.set')
  const result = tool.execute({})
  assert.deepEqual(result, { ok: true, led: 'front', on: true })
  assert.deepEqual(seen, [['front', 255, 255, 255, undefined]])
})

test('stackchan.light.set clamps out-of-range colors and honors an explicit light and off', () => {
  const onCalls: unknown[] = []
  const offCalls: unknown[] = []
  const context = fullContext({
    led: { front: {}, back: {} },
    lightOn: (...arguments_) => onCalls.push(arguments_),
    lightOff: (...arguments_) => offCalls.push(arguments_),
  })
  const tool = findTool(context, 'stackchan.light.set')

  const litResult = tool.execute({ led: 'back', r: -10, g: 999, b: 128, duration: 500 })
  assert.deepEqual(litResult, { ok: true, led: 'back', on: true })
  assert.deepEqual(onCalls, [['back', 0, 255, 128, 500]])

  const offResult = tool.execute({ led: 'back', on: false })
  assert.deepEqual(offResult, { ok: true, led: 'back', on: false })
  assert.deepEqual(offCalls, [['back']])
})

test('stackchan.light.set falls back to the first light for an unknown name', () => {
  const seen: unknown[] = []
  const context = fullContext({
    led: { front: {}, back: {} },
    lightOn: (...arguments_) => seen.push(arguments_[0]),
  })
  const tool = findTool(context, 'stackchan.light.set')
  tool.execute({ led: 'nonexistent' })
  assert.deepEqual(seen, ['front'])
})

test('stackchan.light.set reports ok:false when the device has no lights at all', () => {
  const context = fullContext({ led: {} })
  const tool = findTool(context, 'stackchan.light.set')
  const result = tool.execute({})
  assert.deepEqual(result, { ok: false, error: 'no light is available on this device' })
})

test('stackchan.camera.capture starts, captures, stops, and reports frame metadata', async () => {
  const calls: string[] = []
  const context = fullContext({
    cameraStart: async () => {
      calls.push('start')
    },
    cameraCapture: async () => {
      calls.push('capture')
      return { width: 640, height: 480, imageType: 'jpeg', buffer: new ArrayBuffer(0) }
    },
    cameraStop: async () => {
      calls.push('stop')
    },
  })
  const tool = findTool(context, 'stackchan.camera.capture')
  const result = await tool.execute({})
  assert.deepEqual(result, { ok: true, width: 640, height: 480, imageType: 'jpeg' })
  assert.deepEqual(calls, ['start', 'capture', 'stop'])
})

test('stackchan.camera.capture reports ok:false without stopping when start fails', async () => {
  const calls: string[] = []
  const context = fullContext({
    cameraStart: async () => {
      calls.push('start')
      throw new Error('camera busy')
    },
    cameraStop: async () => {
      calls.push('stop')
    },
  })
  const tool = findTool(context, 'stackchan.camera.capture')
  const result = await tool.execute({})
  assert.deepEqual(result, { ok: false, error: 'camera busy' })
  assert.deepEqual(calls, ['start'])
})

test('stackchan.camera.capture stops the camera even when capture returns no frame', async () => {
  const calls: string[] = []
  const context = fullContext({
    cameraStart: async () => {
      calls.push('start')
    },
    cameraCapture: async () => {
      calls.push('capture')
      return undefined
    },
    cameraStop: async () => {
      calls.push('stop')
    },
  })
  const tool = findTool(context, 'stackchan.camera.capture')
  const result = await tool.execute({})
  assert.deepEqual(result, { ok: false, error: 'camera capture returned no frame' })
  assert.deepEqual(calls, ['start', 'capture', 'stop'])
})

test('stackchan.react declares every reaction name and plays the requested one', async () => {
  const seen: Array<{ name: unknown; options: unknown }> = []
  const context = fullContext({
    reactionPlay: (name, options) => {
      seen.push({ name, options })
      return { ok: true }
    },
  })
  const tool = findTool(context, 'stackchan.react')
  assert.deepEqual((tool.parameters as { properties: { name: { enum: string[] } } }).properties.name.enum, [
    'yes',
    'no',
    'greeting',
    'thinking',
    'delighted',
    'sleepy-yawn',
    'success',
    'failure',
  ])
  const result = await tool.execute({ name: 'greeting', intensity: 0.5 })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(seen, [{ name: 'greeting', options: { intensity: 0.5 } }])
})

test('stackchan.react omits options when intensity is not given', async () => {
  const seen: Array<{ name: unknown; options: unknown }> = []
  const context = fullContext({
    reactionPlay: (name, options) => {
      seen.push({ name, options })
      return { ok: true }
    },
  })
  const tool = findTool(context, 'stackchan.react')
  await tool.execute({ name: 'yes' })
  assert.deepEqual(seen, [{ name: 'yes', options: undefined }])
})

test('stackchan.react rejects an unknown reaction name without calling the capability', async () => {
  let called = false
  const context = fullContext({
    reactionPlay: () => {
      called = true
      return { ok: true }
    },
  })
  const tool = findTool(context, 'stackchan.react')
  const result = await tool.execute({ name: 'ecstatic' })
  assert.deepEqual(result, { ok: false, error: 'unknown reaction: ecstatic' })
  assert.equal(called, false)
})

test('stackchan.react maps a capability refusal to ok:false', async () => {
  const context = fullContext({ reactionPlay: () => ({ ok: false, error: 'performance active' }) })
  const tool = findTool(context, 'stackchan.react')
  const result = await tool.execute({ name: 'yes' })
  assert.deepEqual(result, { ok: false, error: 'performance active' })
})

test('stackchan.react turns a thrown capability error into ok:false instead of throwing', async () => {
  const context = fullContext({
    reactionPlay: () => {
      throw new Error('stage unavailable')
    },
  })
  const tool = findTool(context, 'stackchan.react')
  const result = await tool.execute({ name: 'yes' })
  assert.deepEqual(result, { ok: false, error: 'stage unavailable' })
})

test('stackchan.perform declares every performance name and plays the requested one', async () => {
  const seen: Array<{ name: unknown; options: unknown }> = []
  const context = fullContext({
    performancePlay: (name, options) => {
      seen.push({ name, options })
      return { ok: true }
    },
  })
  const tool = findTool(context, 'stackchan.perform')
  assert.deepEqual((tool.parameters as { properties: { name: { enum: string[] } } }).properties.name.enum, [
    'greeting',
    'happy-dance',
    'cheer',
    'sing-twinkle',
  ])
  const result = await tool.execute({ name: 'cheer' })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(seen, [{ name: 'cheer', options: undefined }])
})

test('stackchan.perform rejects an unknown performance name without calling the capability', async () => {
  let called = false
  const context = fullContext({
    performancePlay: () => {
      called = true
      return { ok: true }
    },
  })
  const tool = findTool(context, 'stackchan.perform')
  const result = await tool.execute({ name: 'parade' })
  assert.deepEqual(result, { ok: false, error: 'unknown performance: parade' })
  assert.equal(called, false)
})

test('stackchan.perform maps a capability refusal to ok:false', async () => {
  const context = fullContext({ performancePlay: () => ({ ok: false, error: 'unknown performance: parade' }) })
  const tool = findTool(context, 'stackchan.perform')
  const result = await tool.execute({ name: 'cheer' })
  assert.deepEqual(result, { ok: false, error: 'unknown performance: parade' })
})

test('stackchan.perform turns a thrown capability error into ok:false instead of throwing', async () => {
  const context = fullContext({
    performancePlay: () => {
      throw new Error('stage unavailable')
    },
  })
  const tool = findTool(context, 'stackchan.perform')
  const result = await tool.execute({ name: 'cheer' })
  assert.deepEqual(result, { ok: false, error: 'stage unavailable' })
})
