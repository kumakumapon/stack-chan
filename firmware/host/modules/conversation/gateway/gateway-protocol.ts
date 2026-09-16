/**
 * Device-side codec for the `stackchan.gateway.v1` sideband.
 *
 * This file is the independently maintained device-side mirror of
 * `gateway/src/protocol/stackchan-gateway-v1.ts`. It carries the session
 * handshake, the media plane, transcripts, and agent errors — everything
 * `stackchan.event.v1` deliberately does not. Device-hosted tool calls are
 * NOT part of this schema; they ride the existing realtime control plane
 * (see `stackchan-realtime-session`). Keep the wire shapes byte-identical
 * with the Gateway package whenever either side changes.
 *
 * Pure data and validation only: no Node APIs, no Moddable-only APIs, so this
 * module runs unmodified on XS and under `node --test`.
 */

export const STACKCHAN_GATEWAY_SCHEMA = 'stackchan.gateway.v1'
export const STACKCHAN_GATEWAY_PROTOCOL_VERSION = 1

/** V1 media plane: PCM signed 16-bit little-endian, mono, base64 per frame. */
export type GatewayAudioFormat = {
  codec: 'pcm16'
  sampleRate: number
  channels: number
}

export type GatewayDeviceCapabilities = {
  /** Formats the device can send. The Gateway picks the first one it supports. */
  audioInput: GatewayAudioFormat[]
  /** Formats the device can play. The Gateway picks the first one it supports. */
  audioOutput: GatewayAudioFormat[]
  /** Embodiment tool names the device hosts, for logging and Agent prompting. */
  embodiment: string[]
  /** Whether the device can present `approval.request` and answer it. */
  approval: boolean
}

export type GatewaySessionFeatures = {
  audioInput: boolean
  audioOutput: boolean
  approval: boolean
  tools: boolean
}

export type GatewayErrorCode =
  | 'unauthorized'
  | 'unsupportedProtocol'
  | 'unsupportedAudioFormat'
  | 'agentUnavailable'
  | 'sttFailure'
  | 'ttsFailure'
  | 'toolFailure'
  | 'internal'

// ---------------------------------------------------------------------------
// Device -> Gateway
// ---------------------------------------------------------------------------

export type SessionHello = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'session.hello'
  protocolVersion: number
  deviceId: string
  clientId: string
  token?: string
  capabilities: GatewayDeviceCapabilities
}

export type AudioInput = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'audio.input'
  seq: number
  /** base64-encoded PCM frame in the negotiated input format. */
  payload: string
}

export type AudioInputEnd = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'audio.input.end'
  seq: number
}

/** Text turn injected by the device, used by the Phase 0 text MVP. */
export type TextInput = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'text.input'
  text: string
}

export type GatewayDeviceMessage = SessionHello | AudioInput | AudioInputEnd | TextInput

// ---------------------------------------------------------------------------
// Gateway -> Device
// ---------------------------------------------------------------------------

export type SessionReady = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'session.ready'
  protocolVersion: number
  sessionId: string
  audio: {
    input: GatewayAudioFormat
    output: GatewayAudioFormat
  }
  features: GatewaySessionFeatures
}

export type TranscriptInput = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'transcript.input'
  text: string
  final: boolean
}

export type TranscriptOutput = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'transcript.output'
  text: string
  final: boolean
}

export type AudioStarted = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'audio.started'
  responseId: string
  format: GatewayAudioFormat
}

export type AudioChunk = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'audio.chunk'
  responseId: string
  seq: number
  payload: string
}

export type AudioCompleted = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'audio.completed'
  responseId: string
}

export type AgentError = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'agent.error'
  code: GatewayErrorCode
  message: string
  /** A fatal error ends the Agent session; the device falls back to standby. */
  fatal: boolean
}

export type RobotDirective = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'robot.directive'
  directive: string
  params: Record<string, unknown>
}

export type GatewayServerMessage =
  | SessionReady
  | TranscriptInput
  | TranscriptOutput
  | AudioStarted
  | AudioChunk
  | AudioCompleted
  | AgentError
  | RobotDirective

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

