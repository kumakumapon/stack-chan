import type { RobotCamera } from 'camera'
import type { StackchanContext } from 'capabilities'
import { type Emotion, EmotionNames, emotionFromName } from 'face-state'
import { PERFORMANCE_NAMES, type PerformanceName, type PerformanceOptions } from 'performance-types'
import { REACTION_NAMES, type ReactionName, type ReactionOptions } from 'reaction-types'
import type { RealtimeFunctionTool, RealtimeToolProvider } from 'stackchan-realtime-session'
import type { Maybe, Pose, Vector3 } from 'stackchan-util'

const INSTRUCTIONS =
  'Use the stackchan.* tools to speak and move the robot body. Call stackchan.say to speak instead of ' +
  'putting spoken words in tool output, and call the face/motion/light/camera tools instead of describing ' +
  'those actions in your reply text. Call stackchan.react for a quick gesture and stackchan.perform for a ' +
  'routine instead of chaining motion calls.'

type ToolResult = { ok: true; [key: string]: unknown } | { ok: false; error: string }

/**
 * The slice of `StackchanContext` these tools actually use, expressed as its
 * own structural type. The 'capabilities' bare specifier resolves to a fake
 * with `StackchanContext = unknown` under Node tests (see
 * `host/modules/testing/fakes/capabilities.ts`), so a single narrowing cast
 * here — instead of dereferencing the imported type directly — is what lets
 * this file both type-check under `node --test` and match the real runtime
 * shape on device, where every field below really is present.
 */
type EmbodimentContext = {
  audio?: { say(text: string, volume?: number): Promise<Maybe<string>> }
  face?: { setEmotion(emotion: Emotion): void }
  motion?: {
    setPose(pose: Pose, time?: number): Promise<void>
    lookAt(position: Vector3): void
  }
  lighting?: {
    led: Record<string, unknown>
    lightOn(ledName: string, r: number, g: number, b: number, duration?: number, index?: number, count?: number): void
    lightOff(ledName: string, index?: number, count?: number): void
  }
  camera?: RobotCamera
  reaction?: {
    play(name: ReactionName, options?: ReactionOptions): { ok: true } | { ok: false; error: string }
  }
  performance?: {
    play(name: PerformanceName, options?: PerformanceOptions): { ok: true } | { ok: false; error: string }
  }
}

/**
 * Exposes the device-hosted embodiment tools over the realtime control plane.
 * Each tool is omitted (not just made to fail) when the capability it needs
 * is unavailable on the given context, so `session.update` never advertises
 * a tool the device cannot actually run.
 */
export default function createRealtimeToolProvider(context: StackchanContext): RealtimeToolProvider {
  const ctx = context as unknown as EmbodimentContext
  const tools: RealtimeFunctionTool[] = []

  if (hasFunction(ctx.audio, 'say')) tools.push(createSayTool(ctx.audio))
  if (hasFunction(ctx.face, 'setEmotion')) tools.push(createSetEmotionTool(ctx.face))
  if (hasFunction(ctx.motion, 'setPose')) tools.push(createSetPoseTool(ctx.motion))
  if (hasFunction(ctx.motion, 'lookAt')) tools.push(createLookAtTool(ctx.motion))
  if (hasFunction(ctx.lighting, 'lightOn') && ctx.lighting?.led) tools.push(createLightSetTool(ctx.lighting))
  if (hasFunction(ctx.camera, 'capture')) tools.push(createCameraCaptureTool(ctx.camera))
  if (hasFunction(ctx.reaction, 'play')) tools.push(createReactionPlayTool(ctx.reaction))
  if (hasFunction(ctx.performance, 'play')) tools.push(createPerformancePlayTool(ctx.performance))

  return { instructions: INSTRUCTIONS, tools }
}

