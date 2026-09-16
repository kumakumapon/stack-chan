import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_TOOL_PARAMETERS, type ToolDefinition } from '../tools/tool-types.ts'
import type { AgentEvent } from './agent-backend.ts'
import { createEchoBackend } from './echo-backend.ts'

const EMOTION_TOOL: ToolDefinition = {
  name: 'stackchan.face.setEmotion',
  parameters: EMPTY_TOOL_PARAMETERS,
  host: 'device',
  permission: 'safe',
}

async function openSession(tools: ToolDefinition[] = []) {
  const events: AgentEvent[] = []
  const backend = createEchoBackend()
  const session = await backend.createSession({
    deviceId: 'device-1',
    tools,
    inputSampleRate: 16_000,
    onEvent: (event) => events.push(event),
  })
  return { session, events }
}

test('backend identity', () => {
  const backend = createEchoBackend()
  assert.equal(backend.name, 'echo')
  assert.equal(backend.producesAudio, false)
})

test('inputText emits transcript, then prefixed text, then turn.done', async () => {
  const { session, events } = await openSession()
  await session.inputText('hello there')
  assert.deepEqual(events, [
    { type: 'transcript', direction: 'input', text: 'hello there', final: true },
    { type: 'text', text: 'echo: hello there', final: true },
    { type: 'turn.done' },
  ])
})

test('a custom prefix is used verbatim', async () => {
  const events: AgentEvent[] = []
  const backend = createEchoBackend({ prefix: 'stackchan says: ' })
  const session = await backend.createSession({
    deviceId: 'device-1',
    tools: [],
    inputSampleRate: 16_000,
    onEvent: (event) => events.push(event),
  })
  await session.inputText('hi')
  assert.equal(events[1]?.type, 'text')
  assert.equal(events[1]?.type === 'text' ? events[1].text : undefined, 'stackchan says: hi')
})

test('inputAudio buffers frames; endAudio reports the total sample count', async () => {
  const { session, events } = await openSession()
  await session.inputAudio(new Int16Array(10))
  await session.inputAudio(new Int16Array(6))
  assert.equal(events.length, 0) // buffering is silent
  await session.endAudio?.()
  assert.equal(events.length, 3)
  assert.equal(events[0]?.type, 'transcript')
  assert.match(events[0]?.type === 'transcript' ? events[0].text : '', /16 samples/)
  assert.equal(events[2]?.type, 'turn.done')
})

test('a tool-call-triggering text emits tool.call and text, but turn.done waits for toolResult', async () => {
  const { session, events } = await openSession([EMOTION_TOOL])
  const turnPromise = session.inputText('be happy :emotion=happy please')

  // Give the microtask queue a turn so everything up to the tool wait has run.
  await Promise.resolve()
  await Promise.resolve()

  // transcript, tool.call and text are all emitted before the wait; only turn.done is held back.
  assert.equal(events.length, 3)
  assert.equal(events[0]?.type, 'transcript')
  const toolCall = events[1]
  assert.equal(toolCall?.type, 'tool.call')
  assert.equal(toolCall?.type === 'tool.call' ? toolCall.name : undefined, 'stackchan.face.setEmotion')
  assert.deepEqual(toolCall?.type === 'tool.call' ? toolCall.arguments : undefined, { emotion: 'happy' })
  assert.equal(events[2]?.type, 'text')

  const callId = toolCall?.type === 'tool.call' ? toolCall.callId : ''
  await session.toolResult(callId, { ok: true })
  await turnPromise

  assert.equal(events.length, 4)
  assert.equal(events[3]?.type, 'turn.done')
})

test('without the emotion tool present, :emotion= text is just echoed, no tool.call', async () => {
  const { session, events } = await openSession([]) // tool not offered
  await session.inputText('be happy :emotion=happy please')
  assert.equal(events.length, 3)
  assert.equal(
    events.some((event) => event.type === 'tool.call'),
    false,
  )
})

test('cancel() and close() leave the session usable / clear buffered audio', async () => {
  const { session, events } = await openSession()
  await session.inputAudio(new Int16Array(5))
  await session.cancel()
  await session.endAudio?.()
  assert.match(events[0]?.type === 'transcript' ? events[0].text : '', /0 samples/)
})