export function isGatewayEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schema === STACKCHAN_GATEWAY_SCHEMA
}

export function parseGatewayServerMessage(value: unknown): GatewayServerMessage | undefined {
  if (!isGatewayEnvelope(value) || typeof value.type !== 'string') return
  switch (value.type) {
    case 'session.ready': {
      const audio = value.audio
      if (!isRecord(audio)) return
      const input = parseAudioFormat(audio.input)
      const output = parseAudioFormat(audio.output)
      const features = parseFeatures(value.features)
      if (!input || !output || !features) return
      if (!Number.isInteger(value.protocolVersion) || !isNonEmptyString(value.sessionId)) return
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'session.ready',
        protocolVersion: value.protocolVersion as number,
        sessionId: value.sessionId,
        audio: { input, output },
        features,
      }
    }
    case 'transcript.input':
    case 'transcript.output':
      if (typeof value.text !== 'string' || typeof value.final !== 'boolean') return
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: value.type,
        text: value.text,
        final: value.final,
      } as TranscriptInput | TranscriptOutput
    case 'audio.started': {
      const format = parseAudioFormat(value.format)
      if (!format || !isNonEmptyString(value.responseId)) return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.started', responseId: value.responseId, format }
    }
    case 'audio.chunk':
      if (!isNonEmptyString(value.responseId) || !Number.isInteger(value.seq) || typeof value.payload !== 'string') {
        return
      }
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'audio.chunk',
        responseId: value.responseId,
        seq: value.seq as number,
        payload: value.payload,
      }
    case 'audio.completed':
      if (!isNonEmptyString(value.responseId)) return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.completed', responseId: value.responseId }
    case 'agent.error':
      if (!isGatewayErrorCode(value.code) || typeof value.message !== 'string' || typeof value.fatal !== 'boolean') {
        return
      }
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'agent.error',
        code: value.code,
        message: value.message,
        fatal: value.fatal,
      }
    case 'robot.directive':
      if (!isNonEmptyString(value.directive) || !isRecord(value.params)) return
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'robot.directive',
        directive: value.directive,
        params: value.params,
      }
    default:
      return
  }
}

export function sessionHello(hello: {
  deviceId: string
  clientId: string
  token?: string
  capabilities: GatewayDeviceCapabilities
}): SessionHello {
  const message: SessionHello = {
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: 'session.hello',
    protocolVersion: STACKCHAN_GATEWAY_PROTOCOL_VERSION,
    deviceId: hello.deviceId,
    clientId: hello.clientId,
    capabilities: hello.capabilities,
  }
  if (hello.token !== undefined) message.token = hello.token
  return message
}

export function audioInput(seq: number, payload: string): AudioInput {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.input', seq, payload }
}

export function audioInputEnd(seq: number): AudioInputEnd {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.input.end', seq }
}

export function textInput(text: string): TextInput {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text }
}

function parseAudioFormat(value: unknown): GatewayAudioFormat | undefined {
  if (!isRecord(value)) return
  if (value.codec !== 'pcm16') return
  if (!Number.isInteger(value.sampleRate) || (value.sampleRate as number) <= 0) return
  if (!Number.isInteger(value.channels) || (value.channels as number) <= 0) return
  return { codec: 'pcm16', sampleRate: value.sampleRate as number, channels: value.channels as number }
}

function parseFeatures(value: unknown): GatewaySessionFeatures | undefined {
  if (!isRecord(value)) return
  const keys = ['audioInput', 'audioOutput', 'approval', 'tools'] as const
  for (const key of keys) if (typeof value[key] !== 'boolean') return
  return {
    audioInput: value.audioInput as boolean,
    audioOutput: value.audioOutput as boolean,
    approval: value.approval as boolean,
    tools: value.tools as boolean,
  }
}

function isGatewayErrorCode(value: unknown): value is GatewayErrorCode {
  return (
    value === 'unauthorized' ||
    value === 'unsupportedProtocol' ||
    value === 'unsupportedAudioFormat' ||
    value === 'agentUnavailable' ||
    value === 'sttFailure' ||
    value === 'ttsFailure' ||
    value === 'toolFailure' ||
    value === 'internal'
  )
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
