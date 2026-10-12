import type { ToolDefinition } from '../tools/tool-types.ts'

export const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'sleepy', 'doubtful'] as const
const GESTURES = ['none', 'yes', 'no'] as const
const GAZES = ['front', 'left', 'right', 'none'] as const
export type RobotReply = {
  text: string
  emotion: (typeof EMOTIONS)[number]
  gesture: (typeof GESTURES)[number]
  gaze: (typeof GAZES)[number]
}
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    emotion: { type: 'string', enum: [...EMOTIONS] },
    gesture: { type: 'string', enum: [...GESTURES] },
    gaze: { type: 'string', enum: [...GAZES] },
  },
  required: ['text', 'emotion', 'gesture', 'gaze'],
  additionalProperties: false,
}

export function parseReply(raw: string): RobotReply {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    throw new Error('LLMが会話用JSONを返しませんでした。対応モデルと接続設定を確認してください')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LLMの返答形式が不正です')
  const reply = value as Record<string, unknown>
  if (typeof reply.text !== 'string' || !reply.text.trim() || reply.text.length > 600)
    throw new Error('LLMの返答は1〜600文字である必要があります')
  if (!EMOTIONS.includes(reply.emotion as RobotReply['emotion'])) throw new Error('LLMの表情が不正です')
  if (!GESTURES.includes(reply.gesture as RobotReply['gesture'])) throw new Error('LLMの動作が不正です')
  if (!GAZES.includes(reply.gaze as RobotReply['gaze'])) throw new Error('LLMの視線が不正です')
  return {
    text: reply.text.trim(),
    emotion: reply.emotion as RobotReply['emotion'],
    gesture: reply.gesture as RobotReply['gesture'],
    gaze: reply.gaze as RobotReply['gaze'],
  }
}

/** Only bounded gestures and advertised tools; never model-supplied servo coordinates. */
export function replyTools(reply: RobotReply, tools: ToolDefinition[]) {
  const advertised = new Set(tools.filter((tool) => tool.host === 'device').map((tool) => tool.name))
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  if (advertised.has('stackchan.face.setEmotion'))
    calls.push({ name: 'stackchan.face.setEmotion', arguments: { emotion: reply.emotion } })
  if (reply.gaze !== 'none' && advertised.has('stackchan.motion.lookAt'))
    calls.push({
      name: 'stackchan.motion.lookAt',
      arguments: { x: reply.gaze === 'left' ? -0.08 : reply.gaze === 'right' ? 0.08 : 0, y: 0, z: 0.5 },
    })
  if (reply.gesture !== 'none' && advertised.has('stackchan.react'))
    calls.push({ name: 'stackchan.react', arguments: { name: reply.gesture, intensity: 0.3 } })
  return calls
}
