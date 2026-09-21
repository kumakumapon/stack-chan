import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBackend, AgentEvent, AgentSession } from '../agent/agent-backend.ts'
import { createApprovalController } from '../approval/approval-controller.ts'
import { encodePcm16Base64 } from '../audio/pcm.ts'
import type { SttAdapter } from '../audio/stt.ts'
import { createNullStt } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import { createNullTts } from '../audio/tts.ts'
import { type ConversationStart, STACKCHAN_EVENT_SCHEMA } from '../protocol/stackchan-event-v1.ts'
import { STACKCHAN_GATEWAY_SCHEMA } from '../protocol/stackchan-gateway-v1.ts'
import { createToolRegistry } from '../tools/tool-registry.ts'
import { createConversationSession } from './conversation-session.ts'

const PCM16 = { codec: 'pcm16' as const, sampleRate: 16_000, channels: 1 }

/** A steady tone (speech-like) or silence, matching the pattern used by audio-session.test.ts. */
function tone(samples: number, amplitude: number): string {
  const frame = new Int16Array(samples)
  for (let index = 0; index < samples; index += 1) frame[index] = index % 2 === 0 ? amplitude : -amplitude
  return encodePcm16Base64(frame)
}

/** A backend whose events the test drives by hand. */
function scriptedBackend(producesAudio: boolean) {
  let emit: ((event: AgentEvent) => void) | undefined
  const closes: number[] = []
  const backend: AgentBackend = {
    name: 'scripted',
    producesAudio,
    async createSession(options) {
      emit = options.onEvent
      const session: AgentSession = {
        async inputText() {},
        async inputAudio() {},
        async toolResult() {},
        async cancel() {},
        async close() {
          closes.push(1)
        },
      }
      return session
    },
  }
  return {
    backend,
    closes,
    emit(event: AgentEvent) {
      assert.ok(emit, 'the Agent session was never created')
      emit(event)
    },
  }
}

function harness(
  backend: AgentBackend,
  tts: TtsAdapter = createNullTts(),
  stt: SttAdapter = createNullStt(),
  logs: string[] = [],
) {
  const sent: Array<Record<string, unknown>> = []
  const session = createConversationSession({
    deviceId: 'stackchan-01',
    backend,
    registry: createToolRegistry(),
    approval: createApprovalController({ send: (event) => sent.push(event as unknown as Record<string, unknown>) }),
    stt,
    tts,
    inputFormat: PCM16,
    outputFormat: PCM16,
    sendEvent: (event) => sent.push(event as unknown as Record<string, unknown>),
    sendGateway: (message) => sent.push(message as unknown as Record<string, unknown>),
    sendControl: (event) => sent.push(event),
    logger: (message) => logs.push(message),
  })
  return { session, sent, logs, of: (type: string) => sent.filter((frame) => frame.type === type) }
}

const START: ConversationStart = {
  schema: STACKCHAN_EVENT_SCHEMA,
  type: 'conversation.start',
  requestId: 'r1',
  source: 'headTouch',
  gesture: 'forwardSwipe',
}

test('a backend that produces its own audio streams one response id with ordered chunks', async () => {
  const scripted = scriptedBackend(true)
  const { session, of } = harness(scripted.backend)
  await session.handleDeviceEvent(START)

  scripted.emit({ type: 'audio', audio: Int16Array.of(1, 2, 3, 4), sampleRate: 16_000 })
  scripted.emit({ type: 'audio', audio: Int16Array.of(5, 6, 7, 8), sampleRate: 16_000 })
  scripted.emit({ type: 'audio.done' })

  const started = of('audio.started')
  const chunks = of('audio.chunk')
  const completed = of('audio.completed')
  assert.equal(started.length, 1)
  assert.equal(chunks.length, 2)
  assert.equal(completed.length, 1)
  const responseId = started[0]?.responseId
  assert.ok(responseId)
  assert.deepEqual(
    chunks.map((chunk) => chunk.responseId),
    [responseId, responseId],
    'every chunk must belong to the response that started',
  )
  assert.deepEqual(
    chunks.map((chunk) => chunk.seq),
    [0, 1],
  )
  assert.equal(completed[0]?.responseId, responseId)
  assert.equal(session.state, 'listening')
  await session.close()
})

test('a fatal agent error blocks the conversation and closes the Agent session', async () => {
  const scripted = scriptedBackend(false)
  const { session, of } = harness(scripted.backend)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'error', code: 'agentUnavailable', message: 'gone', fatal: true })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(of('agent.error')[0]?.code, 'agentUnavailable')
  assert.equal(session.state, 'blocked')
  assert.deepEqual(scripted.closes, [1])
  await session.close()
})

test('a recoverable agent error is reported without leaving the conversation', async () => {
  const scripted = scriptedBackend(false)
  const { session, of } = harness(scripted.backend)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'error', code: 'sttFailure', message: 'retry', fatal: false })
  assert.equal(of('agent.error')[0]?.fatal, false)
  assert.notEqual(session.state, 'blocked')
  await session.close()
})