function createSayTool(audio: NonNullable<EmbodimentContext['audio']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.say',
    description: "Speaks text out loud through the robot's own text-to-speech voice.",
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to speak.' },
        volume: { type: 'number', description: 'Playback volume from 0 to 1. Defaults to the current volume.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute(arguments_) {
      const text = typeof arguments_.text === 'string' ? arguments_.text : ''
      if (!text) return failure('"text" must be a non-empty string')
      const volume = typeof arguments_.volume === 'number' ? arguments_.volume : undefined
      try {
        // Cast away the Maybe<T> discriminated union: with strictNullChecks
        // disabled for this project, TS does not reliably narrow it branch by
        // branch, so read both members off a permissive shape instead.
        const result = (await audio.say(text, volume)) as { success: boolean; value?: string; reason?: string }
        return result.success ? success({ said: result.value }) : failure(result.reason ?? 'say failed')
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createSetEmotionTool(face: NonNullable<EmbodimentContext['face']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.face.setEmotion',
    description: "Changes the robot face's displayed emotion.",
    parameters: {
      type: 'object',
      properties: {
        emotion: { type: 'string', enum: [...EmotionNames], description: 'One of the supported face emotions.' },
      },
      required: ['emotion'],
      additionalProperties: false,
    },
    execute(arguments_) {
      const name = typeof arguments_.emotion === 'string' ? arguments_.emotion : ''
      const emotion = emotionFromName(name)
      if (emotion === undefined) return failure(`unknown emotion: ${name}`)
      try {
        face.setEmotion(emotion)
        return success()
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createSetPoseTool(motion: NonNullable<EmbodimentContext['motion']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.motion.setPose',
    description: "Moves the robot's actuators to hold a target position and rotation.",
    parameters: {
      type: 'object',
      properties: {
        position: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            z: { type: 'number' },
          },
          required: ['x', 'y', 'z'],
          additionalProperties: false,
          description: 'Target position in meters.',
        },
        rotation: {
          type: 'object',
          properties: {
            r: { type: 'number', description: 'Roll in radians.' },
            p: { type: 'number', description: 'Pitch in radians.' },
            y: { type: 'number', description: 'Yaw in radians.' },
          },
          required: ['r', 'p', 'y'],
          additionalProperties: false,
        },
        time: { type: 'number', description: 'Seconds to spend reaching the pose. Defaults to an instant move.' },
      },
      required: ['position', 'rotation'],
      additionalProperties: false,
    },
    async execute(arguments_) {
      const position = asRecord(arguments_.position)
      const rotation = asRecord(arguments_.rotation)
      const x = asNumber(position?.x)
      const y = asNumber(position?.y)
      const z = asNumber(position?.z)
      const r = asNumber(rotation?.r)
      const p = asNumber(rotation?.p)
      const yaw = asNumber(rotation?.y)
      const allNumbers = [x, y, z, r, p, yaw].every((value) => value !== undefined)
      if (!allNumbers) {
        return failure('"position" (x, y, z) and "rotation" (r, p, y) must each be numbers')
      }
      const time = typeof arguments_.time === 'number' ? arguments_.time : undefined
      try {
        await motion.setPose({ position: { x, y, z }, rotation: { r, p, y: yaw } } as Pose, time)
        return success()
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createLookAtTool(motion: NonNullable<EmbodimentContext['motion']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.motion.lookAt',
    description: 'Turns the robot head to look toward a point in space.',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate in meters.' },
        y: { type: 'number', description: 'Y coordinate in meters.' },
        z: { type: 'number', description: 'Z coordinate in meters.' },
      },
      required: ['x', 'y', 'z'],
      additionalProperties: false,
    },
    execute(arguments_) {
      const x = asNumber(arguments_.x)
      const y = asNumber(arguments_.y)
      const z = asNumber(arguments_.z)
      if (x === undefined || y === undefined || z === undefined) {
        return failure('"x", "y" and "z" must be numbers')
      }
      try {
        motion.lookAt([x, y, z])
        return success()
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createLightSetTool(lighting: NonNullable<EmbodimentContext['lighting']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.light.set',
    description: "Turns one of the robot's lights on with a color, or off.",
    parameters: {
      type: 'object',
      properties: {
        led: { type: 'string', description: 'Name of the light to control. Defaults to the first available light.' },
        on: { type: 'boolean', description: 'Whether the light should be on. Defaults to true.' },
        r: { type: 'number', description: 'Red channel, 0-255. Defaults to 255.' },
        g: { type: 'number', description: 'Green channel, 0-255. Defaults to 255.' },
        b: { type: 'number', description: 'Blue channel, 0-255. Defaults to 255.' },
        duration: { type: 'number', description: 'Milliseconds the light stays on before turning off automatically.' },
      },
      additionalProperties: false,
    },
    execute(arguments_) {
      const ledNames = Object.keys(lighting.led)
      const requested = typeof arguments_.led === 'string' ? arguments_.led : undefined
      const ledName = requested && ledNames.includes(requested) ? requested : ledNames[0]
      if (!ledName) return failure('no light is available on this device')
      const on = arguments_.on !== false
      const duration = typeof arguments_.duration === 'number' ? arguments_.duration : undefined
      try {
        if (!on) {
          lighting.lightOff(ledName)
        } else {
          const r = clampByte(arguments_.r, 255)
          const g = clampByte(arguments_.g, 255)
          const b = clampByte(arguments_.b, 255)
          lighting.lightOn(ledName, r, g, b, duration)
        }
        return success({ led: ledName, on })
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createCameraCaptureTool(camera: NonNullable<EmbodimentContext['camera']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.camera.capture',
    description: 'Captures a still frame from the onboard camera and reports its metadata.',
    parameters: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Requested capture width in pixels.' },
        height: { type: 'number', description: 'Requested capture height in pixels.' },
      },
      additionalProperties: false,
    },
    async execute(arguments_) {
      const width = typeof arguments_.width === 'number' ? arguments_.width : undefined
      const height = typeof arguments_.height === 'number' ? arguments_.height : undefined
      const options = { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }
      let started = false
      try {
        await camera.start(options)
        started = true
        const frame = await camera.capture(options)
        if (!frame) return failure('camera capture returned no frame')
        try {
          return success({ width: frame.width, height: frame.height, imageType: frame.imageType })
        } finally {
          frame.close?.()
        }
      } catch (error) {
        return failure(errorMessage(error))
      } finally {
        if (started) {
          try {
            await camera.stop()
          } catch (error) {
            log(`[realtime-tools] camera stop failed: ${errorMessage(error)}\n`)
          }
        }
      }
    },
  }
}

function createReactionPlayTool(reaction: NonNullable<EmbodimentContext['reaction']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.react',
    description: 'Plays a short, named reaction gesture (face, hands, head and effect) and returns once it starts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: [...REACTION_NAMES], description: 'Which reaction to play.' },
        intensity: { type: 'number', description: 'Scales head motion amplitude, 0 to 1. Defaults to 1.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute(arguments_) {
      const name = typeof arguments_.name === 'string' ? arguments_.name : ''
      if (!(REACTION_NAMES as readonly string[]).includes(name)) return failure(`unknown reaction: ${name}`)
      const intensity = typeof arguments_.intensity === 'number' ? arguments_.intensity : undefined
      try {
        // Same permissive-shape workaround as stackchan.say: strictNullChecks is off for this
        // project, so TS does not reliably narrow the {ok:true}|{ok:false;error} union branch by
        // branch.
        const result = reaction.play(name as ReactionName, intensity !== undefined ? { intensity } : undefined) as {
          ok: boolean
          error?: string
        }
        return result.ok ? success() : failure(result.error ?? 'reaction refused')
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function createPerformancePlayTool(performance: NonNullable<EmbodimentContext['performance']>): RealtimeFunctionTool {
  return {
    type: 'function',
    name: 'stackchan.perform',
    description:
      'Plays a named, minutes-scale performance routine (speech, song, reactions and motion) and returns once it starts.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: [...PERFORMANCE_NAMES], description: 'Which performance to play.' },
        intensity: { type: 'number', description: 'Scales head motion amplitude, 0 to 1. Defaults to 1.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    execute(arguments_) {
      const name = typeof arguments_.name === 'string' ? arguments_.name : ''
      if (!(PERFORMANCE_NAMES as readonly string[]).includes(name)) return failure(`unknown performance: ${name}`)
      const intensity = typeof arguments_.intensity === 'number' ? arguments_.intensity : undefined
      try {
        const result = performance.play(
          name as PerformanceName,
          intensity !== undefined ? { intensity } : undefined,
        ) as { ok: boolean; error?: string }
        return result.ok ? success() : failure(result.error ?? 'performance refused')
      } catch (error) {
        return failure(errorMessage(error))
      }
    },
  }
}

function hasFunction<Key extends string>(
  value: unknown,
  key: Key,
): value is Record<Key, (...arguments_: unknown[]) => unknown> {
  return !!value && typeof (value as Record<string, unknown>)[key] === 'function'
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function clampByte(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(0, Math.min(255, Math.round(numeric)))
}

function success(extra?: Record<string, unknown>): ToolResult {
  return { ok: true, ...(extra ?? {}) }
}

function failure(error: string): ToolResult {
  return { ok: false, error }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
