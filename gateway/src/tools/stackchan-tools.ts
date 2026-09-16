/**
 * Canonical schemas for Stack-chan's built-in embodiment tools.
 *
 * The device is the source of truth for which of these it actually runs (it
 * advertises them in `session.update`); this module only supplies the richer
 * JSON-Schema descriptions an Agent needs to call them well. See
 * `mergeDeviceTools` for how the two are reconciled.
 */

import type { ToolDefinition, ToolParameterSchema } from './tool-types.ts'

export const STACKCHAN_EMBODIMENT_TOOL_NAMES: readonly string[] = [
  'stackchan.say',
  'stackchan.face.setEmotion',
  'stackchan.motion.setPose',
  'stackchan.motion.lookAt',
  'stackchan.light.set',
  'stackchan.camera.capture',
]

// Matches `Emotion`/`EmotionNames` in `firmware/host/modules/ui/state/face-state.ts`.
const EMOTIONS = ['neutral', 'angry', 'sad', 'happy', 'sleepy', 'doubtful', 'cold', 'hot'] as const

function schema(properties: ToolParameterSchema['properties'], required: string[] = []): ToolParameterSchema {
  return { type: 'object', properties, required, additionalProperties: false }
}

export function createStackchanToolSchemas(): ToolDefinition[] {
  return [
    {
      name: 'stackchan.say',
      description: 'Speaks text out loud through Stack-chan.',
      parameters: schema(
        {
          text: { type: 'string', description: 'The utterance to speak.' },
        },
        ['text'],
      ),
      host: 'device',
      permission: 'safe',
    },
    {
      name: 'stackchan.face.setEmotion',
      description: "Sets Stack-chan's facial expression.",
      parameters: schema(
        {
          emotion: { type: 'string', description: 'Expression to show.', enum: [...EMOTIONS] },
        },
        ['emotion'],
      ),
      host: 'device',
      permission: 'safe',
    },
    {
      name: 'stackchan.motion.setPose',
      description: "Turns Stack-chan's head to a fixed pose.",
      parameters: schema(
        {
          yaw: { type: 'number', description: 'Head yaw in degrees, positive is right.' },
          pitch: { type: 'number', description: 'Head pitch in degrees, positive is up.' },
          durationSeconds: { type: 'number', description: 'Time to reach the pose, in seconds.' },
        },
        ['yaw', 'pitch'],
      ),
      host: 'device',
      permission: 'safe',
    },
    {
      name: 'stackchan.motion.lookAt',
      description: 'Points Stack-chan at a target point in front of it.',
      parameters: schema(
        {
          x: { type: 'number', description: 'Target X offset in metres, positive is right.' },
          y: { type: 'number', description: 'Target Y offset in metres, positive is up.' },
          z: { type: 'number', description: 'Target Z distance in metres, positive is forward.' },
        },
        ['x', 'y', 'z'],
      ),
      host: 'device',
      permission: 'safe',
    },
    {
      name: 'stackchan.light.set',
      description: "Sets Stack-chan's ambient light color.",
      parameters: schema(
        {
          r: { type: 'number', description: 'Red channel, 0-255.' },
          g: { type: 'number', description: 'Green channel, 0-255.' },
          b: { type: 'number', description: 'Blue channel, 0-255.' },
          durationMs: { type: 'number', description: 'Crossfade time to the new color, in milliseconds.' },
        },
        ['r', 'g', 'b'],
      ),
      host: 'device',
      permission: 'safe',
    },
    {
      name: 'stackchan.camera.capture',
      description: "Captures a still image from Stack-chan's camera.",
      parameters: schema({}),
      host: 'device',
      permission: 'safe',
    },
  ]
}

/**
 * Reconciles the device's own tool advertisement with the canonical schemas.
 *
 * The device's advertisement always wins for which tools exist — it is the
 * only party that knows what it can actually run. A canonical schema fills in
 * a richer description/parameters for a name the device also advertised, but
 * a schema for a name the device did NOT advertise is dropped: the robot
 * cannot run a tool it never offered, no matter how well-documented it is.
 */
export function mergeDeviceTools(advertised: ToolDefinition[], schemas: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map(schemas.map((tool) => [tool.name, tool]))
  return advertised.map((tool) => {
    const richer = byName.get(tool.name)
    if (!richer) return tool
    return { ...tool, description: richer.description, parameters: richer.parameters }
  })
}
