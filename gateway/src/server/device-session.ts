/**
 * One connected Stack-chan.
 *
 * Owns the `session.hello` -> `session.ready` handshake, authentication and
 * audio-format negotiation, then demultiplexes the three planes that share the
 * socket onto the approval controller and the conversation session.
 */

import type { AgentBackend } from '../agent/agent-backend.ts'
import { createApprovalController } from '../approval/approval-controller.ts'
import type { SttAdapter } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import type { VadOptions } from '../audio/vad.ts'
import { type ConversationSession, createConversationSession } from '../conversation/conversation-session.ts'
import { parseRealtimeDeviceControlEvent, sessionCreated } from '../protocol/realtime-control.ts'
import {
  isStackchanEventEnvelope,
  parseStackchanDeviceEvent,
  type StackchanGatewayEvent,
} from '../protocol/stackchan-event-v1.ts'
import {
  agentError,
  DEFAULT_INPUT_AUDIO_FORMAT,
  DEFAULT_OUTPUT_AUDIO_FORMAT,
  type GatewayAudioFormat,
  type GatewayServerMessage,
  isGatewayEnvelope,
  negotiateAudioFormat,
  parseGatewayDeviceMessage,
  STACKCHAN_GATEWAY_PROTOCOL_VERSION,
  sessionReady,
} from '../protocol/stackchan-gateway-v1.ts'
import { createStackchanToolSchemas } from '../tools/stackchan-tools.ts'
import { createToolRegistry, type ToolPolicy } from '../tools/tool-registry.ts'
import type { ToolDefinition } from '../tools/tool-types.ts'

export type DeviceTransport = {
  send(payload: string): void
  close(code?: number, reason?: string): void
}

export type DeviceAuthenticator = (credentials: { deviceId: string; clientId: string; token?: string }) => boolean

export type DeviceSessionOptions = {
  transport: DeviceTransport
  backend: AgentBackend
  stt: SttAdapter
  tts: TtsAdapter
  authenticate: DeviceAuthenticator
  /** Gateway-hosted tools (MCP servers, built-ins) shared by every session. */
  gatewayTools?: ToolDefinition[]
  instructions?: string
  policy?: ToolPolicy
  supportedInputFormats?: GatewayAudioFormat[]
  supportedOutputFormats?: GatewayAudioFormat[]
  approvalTimeoutMs?: number
  /** Forwarded to each conversation's `createAudioSession`. See `config.ts`'s `audio` section. */
  maxUtteranceSeconds?: number
  vad?: Omit<VadOptions, 'sampleRate'>
  /** Forwarded to each conversation session. See `config.ts`'s `diagnostics.logTranscripts`. */
  logTranscripts?: boolean
  logger?(message: string): void
  createSessionId?(): string
  scheduler?: { set(callback: () => void, milliseconds: number): unknown; clear(handle: unknown): void }
}

export type DeviceSession = {
  readonly deviceId?: string
  readonly sessionId?: string
  readonly ready: boolean
  handleFrame(payload: string): Promise<void>
  close(): Promise<void>
}

