/**
 * One conversation with one Stack-chan.
 *
 * The session owns the `RemoteConversationState` machine, the Agent session
 * lifetime, and the three planes that reach the robot:
 *   - `stackchan.event.v1`  control plane (conversation.*, approval.*, task.status)
 *   - the realtime control plane the Dock already speaks (session.update,
 *     function calls, function outputs)
 *   - the `stackchan.gateway.v1` sideband (transcripts, media, agent errors)
 *
 * It deliberately knows nothing about WebSockets: `server/device-session.ts`
 * owns the transport and hands parsed messages in.
 */

import { setTimeout as delay } from 'node:timers/promises'
import type { AgentBackend, AgentEvent, AgentSession } from '../agent/agent-backend.ts'
import type { ApprovalController } from '../approval/approval-controller.ts'
import type { SttAdapter } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import {
  functionCallArgumentsDone,
  type RealtimeDeviceControlEvent,
  sessionUpdated,
} from '../protocol/realtime-control.ts'
import {
  conversationResult,
  type RemoteConversationState,
  type StackchanDeviceEvent,
  type StackchanGatewayEvent,
} from '../protocol/stackchan-event-v1.ts'
import {
  agentError,
  audioChunk,
  audioCompleted,
  audioStarted,
  type GatewayAudioFormat,
  type GatewayDeviceMessage,
  type GatewayServerMessage,
  transcript,
} from '../protocol/stackchan-gateway-v1.ts'
import { mergeDeviceTools } from '../tools/stackchan-tools.ts'
import { createToolInvoker } from '../tools/tool-invoker.ts'
import type { ToolPolicy, ToolRegistry } from '../tools/tool-registry.ts'
import { toolsFromRealtimeDeclarations } from '../tools/tool-registry.ts'
import type { ToolDefinition } from '../tools/tool-types.ts'
import { type AudioSession, createAudioSession } from './audio-session.ts'

/** How long the Gateway waits for a device-hosted tool to answer. */
const DEVICE_TOOL_TIMEOUT_MILLISECONDS = 15_000

export type ConversationSessionOptions = {
  deviceId: string
  backend: AgentBackend
  registry: ToolRegistry
  approval: ApprovalController
  stt: SttAdapter
  tts: TtsAdapter
  inputFormat: GatewayAudioFormat
  outputFormat: GatewayAudioFormat
  instructions?: string
  policy?: ToolPolicy
  /** Embodiment schemas that enrich whatever the device advertises. */
  embodimentSchemas?: ToolDefinition[]
  sendEvent(event: StackchanGatewayEvent): void
  sendGateway(message: GatewayServerMessage): void
  sendControl(event: Record<string, unknown>): void
  scheduler?: { set(callback: () => void, milliseconds: number): unknown; clear(handle: unknown): void }
  logger?(message: string): void
  createId?(prefix: string): string
}

export type ConversationSession = {
  readonly state: RemoteConversationState
  /** Returns true when the event belonged to this session. */
  handleDeviceEvent(event: StackchanDeviceEvent): Promise<boolean>
  handleControlEvent(event: RealtimeDeviceControlEvent): Promise<void>
  handleGatewayMessage(message: GatewayDeviceMessage): Promise<void>
  close(): Promise<void>
}

type PendingDeviceCall = {
  resolve(output: unknown): void
  timer: unknown
}