test('assistant text is synthesized when a TTS adapter is configured', async () => {
  const scripted = scriptedBackend(false)
  const tts: TtsAdapter = {
    name: 'fake',
    sampleRate: 16_000,
    async *synthesize() {
      yield { audio: Int16Array.of(1, 2), sampleRate: 16_000 }
      yield { audio: Int16Array.of(3, 4), sampleRate: 16_000 }
    },
  }
  const { session, of } = harness(scripted.backend, tts)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  for (let i = 0; i < 100 && !of('audio.completed').length; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('transcript.output')[0]?.text, 'hello')
  assert.equal(of('audio.started').length, 1)
  assert.equal(of('audio.chunk').length, 2)
  assert.equal(of('audio.completed').length, 1)
  await session.close()
})

test('assistant audio prebuffers 200 ms before real-time packet pacing', async () => {
  const scripted = scriptedBackend(false)
  const tts: TtsAdapter = {
    name: 'prebuffered',
    sampleRate: 16_000,
    async *synthesize() {
      for (let index = 0; index < 11; index++) yield { audio: new Int16Array(320), sampleRate: 16_000 }
    },
  }
  const { session, of } = harness(scripted.backend, tts)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  for (let index = 0; index < 100 && of('audio.chunk').length < 11; index++) await Promise.resolve()
  assert.equal(of('audio.chunk').length, 11, 'the first 220 ms is available to the device before pacing waits')
  assert.equal(of('audio.completed').length, 0, 'the eleventh packet is paced after the prebuffer')
  for (let index = 0; index < 100 && !of('audio.completed').length; index++)
    await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('audio.completed').length, 1)
  await session.close()
})

test('a TTS failure is reported and the conversation keeps going', async () => {
  const scripted = scriptedBackend(false)
  const tts: TtsAdapter = {
    name: 'failing',
    sampleRate: 16_000,
    // biome-ignore lint/correctness/useYield: the adapter fails before producing a chunk
    async *synthesize() {
      throw new Error('synthesis refused')
    },
  }
  const { session, of } = harness(scripted.backend, tts)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('agent.error')[0]?.code, 'ttsFailure')
  assert.notEqual(session.state, 'blocked')
  await session.close()
})

test('a text turn before conversation.start is ignored', async () => {
  const scripted = scriptedBackend(false)
  const { session, sent } = harness(scripted.backend)
  await session.handleGatewayMessage({ schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text: 'hello' })
  assert.deepEqual(sent, [])
  await session.close()
})

test('interrupt aborts synthesis, drops late audio and permits another turn', async () => {
  const scripted = scriptedBackend(false)
  let resume!: () => void, signal: AbortSignal | undefined
  const { session, of } = harness(scripted.backend, {
    name: 'delayed',
    sampleRate: 16000,
    async *synthesize(_text, currentSignal) {
      signal = currentSignal
      yield { audio: new Int16Array(320), sampleRate: 16000 }
      await new Promise<void>((resolve) => {
        resume = resolve
      })
      yield { audio: new Int16Array(320), sampleRate: 16000 }
    },
  })
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  for (let i = 0; i < 100 && !resume; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('audio.chunk').length, 1, 'playback can begin while synthesis is still pending')
  await session.handleGatewayMessage({
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: 'response.cancel',
    requestId: 'cancel-1',
  })
  assert.equal(signal?.aborted, true)
  assert.equal(of('response.cancelled')[0]?.requestId, 'cancel-1')
  resume()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(of('audio.chunk').length, 1)
  assert.equal(of('audio.completed').length, 0)
  assert.equal(of('agent.error').length, 0)
  assert.equal(session.state, 'listening')
  await session.close()
})

test('a full 512 ms prebuffer is burst out without a pacing wait', async () => {
  const scripted = scriptedBackend(false)
  // 25 frames * 20 ms = 500 ms, still under the 512 ms prebuffer window.
  const FRAME_COUNT = 25
  const tts: TtsAdapter = {
    name: 'prebuffer-512',
    sampleRate: 16_000,
    async *synthesize() {
      for (let index = 0; index < FRAME_COUNT; index++) yield { audio: new Int16Array(320), sampleRate: 16_000 }
    },
  }
  const { session, of } = harness(scripted.backend, tts)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  for (let index = 0; index < 200 && of('audio.chunk').length < FRAME_COUNT; index++) await Promise.resolve()
  assert.equal(of('audio.chunk').length, FRAME_COUNT, 'the whole prebuffer window is sent without a pacing wait')
  await session.close()
})

