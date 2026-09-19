import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentEvent } from './agent-backend.ts'
import { createHermesBackend } from './hermes-backend.ts'

test('an HTTP error body completing after cancellation does not emit a stale error', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>
  let count = 0
  const { session, events } = await openSession((async (url, init) => {
    if (String(url).endsWith('/sessions')) return new Response('{"id":"one"}')
    if (init?.method === 'DELETE') return new Response('')
    if (++count === 1)
      return new Response(
        new ReadableStream({
          start(value) {
            body = value
          },
        }),
        { status: 500 },
      )
    return new Response(ndjsonStream([{ type: 'text', text: 'next' }, { type: 'done' }]))
  }) as typeof fetch)
  const pending = session.inputText('old')
  while (!body) await Promise.resolve()
  await session.cancel()
  await session.inputText('next')
  body.close()
  await pending
  assert.deepEqual(events, [{ type: 'text', text: 'next', final: true }, { type: 'turn.done' }])
  await session.close()
})

test('cancel aborts the transport, drops a late frame and allows the next turn', async () => {
  let pending!: ReadableStreamDefaultController<Uint8Array>
  let requestSignal: AbortSignal | null | undefined
  let count = 0
  const { session, events } = await openSession((async (url, init) => {
    if (String(url).endsWith('/sessions')) return new Response('{"id":"one"}')
    if (init?.method === 'DELETE') return new Response('')
    if (++count === 1) {
      requestSignal = init?.signal
      return new Response(
        new ReadableStream({
          start(controller) {
            pending = controller
          },
        }),
      )
    }
    return new Response(ndjsonStream([{ type: 'text', text: 'new' }, { type: 'done' }]))
  }) as typeof fetch)
  const old = session.inputText('old')
  while (!pending) await Promise.resolve()
  await session.cancel()
  assert.equal(requestSignal?.aborted, true)
  pending.enqueue(new TextEncoder().encode('{"type":"text","text":"late"}\n'))
  await old
  await session.inputText('new')
  assert.deepEqual(events, [{ type: 'text', text: 'new', final: true }, { type: 'turn.done' }])
  await session.close()
})

function ndjsonStream(lines: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`))
      controller.close()
    },
  })
}

async function openSession(fetchImpl: typeof fetch) {
  const events: AgentEvent[] = []
  const backend = createHermesBackend({ endpoint: 'https://hermes.example/api', token: 'tok-1', fetchImpl })
  const session = await backend.createSession({
    deviceId: 'device-1',
    tools: [],
    inputSampleRate: 16_000,
    onEvent: (event) => events.push(event),
  })
  return { session, events }
}

test('backend identity', () => {
  const backend = createHermesBackend({ endpoint: 'https://hermes.example/api' })
  assert.equal(backend.name, 'hermes')
  assert.equal(backend.producesAudio, false)
})

test('opens a session, sends a text turn, and translates NDJSON frames to AgentEvents', async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsedUrl = String(url)
    const body = init?.body ? JSON.parse(init.body as string) : {}
    requests.push({ url: parsedUrl, body })
    if (parsedUrl.endsWith('/sessions')) {
      return new Response(JSON.stringify({ id: 'session-abc' }), { status: 200 })
    }
    if (parsedUrl.endsWith('/sessions/session-abc/messages')) {
      return new Response(
        ndjsonStream([
          { type: 'transcript', direction: 'input', text: 'hi', final: true },
          { type: 'text', text: 'hello back', final: true },
          { type: 'done' },
        ]),
        { status: 200 },
      )
    }
    throw new Error(`unexpected request: ${parsedUrl}`)
  }

  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)
  await session.inputText('hi')

  assert.deepEqual(events, [
    { type: 'transcript', direction: 'input', text: 'hi', final: true },
    { type: 'text', text: 'hello back', final: true },
    { type: 'turn.done' },
  ])

  assert.equal(requests[0]?.url, 'https://hermes.example/api/sessions')
  assert.equal(requests[0]?.body.deviceId, 'device-1')
  assert.equal(requests[1]?.body.type, 'text')
  assert.equal(requests[1]?.body.text, 'hi')
})

test('a tool_call frame is followed by a tool_result POST once toolResult() is called', async () => {
  let messageCall = 0
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsedUrl = String(url)
    const body = init?.body ? JSON.parse(init.body as string) : {}
    requests.push({ url: parsedUrl, body })
    if (parsedUrl.endsWith('/sessions')) return new Response(JSON.stringify({ id: 'session-1' }), { status: 200 })
    messageCall++
    if (messageCall === 1) {
      // Stream ends right after the tool_call frame, with no `done` -- backend is waiting.
      return new Response(ndjsonStream([{ type: 'tool_call', callId: 'call-9', name: 'get_time', arguments: {} }]), {
        status: 200,
      })
    }
    return new Response(ndjsonStream([{ type: 'text', text: 'It is noon.' }, { type: 'done' }]), { status: 200 })
  }

  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)
  await session.inputText('what time is it?')

  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'tool.call')
  assert.equal(events[0]?.type === 'tool.call' ? events[0].callId : undefined, 'call-9')

  await session.toolResult('call-9', { time: '12:00' })

  assert.equal(events.length, 3)
  assert.equal(events[1]?.type, 'text')
  assert.equal(events[2]?.type, 'turn.done')

  const toolResultRequest = requests.find((r) => r.body.type === 'tool_result')
  assert.equal(toolResultRequest?.body.callId, 'call-9')
  assert.deepEqual(toolResultRequest?.body.result, { time: '12:00' })
})

test('a non-2xx response maps to a non-fatal agentUnavailable error event', async () => {
  const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
    if (String(url).endsWith('/sessions')) return new Response(JSON.stringify({ id: 'session-1' }), { status: 200 })
    return new Response('boom', { status: 503, statusText: 'Unavailable' })
  }
  const { session, events } = await openSession(fetchImpl as unknown as typeof fetch)

  await session.inputText('hi')

  assert.equal(events.length, 2)
  assert.equal(events[0]?.type, 'error')
  assert.equal(events[0]?.type === 'error' ? events[0].code : undefined, 'agentUnavailable')
  assert.equal(events[0]?.type === 'error' ? events[0].fatal : undefined, false)
  assert.equal(events[1]?.type, 'turn.done')
})

test('close() DELETEs the session when one was opened', async () => {
  const requests: string[] = []
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push(`${init?.method ?? 'GET'} ${String(url)}`)
    if (String(url).endsWith('/sessions')) return new Response(JSON.stringify({ id: 'session-xyz' }), { status: 200 })
    return new Response(ndjsonStream([{ type: 'done' }]), { status: 200 })
  }
  const { session } = await openSession(fetchImpl as unknown as typeof fetch)
  await session.inputText('hi') // opens the session lazily
  await session.close()

  assert.ok(requests.includes('DELETE https://hermes.example/api/sessions/session-xyz'))
})

test('close() is a no-op when no session was ever opened', async () => {
  const fetchImpl = async (): Promise<Response> => {
    throw new Error('should not be called')
  }
  const { session } = await openSession(fetchImpl as unknown as typeof fetch)
  await session.close()
})