export function createConversationSession(options: ConversationSessionOptions): ConversationSession {
  const logger = options.logger ?? (() => {})
  const scheduler = options.scheduler ?? defaultScheduler
  const createId = options.createId ?? defaultIdFactory()

  let state: RemoteConversationState = 'standby'
  let agent: AgentSession | undefined
  let closed = false
  let generation = 0
  let sessionGeneration = 0
  let cancelling = false
  let speechController = new AbortController()
  /** `event_id` of the last `session.update` we acknowledged. The device drops
   *  function calls that do not echo it, so every call must carry it. */
  let sessionUpdateId: string | undefined
  let deviceInstructions = ''
  const pendingDeviceCalls = new Map<string, PendingDeviceCall>()
  let audio: AudioSession | undefined
  let speaking = false
  /** Set while a backend that produces its own audio is streaming a turn. */
  let agentResponseId: string | undefined
  let audioSequence = 0

  const setState = (next: RemoteConversationState) => {
    state = next
  }

  const invoker = createToolInvoker({
    registry: options.registry,
    approval: options.approval,
    policy: options.policy,
    logger,
    invokeDeviceTool: (call) =>
      new Promise<unknown>((resolve) => {
        if (!sessionUpdateId) {
          resolve({ ok: false, error: 'the device has not advertised a tool session yet' })
          return
        }
        const timer = scheduler.set(() => {
          pendingDeviceCalls.delete(call.callId)
          resolve({ ok: false, error: `device tool ${call.name} timed out` })
        }, DEVICE_TOOL_TIMEOUT_MILLISECONDS)
        pendingDeviceCalls.set(call.callId, { resolve, timer })
        options.sendControl(
          functionCallArgumentsDone({
            callId: call.callId,
            name: call.name,
            arguments: call.arguments,
            sessionUpdateId,
          }),
        )
      }),
  })

  const emitAgentError = (event: Extract<AgentEvent, { type: 'error' }>) => {
    options.sendGateway(agentError(event.code, event.message, event.fatal))
    if (event.fatal) {
      setState('blocked')
      void stopConversation()
    }
  }

  const speakText = async (text: string) => {
    if (!text || closed || cancelling) return
    const currentGeneration = generation
    const signal = speechController.signal
    const responseId = createId('response')
    let seq = 0
    let started = false
    try {
      for await (const chunk of options.tts.synthesize(text, signal)) {
        if (closed || currentGeneration !== generation) return
        if (!started) {
          started = true
          speaking = true
          setState('speaking')
          options.sendGateway(audioStarted(responseId, options.outputFormat))
        }
        const pcm = Buffer.from(encodeChunk(chunk.audio, chunk.sampleRate, options.outputFormat), 'base64')
        // Pace 20 ms packets so a fast synthesizer cannot fill the device queue
        // with an entire utterance before the first samples have played.
        const frameBytes = Math.floor(options.outputFormat.sampleRate / 50) * 2
        for (let offset = 0; offset < pcm.length; offset += frameBytes) {
          if (closed || currentGeneration !== generation) return
          const frame = pcm.subarray(offset, offset + frameBytes)
          options.sendGateway(audioChunk(responseId, seq++, frame.toString('base64')))
          await delay((frame.length * 500) / options.outputFormat.sampleRate, undefined, { signal })
        }
      }
    } catch (error) {
      if (closed || currentGeneration !== generation) return
      options.sendGateway(agentError('ttsFailure', errorMessage(error), false))
    }
    if (closed || currentGeneration !== generation) return
    if (started) {
      options.sendGateway(audioCompleted(responseId))
      speaking = false
    }
    if (state !== 'blocked' && state !== 'standby') setState('listening')
  }

  const handleAgentEvent = (event: AgentEvent) => {
    if (closed || cancelling || !agent) return
    switch (event.type) {
      case 'transcript':
        options.sendGateway(transcript(event.direction, event.text, event.final))
        if (event.direction === 'input' && state !== 'blocked' && state !== 'standby') setState('recognizing')
        break
      case 'text':
        options.sendGateway(transcript('output', event.text, event.final))
        if (event.final) void speakText(event.text)
        else if (state !== 'blocked' && state !== 'standby') setState('speaking')
        break
      case 'audio': {
        if (!agentResponseId) {
          agentResponseId = createId('response')
          audioSequence = 0
          speaking = true
          setState('speaking')
          options.sendGateway(audioStarted(agentResponseId, options.outputFormat))
        }
        options.sendGateway(
          audioChunk(
            agentResponseId,
            audioSequence++,
            encodeChunk(event.audio, event.sampleRate, options.outputFormat),
          ),
        )
        break
      }
      case 'audio.done':
        if (agentResponseId) {
          options.sendGateway(audioCompleted(agentResponseId))
          agentResponseId = undefined
          speaking = false
          if (state !== 'blocked' && state !== 'standby') setState('listening')
        }
        break
      case 'tool.call':
        void runToolCall(event.callId, event.name, event.arguments)
        break
      case 'turn.done':
        if (!speaking && state !== 'blocked' && state !== 'standby') setState('listening')
        break
      case 'error':
        emitAgentError(event)
        break
    }
  }

  const runToolCall = async (callId: string, name: string, parameters: Record<string, unknown>) => {
    const currentGeneration = generation
    const currentAgent = agent
    const outcome = await invoker.invoke({ callId, name, arguments: parameters }, speechController.signal)
    if (closed || !agent || agent !== currentAgent || generation !== currentGeneration) return
    const result =
      outcome.status === 'ok'
        ? outcome.result
        : { ok: false, error: outcome.message, declined: outcome.status === 'declined' }
    try {
      await agent.toolResult(callId, result)
    } catch (error) {
      logger(`[gateway] tool result delivery failed: ${errorMessage(error)}`)
    }
  }

  const startConversation = async (requestId: string) => {
    if (agent) {
      options.sendEvent(conversationResult(requestId, true, state === 'standby' ? 'listening' : state))
      return
    }
    setState('connecting')
    const currentSession = ++sessionGeneration
    try {
      const createdAgent = await options.backend.createSession({
        deviceId: options.deviceId,
        instructions: joinInstructions(options.instructions, deviceInstructions),
        tools: options.registry.snapshot(),
        inputSampleRate: options.inputFormat.sampleRate,
        onEvent: (event) => {
          if (currentSession === sessionGeneration) handleAgentEvent(event)
        },
      })
      if (closed || currentSession !== sessionGeneration) {
        await createdAgent.close()
        return
      }
      agent = createdAgent
    } catch (error) {
      if (closed || currentSession !== sessionGeneration) return
      setState('blocked')
      options.sendGateway(agentError('agentUnavailable', errorMessage(error), true))
      options.sendEvent(conversationResult(requestId, false, 'blocked', errorMessage(error)))
      return
    }
    audio = createAudioSession({
      stt: options.stt,
      inputFormat: options.inputFormat,
      onUtterance: async (text) => {
        if (!agent || closed || cancelling || currentSession !== sessionGeneration) return
        options.sendGateway(transcript('input', text, true))
        setState('recognizing')
        await agent.inputText(text)
      },
      onError: (message) => options.sendGateway(agentError('sttFailure', message, false)),
      logger,
    })
    setState('listening')
    options.sendEvent(conversationResult(requestId, true, 'listening'))
  }

  const interruptConversation = async (requestId: string) => {
    if (closed || cancelling) return
    cancelling = true
    generation++
    speechController.abort()
    speechController = new AbortController()
    audio?.reset()
    speaking = false
    agentResponseId = undefined
    for (const [callId, pending] of pendingDeviceCalls) {
      scheduler.clear(pending.timer)
      pending.resolve({ ok: false, error: 'response cancelled' })
      pendingDeviceCalls.delete(callId)
    }
    const currentSession = sessionGeneration
    try {
      await agent?.cancel()
      if (closed || currentSession !== sessionGeneration) return
      setState(agent ? 'listening' : 'standby')
      options.sendGateway({ schema: 'stackchan.gateway.v1', type: 'response.cancelled', requestId })
    } catch (error) {
      emitAgentError({ type: 'error', code: 'agentUnavailable', message: errorMessage(error), fatal: true })
    } finally {
      cancelling = false
    }
  }

  const stopConversation = async (requestId?: string) => {
    sessionGeneration++
    generation++
    speechController.abort()
    speechController = new AbortController()
    const current = agent
    agent = undefined
    audio?.reset()
    audio = undefined
    speaking = false
    agentResponseId = undefined
    for (const [callId, pending] of pendingDeviceCalls) {
      scheduler.clear(pending.timer)
      pending.resolve({ ok: false, error: 'the conversation ended before the tool answered' })
      pendingDeviceCalls.delete(callId)
    }
    if (current) {
      try {
        await current.close()
      } catch (error) {
        logger(`[gateway] agent session close failed: ${errorMessage(error)}`)
      }
    }
    if (state !== 'blocked') setState('standby')
    if (requestId) options.sendEvent(conversationResult(requestId, true, state))
  }

  return {
    get state() {
      return state
    },
    async handleDeviceEvent(event) {
      if (event.type === 'conversation.start') {
        await startConversation(event.requestId)
        return true
      }
      if (event.type === 'conversation.stop') {
        await stopConversation(event.requestId)
        return true
      }
      return false
    },
    async handleControlEvent(event) {
      switch (event.type) {
        case 'session.update': {
          sessionUpdateId = event.event_id
          deviceInstructions = event.session.instructions
          const advertised = toolsFromRealtimeDeclarations(event.session.tools)
          options.registry.unregisterHost('device')
          options.registry.registerAll(mergeDeviceTools(advertised, options.embodimentSchemas ?? []))
          // Acknowledge only after the registry reflects the new generation, so
          // a function call racing the acknowledgement can never hit a stale tool.
          options.sendControl(sessionUpdated(event.event_id))
          // An Agent session is given its tool list when it is created, so a
          // tool generation that arrives mid-conversation reaches the Agent at
          // the next conversation.start. In practice the device advertises its
          // tools in answer to session.created, long before the first start.
          if (agent) logger('[gateway] a new device tool generation applies from the next conversation')
          break
        }
        case 'conversation.item.create': {
          const pending = pendingDeviceCalls.get(event.item.call_id)
          if (!pending) {
            logger(`[gateway] ignored a device tool output with no pending call: ${event.item.call_id}`)
            break
          }
          pendingDeviceCalls.delete(event.item.call_id)
          scheduler.clear(pending.timer)
          pending.resolve(parseMaybeJson(event.item.output))
          break
        }
        case 'response.create':
          // The device asks the Agent to continue after a function output. The
          // Agent backend already resumes on toolResult(), so there is nothing
          // to forward; acknowledging it would be a protocol invention.
          break
      }
    },
    async handleGatewayMessage(message) {
      switch (message.type) {
        case 'response.cancel':
          await interruptConversation(message.requestId)
          break
        case 'text.input':
          if (!agent || cancelling) return
          options.sendGateway(transcript('input', message.text, true))
          setState('recognizing')
          await agent.inputText(message.text)
          break
        case 'audio.input':
          if (!agent || !audio || cancelling) return
          await audio.pushFrame(message.payload)
          break
        case 'audio.input.end':
          if (!agent || !audio || cancelling) return
          await audio.flush()
          break
        case 'session.hello':
          // The handshake is owned by the device session; reaching here means a
          // second hello on a live connection, which is a protocol error.
          logger('[gateway] ignored a duplicate session.hello')
          break
      }
    },
    async close() {
      if (closed) return
      closed = true
      await stopConversation()
    },
  }
}

