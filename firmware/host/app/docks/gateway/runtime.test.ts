import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteConversationState, StackchanContext } from 'capabilities'
import type { GatewayBridge } from 'stackchan-gateway-bridge'
import type { GatewayServerMessage } from 'stackchan-gateway-protocol'
import type { RealtimeEventBridge } from 'stackchan-realtime-session'
import { installGatewayDockTestAliases } from './__tests__/node-aliases.js'
import { type GatewayPresentation, LOCAL_SPEECH_ERROR_NAME } from './presentation.js'
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

function harness(
  options: { presentationEnabled?: boolean; autoStart?: boolean; microphone?: boolean; playback?: Promise<void> } = {},
) {
  let sidebandHandler: ((message: GatewayServerMessage) => void) | undefined
  const closed: string[] = []
  const states: Array<{ state: RemoteConversationState; error?: string }> = []
  const presented: string[] = []
  let speakLocally: boolean | undefined
  let conversationState: RemoteConversationState = 'listening'
  let stateListener = () => {}
  const disconnectListeners = new Set<() => void>()
  let tick = () => {}
  let timerSequence = 0
  const timers = new Set<number>()
  let frame: ((payload: string) => void) | undefined
  let audioActive = false
  let microphoneRunning = false
  let sendResult: 'queued' | 'overflow' | 'disconnected' = 'queued'
  let audioClears = 0
  const sent: object[] = []

  const bridge: GatewayBridge = {
    transportState: 'ready',
    setEventHandler() {},
    setTransportStateHandler() {},
    sendEvent: async () => 'queued',
    sendGatewayMessage: (message) => {
      if (message.type === 'audio.input' && sendResult !== 'queued') return sendResult
      sent.push(message)
      return 'queued'
    },
    clearPendingAudio() {
      audioClears++
    },
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
          subscribe: (listener) => {
            stateListener = () => listener(conversationState)
            return () => {
              stateListener = () => {}
            }
          },
          subscribeTransport(listener) {
            const callback = () => listener('disconnected')
            disconnectListeners.add(callback)
            return () => {
              disconnectListeners.delete(callback)
            }
          },
        },
        updateConversationState(state, error) {
          conversationState = state
          states.push({ state, error })
          stateListener()
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
    onOutputTranscript: (text) => {
      presented.push(`out:${text}`)
      return options.playback
    },
    onAudioStarted: () => presented.push('audio:start'),
    onAudioChunk: () => presented.push('audio:chunk'),
    onAudioCompleted: () => {
      presented.push('audio:end')
    },
    onAgentError: (message) => presented.push(`error:${message}`),
    interrupt: () => {
      presented.push('interrupt')
    },
    close() {
      closed.push('presentation')
    },
  }

  const runtime = createGatewayDockRuntime(
    {
      enabled: true,
      autoStart: options.autoStart ?? false,
      presentationEnabled: options.presentationEnabled ?? true,
      microphone: options.microphone,
    },
    {
      createBridge: () => bridge,
      createRemoteRuntime: (_bridge: RealtimeEventBridge) => remoteRuntime,
      createRealtimeToolProvider: () => ({ tools: [] }),
      createPresentation: () => presentation,
      scheduler: {
        set(callback) {
          const id = ++timerSequence
          timers.add(id)
          tick = () => {
            if (!timers.delete(id)) return
            callback()
          }
          return id
        },
        clear(handle) {
          assert.ok(timers.delete(handle as number), 'cannot clear an expired or already cleared timer')
        },
      },
      isAudioActive: () => audioActive,
      createMicrophone(onFrame) {
        frame = onFrame
        return {
          start() {
            microphoneRunning = true
          },
          stop() {
            microphoneRunning = false
          },
        }
      },
    },
  )

  return {
    runtime,
    closed,
    states,
    presented,
    sent,
    setSendResult(result: typeof sendResult) {
      sendResult = result
    },
    get audioClears() {
      return audioClears
    },
    tick: () => tick(),
    disconnect: () => {
      for (const listener of disconnectListeners) listener()
    },
    frame: () => frame?.('AAAA'),
    setAudioActive(value: boolean) {
      audioActive = value
    },
    get microphoneRunning() {
      return microphoneRunning
    },
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

test('microphone pauses for capacity and retries one frame before resuming', () => {
  const dock = harness({ microphone: true })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.setSendResult('overflow')
  dock.frame()
  assert.equal(dock.microphoneRunning, false)
  for (let i = 0; i < 10; i++) dock.frame()
  dock.tick()
  assert.equal(
    dock.states.some(({ state }) => state === 'blocked'),
    false,
  )
  dock.setSendResult('queued')
  dock.tick()
  assert.equal(dock.microphoneRunning, true)
  const audio = dock.sent.filter((message) => (message as { type: string }).type === 'audio.input')
  assert.equal(audio.length, 1, 'only the first rejected frame is retained')
  assert.equal((audio[0] as { seq: number }).seq, 0, 'retry preserves sequence')
  assert.equal(
    dock.sent.some((message) => (message as { type: string }).type === 'audio.input.end'),
    false,
  )
  dock.runtime.close()
})

test('stopping or disconnecting while backpressured discards retained audio', () => {
  for (const action of ['stop', 'disconnect']) {
    const dock = harness({ microphone: true })
    dock.runtime.onContextCreated(context)
    dock.runtime.remoteConversationSession?.activate()
    enableAudio(dock)
    dock.setSendResult('overflow')
    dock.frame()
    const cleared = dock.audioClears
    if (action === 'stop') dock.runtime.remoteConversationSession?.deactivate()
    else dock.disconnect()
    assert.ok(dock.audioClears > cleared)
    dock.setSendResult('queued')
    dock.tick()
    assert.equal(dock.microphoneRunning, false)
    assert.equal(
      dock.sent.some((message) => (message as { type: string }).type === 'audio.input'),
      false,
    )
    dock.runtime.close()
  }
})

test('persistent microphone backpressure has a bounded retry budget', () => {
  const dock = harness({ microphone: true })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.setSendResult('overflow')
  dock.frame()
  for (let i = 0; i < 300; i++) dock.tick()
  assert.equal(dock.microphoneRunning, false)
  assert.ok(dock.states.some(({ state, error }) => state === 'blocked' && error?.includes('send wait timeout')))
  dock.runtime.close()
})

test('interruption gates input until its acknowledgement and ignores stale audio', async () => {
  let finish!: () => void
  const dock = harness({
    microphone: true,
    playback: new Promise<void>((resolve) => {
      finish = resolve
    }),
  })
  dock.runtime.onContextCreated(context)
  const session = dock.runtime.remoteConversationSession
  assert.ok(session)
  session.activate()
  enableAudio(dock)
  dock.emit(sideband({ type: 'transcript.output', text: 'old', final: true }))
  session.interrupt?.()
  assert.ok(dock.presented.includes('interrupt'))
  const request = dock.sent.find((message) => (message as { type: string }).type === 'response.cancel') as {
    requestId: string
  }
  assert.ok(request)
  finish()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.microphoneRunning, false)
  dock.emit(sideband({ type: 'response.cancelled', requestId: 'unrelated' }))
  assert.equal(dock.microphoneRunning, false)
  dock.emit(sideband({ type: 'audio.started', responseId: 'old', format: PCM16 }))
  assert.equal(dock.presented.includes('audio:start'), false)
  dock.emit(sideband({ type: 'response.cancelled', requestId: request.requestId }))
  assert.equal(session.state, 'listening')
  assert.equal(dock.microphoneRunning, true)
  dock.emit(sideband({ type: 'audio.chunk', responseId: 'old', seq: 0, payload: 'AAAA' }))
  assert.equal(dock.presented.includes('audio:chunk'), false)
  dock.runtime.close()
})

function enableAudio(dock: Harness) {
  dock.emit(
    sideband({
      type: 'session.ready',
      protocolVersion: 1,
      sessionId: 's',
      audio: { input: PCM16, output: PCM16 },
      features: { audioInput: true, audioOutput: false, approval: true, tools: true },
    }),
  )
}

test('microphone requires opt-in and negotiated audio input', () => {
  for (const enabled of [false, true]) {
    const dock = harness({ microphone: enabled })
    dock.runtime.onContextCreated(context)
    dock.runtime.remoteConversationSession?.activate()
    assert.equal(dock.microphoneRunning, false)
    enableAudio(dock)
    assert.equal(dock.microphoneRunning, enabled)
    dock.runtime.close()
    assert.equal(dock.microphoneRunning, false)
  }
})

test('half duplex pauses capture for local audio and waits for actual TTS completion', async () => {
  let finish!: () => void
  const playback = new Promise<void>((resolve) => {
    finish = resolve
  })
  const dock = harness({ microphone: true, playback })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.frame()
  assert.equal(dock.sent.length, 1)
  dock.setAudioActive(true)
  dock.tick()
  assert.equal(dock.microphoneRunning, false)
  dock.frame()
  assert.equal(dock.sent.length, 2, 'only audio.input.end was added')
  dock.setAudioActive(false)
  dock.tick()
  assert.equal(dock.microphoneRunning, true)
  dock.emit(sideband({ type: 'transcript.input', text: 'hello', final: true }))
  assert.equal(dock.microphoneRunning, false)
  dock.emit(sideband({ type: 'transcript.output', text: 'こんにちは', final: true }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.runtime.remoteConversationSession?.state, 'speaking')
  assert.equal(dock.microphoneRunning, false)
  finish()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.runtime.remoteConversationSession?.state, 'listening')
  assert.equal(dock.microphoneRunning, true)
  dock.runtime.remoteConversationSession?.deactivate()
  const count = dock.sent.length
  dock.frame()
  dock.tick()
  assert.equal(dock.microphoneRunning, false)
  assert.equal(dock.sent.length, count, 'no late frames after deactivation')
  dock.runtime.close()
})

test('completion of a stopped reply cannot reactivate the microphone', async () => {
  let finish!: () => void
  const dock = harness({
    microphone: true,
    playback: new Promise<void>((resolve) => {
      finish = resolve
    }),
  })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.emit(sideband({ type: 'transcript.output', text: 'hello', final: true }))
  dock.runtime.remoteConversationSession?.deactivate()
  finish()
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.runtime.remoteConversationSession?.activationState, 'inactive')
  assert.equal(dock.microphoneRunning, false)
  dock.runtime.close()
})

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

