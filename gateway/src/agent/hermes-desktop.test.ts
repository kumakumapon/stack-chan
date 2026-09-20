import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { WebSocketServer } from 'ws'
import type { AgentEvent } from './agent-backend.ts'
import { createHermesDesktopBackend, createHermesDesktopClient, createHermesDesktopStt } from './hermes-desktop.ts'

test('desktop authenticates against loopback and ignores unsolicited RPC frames', async (t) => {
  const http = createServer((_req, res) => res.end('window.__HERMES_SESSION_TOKEN__="local-test-token";'))
  const ws = new WebSocketServer({ server: http })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    ws.close()
    http.close()
  })
  ws.on('connection', (socket, req) => {
    assert.equal(new URL(req.url ?? '/', 'http://localhost').searchParams.get('token'), 'local-test-token')
    socket.on('message', (raw) => {
      const request = JSON.parse(raw.toString())
      assert.equal(request.method, 'llm.oneshot')
      socket.send(JSON.stringify({ method: 'event', params: { type: 'gateway.ready' } }))
      socket.send(
        `${JSON.stringify({ id: 999, result: { text: 'unrelated' } })}\n${JSON.stringify({ id: request.id, result: { text: 'accepted' } })}`,
      )
    })
  })
  const address = http.address()
  assert.ok(address && typeof address !== 'string')
  const client = createHermesDesktopClient(`http://127.0.0.1:${address.port}/`)
  assert.deepEqual(await client.rpc('llm.oneshot', { input: 'test' }, AbortSignal.timeout(2000)), { text: 'accepted' })
})

test('desktop RPC cancellation closes transport without surfacing credentials', async (t) => {
  const http = createServer((_req, res) => res.end('window.__HERMES_SESSION_TOKEN__="private-test-token";'))
  const ws = new WebSocketServer({ server: http })
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    for (const client of ws.clients) client.terminate()
    ws.close()
    http.close()
  })
  const controller = new AbortController()
  ws.on('connection', (socket) => socket.on('message', () => controller.abort()))
  const address = http.address()
  assert.ok(address && typeof address !== 'string')
  await assert.rejects(
    createHermesDesktopClient(`http://127.0.0.1:${address.port}/`).rpc('llm.oneshot', {}, controller.signal),
    /cancelled/,
  )
})

test('desktop handshake is restricted to loopback without credentials or redirects', () => {
  for (const origin of [
    'http://example.com/',
    'https://127.0.0.1/',
    'http://user:pass@127.0.0.1/',
    'http://127.0.0.1/?token=x',
  ])
    assert.throws(() => createHermesDesktopClient(origin))
  assert.doesNotThrow(() => createHermesDesktopClient('http://127.0.0.1:12345/'))
})

test('desktop conversations keep bounded private history and never request tools', async () => {
  const inputs: Array<Record<string, unknown>> = []
  const backend = createHermesDesktopBackend({
    async rpc(method, params) {
      assert.equal(method, 'llm.oneshot')
      inputs.push(params)
      return { text: 'こんにちは' }
    },
  })
  const events: AgentEvent[] = []
  const options = {
    deviceId: 'test',
    tools: [],
    inputSampleRate: 16000,
    onEvent: (event: AgentEvent) => events.push(event),
  }
  const a = await backend.createSession(options)
  for (let i = 0; i < 10; i++) await a.inputText(`turn ${i}`)
  assert.equal(events.filter((event) => event.type === 'turn.done').length, 10)
  assert.equal(JSON.parse(String(inputs.at(-1)?.input)).length, 13)
  const b = await backend.createSession(options)
  await b.inputText('new session')
  assert.equal(JSON.parse(String(inputs.at(-1)?.input)).length, 1)
  await a.close()
  await a.inputText('closed')
  assert.equal(inputs.length, 11)
})

test('cancelled replies cannot leak into the next turn or history', async () => {
  let resolve!: (value: Record<string, unknown>) => void
  const inputs: string[] = []
  const events: AgentEvent[] = []
  const backend = createHermesDesktopBackend({
    rpc(_method, params) {
      inputs.push(String(params.input))
      return new Promise((done) => {
        resolve = done
      })
    },
  })
  const session = await backend.createSession({
    deviceId: 'test',
    tools: [],
    inputSampleRate: 16000,
    onEvent: (event) => events.push(event),
  })
  const first = session.inputText('cancel me')
  await session.cancel()
  resolve({ text: 'late' })
  await first
  assert.equal(events.length, 0)
  const second = session.inputText('next')
  resolve({ text: 'accepted' })
  await second
  assert.deepEqual(JSON.parse(inputs[1] ?? ''), [{ role: 'user', content: 'next' }])
  assert.deepEqual(events, [{ type: 'text', text: 'accepted', final: true }, { type: 'turn.done' }])
})

test('Hermes STT sends a WAV and accepts silence as an empty transcript', async () => {
  const stt = createHermesDesktopStt({
    async post(path, body) {
      assert.equal(path, '/api/audio/transcribe')
      const payload = body as { data_url: string }
      const wav = Buffer.from(payload.data_url.split(',')[1] ?? '', 'base64')
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
      assert.equal(wav.readUInt32LE(24), 16000)
      return { transcript: '' }
    },
  })
  assert.deepEqual(await stt.transcribe(new Int16Array(320), 16000), { text: '', final: true })
})
