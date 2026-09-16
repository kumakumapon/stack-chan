import assert from 'node:assert/strict'
import test from 'node:test'
import { createEchoBackend } from '../agent/echo-backend.ts'
import { createNullStt } from '../audio/stt.ts'
import { createNullTts } from '../audio/tts.ts'
import { STACKCHAN_EVENT_SCHEMA } from '../protocol/stackchan-event-v1.ts'
import { STACKCHAN_GATEWAY_SCHEMA } from '../protocol/stackchan-gateway-v1.ts'
import { createDeviceSession, type DeviceSession } from './device-session.ts'

type Frame = Record<string, unknown>

function harness(overrides: Partial<Parameters<typeof createDeviceSession>[0]> = {}) {
  const sent: Frame[] = []
  const closes: Array<{ code?: number; reason?: string }> = []
  const session: DeviceSession = createDeviceSession({
    transport: {
      send: (payload) => sent.push(JSON.parse(payload) as Frame),
      close: (code, reason) => closes.push({ code, reason }),
    },
    backend: createEchoBackend(),
    stt: createNullStt(),
    tts: createNullTts(),
    authenticate: ({ token }) => token === 'secret',
    createSessionId: () => 'session-1',
    logger: () => {},
    ...overrides,
  })
  const of = (type: string) => sent.filter((frame) => frame.type === type)
  return { session, sent, closes, of }
}

const PCM16 = { codec: 'pcm16', sampleRate: 16_000, channels: 1 }

function hello(overrides: Frame = {}): string {
  return JSON.stringify({
    schema: STACKCHAN_GATEWAY_SCHEMA,
    type: 'session.hello',
    protocolVersion: 1,
    deviceId: 'stackchan-01',
    clientId: 'client-1',
    token: 'secret',
    capabilities: { audioInput: [PCM16], audioOutput: [PCM16], embodiment: [], approval: true },
    ...overrides,
  })
}

test('a valid hello answers session.ready and opens the realtime control plane', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  const ready = of('session.ready')[0]
  assert.ok(ready, 'session.ready was not sent')
  assert.equal(ready.sessionId, 'session-1')
  assert.deepEqual(ready.audio, { input: PCM16, output: PCM16 })
  assert.equal(of('session.created').length, 1, 'session.created must follow session.ready')
  assert.equal(session.ready, true)
  assert.equal(session.deviceId, 'stackchan-01')
  await session.close()
})

test('a rejected token refuses the session instead of opening it', async () => {
  const { session, of, closes } = harness()
  await session.handleFrame(hello({ token: 'wrong' }))
  assert.equal(of('session.ready').length, 0)
  assert.equal(of('agent.error')[0]?.code, 'unauthorized')
  assert.equal(closes.length, 1)
  assert.equal(session.ready, false)
  await session.close()
})

test('a newer sideband protocol is refused rather than half-spoken', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello({ protocolVersion: 2 }))
  assert.equal(of('agent.error')[0]?.code, 'unsupportedProtocol')
  assert.equal(session.ready, false)
  await session.close()
})

test('an empty audio-format intersection is refused', async () => {
  const { session, of } = harness()
  await session.handleFrame(
    hello({
      capabilities: {
        audioInput: [{ codec: 'pcm16', sampleRate: 8_000, channels: 1 }],
        audioOutput: [PCM16],
        embodiment: [],
        approval: true,
      },
    }),
  )
  assert.equal(of('agent.error')[0]?.code, 'unsupportedAudioFormat')
  await session.close()
})

test('control-plane frames before the handshake are ignored, not crashed on', async () => {
  const { session, sent } = harness()
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )
  assert.deepEqual(sent, [])
  await session.close()
})

test('conversation.start answers conversation.result with the listening state', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )
  const result = of('conversation.result')[0]
  assert.deepEqual(result, {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'conversation.result',
    requestId: 'r1',
    success: true,
    state: 'listening',
  })
  await session.close()
})

test('session.update is acknowledged with the event id the device sent', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  await session.handleFrame(
    JSON.stringify({ type: 'session.update', event_id: 'session-7', session: { instructions: 'be brief', tools: [] } }),
  )
  assert.equal(of('session.updated')[0]?.event_id, 'session-7')
  await session.close()
})

test('a text turn round-trips through the Agent as transcripts', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )
  await session.handleFrame(JSON.stringify({ schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text: 'hello' }))
  assert.deepEqual(
    of('transcript.output').map((frame) => frame.text),
    ['echo: hello'],
  )
  await session.close()
})

test('a device-hosted tool call carries the live session.update id and consumes its output', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  await session.handleFrame(
    JSON.stringify({
      type: 'session.update',
      event_id: 'session-9',
      session: {
        instructions: '',
        tools: [
          {
            type: 'function',
            name: 'stackchan.face.setEmotion',
            description: 'set the face',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    }),
  )
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )

  // The turn blocks until the device answers the tool call, so drive both sides.
  const turn = session.handleFrame(
    JSON.stringify({ schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text: 'smile :emotion=happy' }),
  )
  await Promise.resolve()
  await Promise.resolve()
  const call = of('response.function_call_arguments.done')[0]
  assert.ok(call, 'the Gateway did not invoke the device tool')
  assert.equal(call.name, 'stackchan.face.setEmotion')
  assert.equal(
    call.stackchan_session_update_id,
    'session-9',
    'the device drops calls that do not echo the live session.update id',
  )
  await session.handleFrame(
    JSON.stringify({
      type: 'conversation.item.create',
      event_id: 'output-1',
      item: { type: 'function_call_output', call_id: call.call_id, output: '{"ok":true}' },
    }),
  )
  await turn
  assert.equal(of('transcript.output').length, 1)
  await session.close()
})

test('conversation.stop returns the session to standby', async () => {
  const { session, of } = harness()
  await session.handleFrame(hello())
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )
  await session.handleFrame(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.stop',
      requestId: 'r2',
      source: 'headTouch',
      gesture: 'backwardSwipe',
    }),
  )
  const results = of('conversation.result')
  assert.equal(results[1]?.state, 'standby')
  await session.close()
})

test('frames that are not JSON are dropped without tearing the session down', async () => {
  const { session } = harness()
  await session.handleFrame(hello())
  await session.handleFrame('not json')
  assert.equal(session.ready, true)
  await session.close()
})
