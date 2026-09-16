import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationState, StackchanContext } from 'capabilities'
import type { GatewayBridge } from 'stackchan-gateway-bridge'
import type { GatewayServerMessage } from 'stackchan-gateway-protocol'
import type { RealtimeEventBridge } from 'stackchan-realtime-session'
import { installGatewayDockTestAliases } from './__tests__/node-aliases.js'
import type { GatewayPresentation } from './presentation.js'
import type { GatewayRemoteRuntime } from './runtime.js'

installGatewayDockTestAliases()

const { STACKCHAN_GATEWAY_SCHEMA } = await import('../../../modules/conversation/gateway/gateway-protocol.js')
const { createGatewayDockRuntime, gatewayConversationState } = await import('./runtime.js')

const PCM16 = { codec: 'pcm16' as const, sampleRate: 16_000, channels: 1 }

function sideband(
  message: Partial<GatewayServerMessage> & { type: GatewayServerMessage['type'] },
): GatewayServerMessage {
  return { schema: STACKCHAN_GATEWAY_SCHEMA, ...message } as GatewayServerMessage
}

test('transcripts and audio drive the conversation state only while a conversation is live', () => {
  const cases: Array<[GatewayServerMessage['type'], RemoteConversationState, RemoteConversationState | undefined]> = [
    ['transcript.input', 'listening', 'recognizing'],
    ['transcript.output', 'recognizing', 'speaking'],
    ['audio.started', 'recognizing', 'speaking'],
    ['audio.completed', 'speaking', 'listening'],
    // standby and blocked are owned by the control plane; the sideband must not
    // drag a stopped or failed conversation back into a running state.
    ['transcript.input', 'standby', undefined],
    ['audio.completed', 'blocked', undefined],
  ]
  for (const [type, current, expected] of cases) {
    const message =
      type === 'audio.started'
        ? sideband({ type, responseId: 'r', format: PCM16 })
        : type === 'audio.completed'
          ? sideband({ type, responseId: 'r' })
          : sideband({ type, text: 'hi', final: true })
    assert.equal(gatewayConversationState(message, current), expected, `${type} from ${current}`)
  }
})

test('a fatal agent error blocks the conversation and a recoverable one does not', () => {
  const fatal = sideband({ type: 'agent.error', code: 'agentUnavailable', message: 'down', fatal: true })
  const recoverable = sideband({ type: 'agent.error', code: 'sttFailure', message: 'retry', fatal: false })
  assert.equal(gatewayConversationState(fatal, 'listening'), 'blocked')
  assert.equal(gatewayConversationState(recoverable, 'listening'), undefined)
})

type Harness = ReturnType<typeof harness>

function harness(options: { presentationEnabled?: boolean; autoStart?: boolean } = {}) {
  let sidebandHandler: ((message: GatewayServerMessage) => void) | undefined
  const closed: string[] = []
  const states: Array<{ state: RemoteConversationState; error?: string }> = []
  const presented: string[] = []
  let speakLocally: boolean | undefined
  let conversationState: RemoteConversationState = 'listening'

  const bridge: GatewayBridge = {
    transportState: 'ready',
    setEventHandler() {},
    setTransportStateHandler() {},
    sendEvent: async () => 'queued',
    sendGatewayMessage: () => 'queued',
    setSidebandHandler(handler) {
      sidebandHandler = handler
    },
    close() {
      closed.push('bridge')
    },
  }

  const remoteRuntime: GatewayRemoteRuntime = {
    activate() {
      return {
        remoteConversationSession: {
          get state() {
            return conversationState
          },
          lastError: undefined,
          transportState: 'ready',
          requestStart: () => 'start-1',
          requestStop: () => 'stop-1',
          subscribe: () => () => undefined,
          subscribeTransport: () => () => undefined,
        },
        updateConversationState(state, error) {
          conversationState = state
          states.push({ state, error })
        },
        close() {
          closed.push('activation')
        },
      }
    },
    close() {
      closed.push('runtime')
    },
  }

  const presentation: GatewayPresentation = {
    setSpeakLocally(enabled) {
      speakLocally = enabled
    },
    onInputTranscript: (text) => presented.push(`in:${text}`),
    onOutputTranscript: (text) => presented.push(`out:${text}`),
    onAudioStarted: () => presented.push('audio:start'),
    onAudioChunk: () => presented.push('audio:chunk'),
    onAudioCompleted: () => presented.push('audio:end'),
    onAgentError: (message) => presented.push(`error:${message}`),
    close() {
      closed.push('presentation')
    },
  }

  const runtime = createGatewayDockRuntime(
    { enabled: true, autoStart: options.autoStart ?? false, presentationEnabled: options.presentationEnabled ?? true },
    {
      createBridge: () => bridge,
      createRemoteRuntime: (_bridge: RealtimeEventBridge) => remoteRuntime,
      createRealtimeToolProvider: () => ({ tools: [] }),
      createPresentation: () => presentation,
    },
  )

  return {
    runtime,
    closed,
    states,
    presented,
    emit(message: GatewayServerMessage) {
      sidebandHandler?.(message)
    },
    get sidebandBound() {
      return sidebandHandler !== undefined
    },
    get speakLocally() {
      return speakLocally
    },
  }
}

