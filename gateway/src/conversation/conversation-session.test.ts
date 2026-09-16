import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentBackend, AgentEvent, AgentSession } from '../agent/agent-backend.ts'
import { createApprovalController } from '../approval/approval-controller.ts'
import { createNullStt } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import { createNullTts } from '../audio/tts.ts'
import { type ConversationStart, STACKCHAN_EVENT_SCHEMA } from '../protocol/stackchan-event-v1.ts'
import { STACKCHAN_GATEWAY_SCHEMA } from '../protocol/stackchan-gateway-v1.ts'
import { createToolRegistry } from '../tools/tool-registry.ts'
import { createConversationSession } from './conversation-session.ts'

const PCM16 = { codec: 'pcm16' as const, sampleRate: 16_000, channels: 1 }

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

function harness(backend: AgentBackend, tts: TtsAdapter = createNullTts()) {
  const sent: Array<Record<string, unknown>> = []
  const session = createConversationSession({
    deviceId: 'stackchan-01',
    backend,
    registry: createToolRegistry(),
    approval: createApprovalController({ send: (event) => sent.push(event as unknown as Record<string, unknown>) }),
    stt: createNullStt(),
    tts,
    inputFormat: PCM16,
    outputFormat: PCM16,
    sendEvent: (event) => sent.push(event as unknown as Record<string, unknown>),
    sendGateway: (message) => sent.push(message as unknown as Record<string, unknown>),
    sendControl: (event) => sent.push(event),
    logger: () => {},
  })
  return { session, sent, of: (type: string) => sent.filter((frame) => frame.type === type) }
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
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(of('transcript.output')[0]?.text, 'hello')
  assert.equal(of('audio.started').length, 1)
  assert.equal(of('audio.chunk').length, 2)
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