export function createDeviceSession(options: DeviceSessionOptions): DeviceSession {
  const logger = options.logger ?? (() => {})
  const supportedInput = options.supportedInputFormats ?? [DEFAULT_INPUT_AUDIO_FORMAT]
  const supportedOutput = options.supportedOutputFormats ?? [DEFAULT_OUTPUT_AUDIO_FORMAT]
  const createSessionId = options.createSessionId ?? (() => `gateway-${Math.random().toString(16).slice(2, 10)}`)

  let deviceId: string | undefined
  let sessionId: string | undefined
  let conversation: ConversationSession | undefined
  let closed = false

  const send = (message: unknown) => {
    if (closed) return
    try {
      options.transport.send(JSON.stringify(message))
    } catch (error) {
      logger(`[gateway] send failed: ${errorMessage(error)}`)
    }
  }
  const sendGateway = (message: GatewayServerMessage) => send(message)
  const sendEvent = (event: StackchanGatewayEvent) => send(event)

  const approval = createApprovalController({
    send: sendEvent,
    ...(options.approvalTimeoutMs === undefined ? {} : { timeoutMs: options.approvalTimeoutMs }),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  })

  const refuse = (code: Parameters<typeof agentError>[0], message: string) => {
    sendGateway(agentError(code, message, true))
    logger(`[gateway] refused a device session: ${message}`)
    options.transport.close(1008, code)
  }

  const handshake = (hello: ReturnType<typeof parseGatewayDeviceMessage>) => {
    if (hello?.type !== 'session.hello') return false
    if (hello.protocolVersion > STACKCHAN_GATEWAY_PROTOCOL_VERSION) {
      refuse('unsupportedProtocol', `stackchan.gateway.v${hello.protocolVersion} is newer than this Gateway`)
      return true
    }
    if (
      !options.authenticate({
        deviceId: hello.deviceId,
        clientId: hello.clientId,
        ...(hello.token === undefined ? {} : { token: hello.token }),
      })
    ) {
      refuse('unauthorized', 'the device token was rejected')
      return true
    }
    const input = negotiateAudioFormat(hello.capabilities.audioInput, supportedInput)
    const output = negotiateAudioFormat(hello.capabilities.audioOutput, supportedOutput)
    if (!input || !output) {
      refuse('unsupportedAudioFormat', 'no shared PCM format between the device and the Gateway')
      return true
    }

    deviceId = hello.deviceId
    sessionId = createSessionId()
    const registry = createToolRegistry()
    if (options.gatewayTools) registry.registerAll(options.gatewayTools)
    conversation = createConversationSession({
      deviceId: hello.deviceId,
      backend: options.backend,
      registry,
      approval,
      stt: options.stt,
      tts: options.tts,
      inputFormat: input,
      outputFormat: output,
      embodimentSchemas: createStackchanToolSchemas(),
      sendEvent,
      sendGateway,
      sendControl: send,
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
      ...(options.policy ? { policy: options.policy } : {}),
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      ...(options.maxUtteranceSeconds === undefined ? {} : { maxUtteranceSeconds: options.maxUtteranceSeconds }),
      ...(options.vad ? { vad: options.vad } : {}),
      ...(options.logTranscripts === undefined ? {} : { logTranscripts: options.logTranscripts }),
      logger,
    })

    sendGateway(
      sessionReady({
        sessionId,
        input,
        output,
        features: {
          audioInput: true,
          audioOutput: options.tts.name !== 'null',
          approval: hello.capabilities.approval,
          tools: true,
        },
      }),
    )
    // Only now does the realtime control plane open: the device answers
    // `session.created` with `session.update`, which is what advertises its
    // embodiment tools.
    send(sessionCreated(`${sessionId}-created`))
    logger(`[gateway] device ${hello.deviceId} is ready as session ${sessionId}`)
    return true
  }

  return {
    get deviceId() {
      return deviceId
    },
    get sessionId() {
      return sessionId
    },
    get ready() {
      return conversation !== undefined
    },
    async handleFrame(payload) {
      if (closed) return
      let value: unknown
      try {
        value = JSON.parse(payload) as unknown
      } catch {
        logger('[gateway] dropped a frame that is not JSON')
        return
      }

      if (isGatewayEnvelope(value)) {
        const message = parseGatewayDeviceMessage(value)
        if (!message) {
          logger('[gateway] dropped a malformed stackchan.gateway.v1 frame')
          return
        }
        if (message.type === 'session.hello') {
          if (conversation) {
            logger('[gateway] ignored a second session.hello on a live connection')
            return
          }
          handshake(message)
          return
        }
        if (!conversation) {
          logger(`[gateway] ignored ${message.type} before the handshake completed`)
          return
        }
        await conversation.handleGatewayMessage(message)
        return
      }

      if (isStackchanEventEnvelope(value)) {
        const event = parseStackchanDeviceEvent(value)
        if (!event) {
          logger('[gateway] dropped a malformed stackchan.event.v1 frame')
          return
        }
        if (approval.handleDeviceEvent(event)) return
        if (!conversation) {
          logger(`[gateway] ignored ${event.type} before the handshake completed`)
          return
        }
        if (!(await conversation.handleDeviceEvent(event))) {
          logger(`[gateway] no handler for ${event.type}`)
        }
        return
      }

      const control = parseRealtimeDeviceControlEvent(value)
      if (!control) return
      if (!conversation) {
        logger(`[gateway] ignored ${control.type} before the handshake completed`)
        return
      }
      await conversation.handleControlEvent(control)
    },
    async close() {
      if (closed) return
      closed = true
      approval.close()
      await conversation?.close()
      conversation = undefined
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
