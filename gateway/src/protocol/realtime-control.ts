/**
 * Dock-compatible realtime control plane.
 *
 * `firmware/host/app/remote-session/realtime-session.ts` already speaks this
 * OpenAI-Realtime-shaped event set to the Android USB Dock. The Gateway speaks
 * exactly the same events over WebSocket so `RemoteConversationSession`,
 * `createRealtimeSession()`, and the device tool provider work unchanged.
 *
 * It also means device-hosted embodiment tools (`stackchan.say`,
 * `stackchan.face.setEmotion`, ...) need no sideband of their own: the device
 * advertises them in `session.update` and the Gateway invokes them with
 * `response.function_call_arguments.done`.
 */

export type RealtimeToolDeclaration = {
  type: 'function' | 'mcp'
  name?: string
  description?: string
  parameters?: Record<string, unknown>
  [key: string]: unknown
}

/** `session.update`, sent by the device whenever its tool provider changes. */
export type RealtimeSessionUpdate = {
  type: 'session.update'
  event_id: string
  session: {
    instructions: string
    tools: RealtimeToolDeclaration[]
  }
}

/** `conversation.item.create` carrying the output of a device-hosted function. */
export type RealtimeFunctionCallOutput = {
  type: 'conversation.item.create'
  event_id: string
  item: {
    type: 'function_call_output'
    call_id: string
    output: string
  }
}

/** `response.create`, the device's continuation after a function output. */
export type RealtimeResponseCreate = {
  type: 'response.create'
  event_id: string
}

export type RealtimeDeviceControlEvent = RealtimeSessionUpdate | RealtimeFunctionCallOutput | RealtimeResponseCreate

export function parseRealtimeDeviceControlEvent(value: unknown): RealtimeDeviceControlEvent | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') return
  switch (value.type) {
    case 'session.update': {
      const session = value.session
      if (!isRecord(session) || !Array.isArray(session.tools)) return
      if (typeof session.instructions !== 'string') return
      if (typeof value.event_id !== 'string') return
      const tools = session.tools.filter((tool): tool is RealtimeToolDeclaration => isRecord(tool))
      if (tools.length !== session.tools.length) return
      return {
        type: 'session.update',
        event_id: value.event_id,
        session: { instructions: session.instructions, tools },
      }
    }
    case 'conversation.item.create': {
      const item = value.item
      if (!isRecord(item) || item.type !== 'function_call_output') return
      if (typeof item.call_id !== 'string' || typeof item.output !== 'string') return
      if (typeof value.event_id !== 'string') return
      return {
        type: 'conversation.item.create',
        event_id: value.event_id,
        item: { type: 'function_call_output', call_id: item.call_id, output: item.output },
      }
    }
    case 'response.create':
      if (typeof value.event_id !== 'string') return
      return { type: 'response.create', event_id: value.event_id }
    default:
      return
  }
}

export function sessionCreated(eventId: string): Record<string, unknown> {
  return { type: 'session.created', event_id: eventId }
}

/**
 * Acknowledges a `session.update`. The device only trusts the acknowledgement
 * when `event_id` matches the update it sent, so echo it verbatim.
 */
export function sessionUpdated(eventId: string): Record<string, unknown> {
  return { type: 'session.updated', event_id: eventId }
}

/**
 * Invokes a device-hosted function tool. `stackchan_session_update_id` must
 * carry the `event_id` of the `session.update` that advertised the tool;
 * the device discards calls from a retired provider generation.
 */
export function functionCallArgumentsDone(call: {
  callId: string
  name: string
  arguments: Record<string, unknown> | string
  sessionUpdateId: string
}): Record<string, unknown> {
  return {
    type: 'response.function_call_arguments.done',
    call_id: call.callId,
    name: call.name,
    arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments),
    stackchan_session_update_id: call.sessionUpdateId,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
