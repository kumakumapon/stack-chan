/**
 * `stackchan.gateway.v1` — the Gateway sideband.
 *
 * It carries what `stackchan.event.v1` deliberately does not: the session
 * handshake and capability negotiation, the media plane, transcripts, and
 * agent errors. Adding it as a separate schema keeps `stackchan.event.v1`
 * byte-compatible with the Android USB Dock.
 *
 * Device-hosted tool calls are NOT part of this schema; they ride the existing
 * realtime control plane (see `realtime-control.ts`). `robot.directive` is the
 * fire-and-forget variant for directives that expect no result.
 */

export const STACKCHAN_GATEWAY_SCHEMA = 'stackchan.gateway.v1'
export const STACKCHAN_GATEWAY_PROTOCOL_VERSION = 1

/** V1 media plane: PCM signed 16-bit little-endian, mono, base64 per frame. */
export type GatewayAudioFormat = {
  codec: 'pcm16'
  sampleRate: number
  channels: number
}

export const DEFAULT_INPUT_AUDIO_FORMAT: GatewayAudioFormat = { codec: 'pcm16', sampleRate: 16_000, channels: 1 }
export const DEFAULT_OUTPUT_AUDIO_FORMAT: GatewayAudioFormat = { codec: 'pcm16', sampleRate: 16_000, channels: 1 }

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

export type ResponseCancel = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'response.cancel'
  requestId: string
}
export type ResponseCancelled = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'response.cancelled'
  requestId: string
}
export type GatewayDeviceMessage = SessionHello | AudioInput | AudioInputEnd | TextInput | ResponseCancel

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

/** Reserved for future negotiation. Receivers must not execute directives; use approved tools. */
export type RobotDirective = {
  schema: typeof STACKCHAN_GATEWAY_SCHEMA
  type: 'robot.directive'
  directive: string
  params: Record<string, unknown>
}

export type GatewayServerMessage =
  | SessionReady
  | ResponseCancelled
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

export function parseGatewayDeviceMessage(value: unknown): GatewayDeviceMessage | undefined {
  if (!isGatewayEnvelope(value) || typeof value.type !== 'string') return
  switch (value.type) {
    case 'response.cancel':
      if (!isNonEmptyString(value.requestId)) return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'response.cancel', requestId: value.requestId }
    case 'session.hello': {
      if (!Number.isInteger(value.protocolVersion)) return
      if (!isNonEmptyString(value.deviceId) || !isNonEmptyString(value.clientId)) return
      if (value.token !== undefined && typeof value.token !== 'string') return
      const capabilities = parseCapabilities(value.capabilities)
      if (!capabilities) return
      const hello: SessionHello = {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'session.hello',
        protocolVersion: value.protocolVersion as number,
        deviceId: value.deviceId,
        clientId: value.clientId,
        capabilities,
      }
      if (typeof value.token === 'string') hello.token = value.token
      return hello
    }
    case 'audio.input':
      if (!Number.isInteger(value.seq) || typeof value.payload !== 'string') return
      return {
        schema: STACKCHAN_GATEWAY_SCHEMA,
        type: 'audio.input',
        seq: value.seq as number,
        payload: value.payload,
      }
    case 'audio.input.end':
      if (!Number.isInteger(value.seq)) return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.input.end', seq: value.seq as number }
    case 'text.input':
      if (typeof value.text !== 'string') return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text: value.text }
    default:
      return
  }
}

export function parseGatewayServerMessage(value: unknown): GatewayServerMessage | undefined {
  if (!isGatewayEnvelope(value) || typeof value.type !== 'string') return
  switch (value.type) {
    case 'response.cancelled':
      if (!isNonEmptyString(value.requestId)) return
      return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'response.cancelled', requestId: value.requestId }
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

export function sessionReady(ready: {
  sessionId: string
  input: GatewayAudioFormat
  output: GatewayAudioFormat
  features: GatewaySessionFeatures
}): SessionReady {
  return {
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: 'session.ready',
    protocolVersion: STACKCHAN_GATEWAY_PROTOCOL_VERSION,
    sessionId: ready.sessionId,
    audio: { input: ready.input, output: ready.output },
    features: ready.features,
  }
}

export function transcript(direction: 'input' | 'output', text: string, final: boolean): GatewayServerMessage {
  return {
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: direction === 'input' ? 'transcript.input' : 'transcript.output',
    text,
    final,
  } as TranscriptInput | TranscriptOutput
}

export function audioStarted(responseId: string, format: GatewayAudioFormat): AudioStarted {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.started', responseId, format }
}

export function audioChunk(responseId: string, seq: number, payload: string): AudioChunk {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.chunk', responseId, seq, payload }
}

export function audioCompleted(responseId: string): AudioCompleted {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'audio.completed', responseId }
}

export function agentError(code: GatewayErrorCode, message: string, fatal: boolean): AgentError {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'agent.error', code, message, fatal }
}

export function robotDirective(directive: string, params: Record<string, unknown>): RobotDirective {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, type: 'robot.directive', directive, params }
}

/**
 * Picks the first device-offered format the Gateway also supports. Returns
 * undefined when the intersection is empty, which the caller reports as
 * `unsupportedAudioFormat`.
 */
export function negotiateAudioFormat(
  offered: GatewayAudioFormat[],
  supported: GatewayAudioFormat[],
): GatewayAudioFormat | undefined {
  return offered.find((candidate) =>
    supported.some(
      (format) =>
        format.codec === candidate.codec &&
        format.sampleRate === candidate.sampleRate &&
        format.channels === candidate.channels,
    ),
  )
}

function parseAudioFormat(value: unknown): GatewayAudioFormat | undefined {
  if (!isRecord(value)) return
  if (value.codec !== 'pcm16') return
  if (!Number.isInteger(value.sampleRate) || (value.sampleRate as number) <= 0) return
  if (!Number.isInteger(value.channels) || (value.channels as number) <= 0) return
  return { codec: 'pcm16', sampleRate: value.sampleRate as number, channels: value.channels as number }
}

function parseCapabilities(value: unknown): GatewayDeviceCapabilities | undefined {
  if (!isRecord(value)) return
  const audioInput = parseAudioFormatList(value.audioInput)
  const audioOutput = parseAudioFormatList(value.audioOutput)
  if (!audioInput || !audioOutput) return
  if (!Array.isArray(value.embodiment) || !value.embodiment.every((name) => typeof name === 'string')) return
  if (typeof value.approval !== 'boolean') return
  return { audioInput, audioOutput, embodiment: [...(value.embodiment as string[])], approval: value.approval }
}

function parseAudioFormatList(value: unknown): GatewayAudioFormat[] | undefined {
  if (!Array.isArray(value)) return
  const formats: GatewayAudioFormat[] = []
  for (const entry of value) {
    const format = parseAudioFormat(entry)
    if (!format) return
    formats.push(format)
  }
  return formats
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