test('sideband messages update the conversation state and reach the presentation', async () => {
  const dock: Harness = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.emit(sideband({ type: 'transcript.input', text: 'good morning', final: true }))
  dock.emit(sideband({ type: 'audio.started', responseId: 'r1', format: PCM16 }))
  dock.emit(sideband({ type: 'audio.chunk', responseId: 'r1', seq: 0, payload: 'AAAA' }))
  dock.emit(sideband({ type: 'audio.completed', responseId: 'r1' }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.deepEqual(
    dock.states.map((entry) => entry.state),
    ['recognizing', 'speaking', 'listening'],
  )
  assert.deepEqual(dock.presented, ['in:good morning', 'interrupt', 'audio:start', 'audio:chunk', 'audio:end'])
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

test('disconnect clears a pending interrupt barrier so a reconnected stream is accepted', () => {
  const dock = harness()
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  dock.runtime.remoteConversationSession?.interrupt?.()
  dock.disconnect()
  dock.emit(sideband({ type: 'audio.started', responseId: 'new-connection', format: PCM16 }))
  dock.emit(sideband({ type: 'audio.chunk', responseId: 'new-connection', seq: 0, payload: 'AAAA' }))
  assert.ok(dock.presented.includes('audio:chunk'))
  dock.runtime.close()
})

test('a reply the local engine cannot pronounce keeps the conversation listening', async () => {
  // Error 105 means this one reply had no reading. The Gateway link and the
  // microphone are untouched, and `blocked` is terminal for capture, so the
  // conversation has to survive it.
  const failure = new Error('text->koe conversion failed (105)')
  failure.name = LOCAL_SPEECH_ERROR_NAME
  const playback = Promise.reject(failure)
  playback.catch(() => {})
  const dock = harness({ microphone: true, playback })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.emit(sideband({ type: 'transcript.output', text: 'こんにちは', final: true }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.runtime.remoteConversationSession?.state, 'listening')
  assert.deepEqual(dock.states.at(-1), { state: 'listening', error: 'text->koe conversion failed (105)' })
  assert.equal(dock.microphoneRunning, true, 'the next turn can still be recorded')
  dock.runtime.close()
})

test('a playback failure that is not local speech still blocks the conversation', async () => {
  const playback = Promise.reject(new Error('Gateway audio queue overflow'))
  playback.catch(() => {})
  const dock = harness({ microphone: true, playback })
  dock.runtime.onContextCreated(context)
  dock.runtime.remoteConversationSession?.activate()
  enableAudio(dock)
  dock.emit(sideband({ type: 'transcript.output', text: 'こんにちは', final: true }))
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(dock.runtime.remoteConversationSession?.state, 'blocked')
  assert.equal(dock.microphoneRunning, false)
  dock.runtime.close()
})