test('every frame is sent, in order, once pacing continues past the prebuffer', async () => {
  const scripted = scriptedBackend(false)
  // 25 prebuffered frames (500 ms) plus 2 frames that must wait for real-time pacing.
  const FRAME_COUNT = 27
  const tts: TtsAdapter = {
    name: 'paced',
    sampleRate: 16_000,
    async *synthesize() {
      for (let index = 0; index < FRAME_COUNT; index++) yield { audio: new Int16Array(320), sampleRate: 16_000 }
    },
  }
  const { session, of } = harness(scripted.backend, tts)
  await session.handleDeviceEvent(START)
  scripted.emit({ type: 'text', text: 'hello', final: true })
  for (let index = 0; index < 300 && !of('audio.completed').length; index++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(of('audio.completed').length, 1, 'pacing must not stall indefinitely past the prebuffer')
  const chunks = of('audio.chunk')
  assert.equal(chunks.length, FRAME_COUNT)
  assert.deepEqual(
    chunks.map((chunk) => chunk.seq),
    Array.from({ length: FRAME_COUNT }, (_, index) => index),
    'frames must arrive in order with no gaps or duplicates',
  )
  await session.close()
})

test('reply latency is logged with timings and a frame count, never transcript text', async () => {
  const scripted = scriptedBackend(false)
  const REPLY_TEXT = 'a private reply the log must not contain'
  const UTTERANCE_TEXT = 'a private utterance the log must not contain'
  const tts: TtsAdapter = {
    name: 'latency',
    sampleRate: 16_000,
    async *synthesize() {
      yield { audio: new Int16Array(320), sampleRate: 16_000 }
      yield { audio: new Int16Array(320), sampleRate: 16_000 }
    },
  }
  const stt: SttAdapter = {
    name: 'fixed',
    async transcribe() {
      return { text: UTTERANCE_TEXT, final: true }
    },
  }
  const logs: string[] = []
  const { session, of } = harness(scripted.backend, tts, stt, logs)
  await session.handleDeviceEvent(START)

  // Speech, then enough silence to release the VAD and trigger STT -> onUtterance.
  for (let index = 0; index < 10; index++)
    await session.handleGatewayMessage({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'audio.input',
      seq: index,
      payload: tone(1_600, 12_000),
    })
  for (let index = 10; index < 30; index++)
    await session.handleGatewayMessage({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'audio.input',
      seq: index,
      payload: tone(1_600, 0),
    })
  assert.equal(of('transcript.input')[0]?.text, UTTERANCE_TEXT)

  // The scripted backend does not auto-reply; simulate the agent's final transcript.
  scripted.emit({ type: 'text', text: REPLY_TEXT, final: true })
  for (let index = 0; index < 100 && !of('audio.completed').length; index++)
    await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('audio.completed').length, 1)

  const latencyLogs = logs.filter((line) => line.startsWith('[gateway] reply latency'))
  assert.equal(latencyLogs.length, 1)
  const match = latencyLogs[0]?.match(
    /^\[gateway\] reply latency agent=(\d+) ms first-audio=(\d+) ms total=(\d+) ms frames=(\d+)$/,
  )
  assert.ok(match, `unexpected log format: ${latencyLogs[0]}`)
  const [, agentMs, firstAudioMs, totalMs, frames] = match as unknown as [string, string, string, string, string]
  assert.ok(Number(agentMs) >= 0)
  assert.ok(Number(firstAudioMs) >= Number(agentMs), 'first audio cannot precede the agent becoming ready')
  assert.ok(Number(totalMs) >= Number(firstAudioMs), 'the total cannot be shorter than the time to first audio')
  assert.equal(frames, '2')

  assert.ok(
    logs.every((line) => !line.includes(REPLY_TEXT) && !line.includes(UTTERANCE_TEXT)),
    'transcript or reply text must never reach the logger',
  )
  await session.close()
})

test('an interrupted turn logs no reply latency for the cancelled utterance', async () => {
  const scripted = scriptedBackend(false)
  const stt: SttAdapter = {
    name: 'fixed',
    async transcribe() {
      return { text: 'cancel me', final: true }
    },
  }
  const logs: string[] = []
  const { session, of } = harness(scripted.backend, createNullTts(), stt, logs)
  await session.handleDeviceEvent(START)

  for (let index = 0; index < 10; index++)
    await session.handleGatewayMessage({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'audio.input',
      seq: index,
      payload: tone(1_600, 12_000),
    })
  for (let index = 10; index < 30; index++)
    await session.handleGatewayMessage({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'audio.input',
      seq: index,
      payload: tone(1_600, 0),
    })
  assert.equal(of('transcript.input').length, 1)

  await session.handleGatewayMessage({
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: 'response.cancel',
    requestId: 'cancel-1',
  })
  // The reply that eventually arrives belongs to a generation already cancelled.
  scripted.emit({ type: 'text', text: 'too late', final: true })
  await new Promise((resolve) => setTimeout(resolve, 20))

  assert.deepEqual(
    logs.filter((line) => line.startsWith('[gateway] reply latency')),
    [],
  )
  await session.close()
})
