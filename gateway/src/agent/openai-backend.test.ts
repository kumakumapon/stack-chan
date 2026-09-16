import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ToolDefinition } from '../tools/tool-types.ts'
import type { AgentEvent } from './agent-backend.ts'
import { createOpenAiBackend } from './openai-backend.ts'

const WEATHER_TOOL: ToolDefinition = {
  name: 'get_weather',
  description: 'Gets the weather',
  parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  host: 'gateway',
  permission: 'safe',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

async function openSession(
  fetchImpl: typeof fetch,
  tools: ToolDefinition[] = [],
): Promise<{
  session: Awaited<ReturnType<ReturnType<typeof createOpenAiBackend>['createSession']>>
  events: AgentEvent[]
}> {
  const events: AgentEvent[] = []
  const backend = createOpenAiBackend({ apiKey: 'sk-test', fetchImpl })
  const session = await backend.createSession({
    deviceId: 'device-1',
    tools,
    inputSampleRate: 16_000,
    onEvent: (event) => events.push(event),
  })
  return { session, events }
}

test('backend identity', () => {
  const backend = createOpenAiBackend({ apiKey: 'sk-test' })
  assert.equal(backend.name, 'openai')
  assert.equal(backend.producesAudio, false)
})

test('a plain answer emits one text event then turn.done', async () => {
  const calls: unknown[] = []
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push(JSON.parse(init?.body as string))
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'Hi there!' } }] })
  }
  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)

  await session.inputText('hello')
  await flush()

  assert.deepEqual(events, [{ type: 'text', text: 'Hi there!', final: true }, { type: 'turn.done' }])
  assert.equal(calls.length, 1)
})

test('one tool-call round: tool.call is emitted, turn.done waits for toolResult, then a follow-up request is sent', async () => {
  const bodies: Array<Record<string, unknown>> = []
  let call = 0
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(init?.body as string)
    bodies.push(body)
    call++
    if (call === 1) {
      return jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'call-1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
              ],
            },
          },
        ],
      })
    }
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'It is sunny in Tokyo.' } }] })
  }

  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch, [WEATHER_TOOL])
  await session.inputText('what is the weather in Tokyo?')
  await flush()

  assert.equal(events.length, 1)
  const toolCall = events[0]
  assert.equal(toolCall?.type, 'tool.call')
  assert.equal(toolCall?.type === 'tool.call' ? toolCall.name : undefined, 'get_weather')
  assert.deepEqual(toolCall?.type === 'tool.call' ? toolCall.arguments : undefined, { city: 'Tokyo' })

  await session.toolResult('call-1', { tempF: 72 })
  await flush()

  assert.equal(events.length, 3)
  assert.equal(events[1]?.type, 'text')
  assert.equal(events[1]?.type === 'text' ? events[1].text : undefined, 'It is sunny in Tokyo.')
  assert.equal(events[2]?.type, 'turn.done')

  // The second request must carry the assistant tool_calls message and the tool result.
  assert.equal(bodies.length, 2)
  const secondMessages = bodies[1]?.messages as Array<Record<string, unknown>>
  const toolMessage = secondMessages.find((m) => m.role === 'tool')
  assert.equal(toolMessage?.tool_call_id, 'call-1')
  assert.equal(toolMessage?.content, JSON.stringify({ tempF: 72 }))
})

test('an HTTP failure maps to an error event (agentUnavailable, non-fatal) then turn.done', async () => {
  const fetchImpl = async (): Promise<Response> =>
    new Response('server exploded', { status: 500, statusText: 'Server Error' })
  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)

  await session.inputText('hello')
  await flush()

  assert.equal(events.length, 2)
  const error = events[0]
  assert.equal(error?.type, 'error')
  assert.equal(error?.type === 'error' ? error.code : undefined, 'agentUnavailable')
  assert.equal(error?.type === 'error' ? error.fatal : undefined, false)
  assert.match(error?.type === 'error' ? error.message : '', /500/)
  assert.equal(events[1]?.type, 'turn.done')
})

test('a transport-level throw also maps to a non-fatal agentUnavailable error', async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new Error('ECONNRESET')
  }
  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)

  await session.inputText('hello')
  await flush()

  assert.equal(events[0]?.type, 'error')
  assert.equal(events[0]?.type === 'error' ? events[0].code : undefined, 'agentUnavailable')
  assert.match(events[0]?.type === 'error' ? events[0].message : '', /ECONNRESET/)
})

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}