const context = {} as StackchanContext

test('activation cannot happen before the context is attached', () => {
  const dock: Harness = harness()
  assert.throws(() => dock.runtime.remoteConversationSession?.activate(), /context is attached/)
  dock.runtime.close()
})

test('activation binds the sideband and deactivation releases it', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  assert.equal(dock.sidebandBound, false)
  dock.runtime.remoteConversationSession?.activate()
  assert.equal(dock.sidebandBound, true)
  dock.runtime.remoteConversationSession?.deactivate()
  assert.equal(dock.sidebandBound, false)
  assert.ok(dock.closed.includes('presentation'))
  assert.ok(dock.closed.includes('activation'))
  dock.runtime.close()
})

test('sideband messages update the conversation state and reach the presentation', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.emit(sideband({ type: 'transcript.input', text: 'good morning', final: true }))
  dock.emit(sideband({ type: 'audio.started', responseId: 'r1', format: PCM16 }))
  dock.emit(sideband({ type: 'audio.chunk', responseId: 'r1', seq: 0, payload: 'AAAA' }))
  dock.emit(sideband({ type: 'audio.completed', responseId: 'r1' }))
  assert.deepEqual(
    dock.states.map((entry) => entry.state),
    ['recognizing', 'speaking', 'listening'],
  )
  assert.deepEqual(dock.presented, ['in:good morning', 'audio:start', 'audio:chunk', 'audio:end'])
  dock.runtime.close()
})

test('session.ready decides whether the robot speaks the output transcript itself', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.emit(
    sideband({
      type: 'session.ready',
      protocolVersion: 1,
      sessionId: 's1',
      audio: { input: PCM16, output: PCM16 },
      features: { audioInput: true, audioOutput: true, approval: true, tools: true },
    }),
  )
  assert.equal(dock.speakLocally, false, 'the Gateway streams audio, so the robot must not also speak')
  dock.emit(
    sideband({
      type: 'session.ready',
      protocolVersion: 1,
      sessionId: 's2',
      audio: { input: PCM16, output: PCM16 },
      features: { audioInput: true, audioOutput: false, approval: true, tools: true },
    }),
  )
  assert.equal(dock.speakLocally, true, 'without Gateway TTS the robot reads the transcript')
  dock.runtime.close()
})

test('a fatal agent error carries its message into the blocked state', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.emit(sideband({ type: 'agent.error', code: 'agentUnavailable', message: 'the Agent is down', fatal: true }))
  assert.deepEqual(dock.states, [{ state: 'blocked', error: 'the Agent is down' }])
  dock.runtime.close()
})

test('presentationEnabled false still activates and still tracks state', () => {
  const dock: Harness = harness({ presentationEnabled: false })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.emit(sideband({ type: 'transcript.input', text: 'hi', final: true }))
  assert.deepEqual(dock.presented, [])
  assert.deepEqual(
    dock.states.map((entry) => entry.state),
    ['recognizing'],
  )
  dock.runtime.close()
})

test('close tears down the activation, the remote runtime and the bridge', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.runtime.close()
  assert.deepEqual(dock.closed, ['presentation', 'activation', 'runtime', 'bridge'])
  dock.runtime.close()
  assert.deepEqual(dock.closed, ['presentation', 'activation', 'runtime', 'bridge'], 'close must be idempotent')
})

test('a second context attachment is refused', () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  assert.throws(() => dock.runtime.onContextCreated(context), /already attached/)
  dock.runtime.close()
})
