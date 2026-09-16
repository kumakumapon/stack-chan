/**
 * Agent Backend boundary.
 *
 * The Gateway owns sessions, media, tools and approval; a backend owns nothing
 * but the intelligence. Anything an Agent wants to reach the robot with is
 * expressed as an `AgentEvent`, so adding OpenAI, Gemini, Hermes or a local LLM
 * never touches the conversation or transport layers.
 */

import type { GatewayErrorCode } from '../protocol/stackchan-gateway-v1.ts'
import type { ToolDefinition } from '../tools/tool-types.ts'

export type AgentTextEvent = {
  type: 'text'
  /** Incremental assistant text. `final` marks the end of the turn's text. */
  text: string
  final: boolean
}

export type AgentAudioEvent = {
  type: 'audio'
  /** PCM16 mono frame at `sampleRate`. */
  audio: Int16Array
  sampleRate: number
}

export type AgentAudioDoneEvent = {
  type: 'audio.done'
}

export type AgentTranscriptEvent = {
  type: 'transcript'
  direction: 'input' | 'output'
  text: string
  final: boolean
}

export type AgentToolCallEvent = {
  type: 'tool.call'
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export type AgentTurnDoneEvent = {
  type: 'turn.done'
}

export type AgentErrorEvent = {
  type: 'error'
  code: GatewayErrorCode
  message: string
  fatal: boolean
}

export type AgentEvent =
  | AgentTextEvent
  | AgentAudioEvent
  | AgentAudioDoneEvent
  | AgentTranscriptEvent
  | AgentToolCallEvent
  | AgentTurnDoneEvent
  | AgentErrorEvent

export type AgentSessionOptions = {
  /** Stable id of the Stack-chan this session serves. */
  deviceId: string
  /** System prompt assembled by the Gateway from config plus device context. */
  instructions?: string
  /** Every tool the Agent may call, device-hosted and Gateway-hosted alike. */
  tools: ToolDefinition[]
  /** Sample rate of the frames passed to `inputAudio`. */
  inputSampleRate: number
  /** Emits Agent output back into the conversation session. */
  onEvent(event: AgentEvent): void
  /** Aborts an in-flight turn when the session closes. */
  signal?: AbortSignal
}

export type AgentSession = {
  /** Feeds a completed user utterance as text. */
  inputText(text: string): Promise<void>
  /** Feeds a PCM16 mono frame. Backends without native audio return without doing anything. */
  inputAudio(audio: Int16Array): Promise<void>
  /** Signals the end of a user utterance for backends that do their own turn detection. */
  endAudio?(): Promise<void>
  /** Returns the result of a tool the Agent asked for. */
  toolResult(callId: string, result: unknown): Promise<void>
  /** Cancels the in-flight turn, leaving the session usable. */
  cancel(): Promise<void>
  close(): Promise<void>
}

export type AgentBackend = {
  readonly name: string
  /** True when the backend produces assistant audio itself, so the Gateway skips TTS. */
  readonly producesAudio: boolean
  createSession(options: AgentSessionOptions): Promise<AgentSession>
}