function encodeChunk(audio: Int16Array, sampleRate: number, target: GatewayAudioFormat): string {
  const resampled = sampleRate === target.sampleRate ? audio : resample(audio, sampleRate, target.sampleRate)
  const bytes = new Uint8Array(resampled.length * 2)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < resampled.length; index += 1) view.setInt16(index * 2, resampled[index] ?? 0, true)
  return Buffer.from(bytes).toString('base64')
}

function resample(frame: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate || frame.length === 0) return frame
  const ratio = toRate / fromRate
  const length = Math.max(1, Math.round(frame.length * ratio))
  const output = new Int16Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index / ratio
    const left = Math.floor(position)
    const right = Math.min(frame.length - 1, left + 1)
    const weight = position - left
    output[index] = Math.round((frame[left] ?? 0) * (1 - weight) + (frame[right] ?? 0) * weight)
  }
  return output
}

function joinInstructions(gateway?: string, device?: string): string | undefined {
  const parts = [gateway, device].filter((part): part is string => typeof part === 'string' && part.length > 0)
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function parseMaybeJson(output: string): unknown {
  try {
    return JSON.parse(output) as unknown
  } catch {
    return output
  }
}

function defaultIdFactory(): (prefix: string) => string {
  let sequence = 0
  return (prefix) => {
    sequence = (sequence + 1) >>> 0
    return `${prefix}-${sequence.toString(16)}`
  }
}

const defaultScheduler = {
  set(callback: () => void, milliseconds: number): unknown {
    const handle = setTimeout(callback, milliseconds)
    if (typeof handle.unref === 'function') handle.unref()
    return handle
  },
  clear(handle: unknown): void {
    clearTimeout(handle as NodeJS.Timeout)
  },
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
