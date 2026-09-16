import assert from 'node:assert/strict'
import test from 'node:test'
import { WebSocket } from 'ws'
import { createEchoBackend } from '../agent/echo-backend.ts'
import { createNullStt } from '../audio/stt.ts'
import { createNullTts } from '../audio/tts.ts'
import { parseGatewayConfig } from '../config.ts'
import { STACKCHAN_EVENT_SCHEMA } from '../protocol/stackchan-event-v1.ts'
import { STACKCHAN_GATEWAY_SCHEMA } from '../protocol/stackchan-gateway-v1.ts'
import { createGatewayServer } from './gateway-server.ts'

const PCM16 = { codec: 'pcm16', sampleRate: 16_000, channels: 1 }

/**
 * End-to-end over a real socket: the pure layers are covered elsewhere, so this
 * exists to prove the `ws` wiring, the path and the auth plumbing agree with
 * them.
 */
test('a device drives a whole text conversation over the socket', async (t) => {
  const config = parseGatewayConfig({
    gateway: {
      listen: { host: '127.0.0.1', port: 0, path: '/stackchan' },
      devices: [{ deviceId: 'stackchan-01', token: 'secret' }],
    },
  })
  const server = createGatewayServer({
    config,
    backend: createEchoBackend(),
    stt: createNullStt(),
    tts: createNullTts(),
    logger: () => {},
  })
  const address = await server.listen()
  t.after(async () => {
    await server.close()
  })

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stackchan`)
  const received: Array<Record<string, unknown>> = []
  const waiters: Array<{ match: (frame: Record<string, unknown>) => boolean; resolve: () => void }> = []
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>
    received.push(frame)
    for (const waiter of [...waiters]) {
      if (!waiter.match(frame)) continue
      waiters.splice(waiters.indexOf(waiter), 1)
      waiter.resolve()
    }
  })
  const waitFor = (type: string) =>
    new Promise<void>((resolve, reject) => {
      if (received.some((frame) => frame.type === type)) return resolve()
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 2_000)
      waiters.push({
        match: (frame) => frame.type === type,
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
      })
    })

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  t.after(() => socket.close())

  socket.send(
    JSON.stringify({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'session.hello',
      protocolVersion: 1,
      deviceId: 'stackchan-01',
      clientId: 'client-1',
      token: 'secret',
      capabilities: { audioInput: [PCM16], audioOutput: [PCM16], embodiment: [], approval: true },
    }),
  )
  await waitFor('session.ready')
  await waitFor('session.created')

  socket.send(
    JSON.stringify({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'r1',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
  )
  await waitFor('conversation.result')
  const result = received.find((frame) => frame.type === 'conversation.result')
  assert.equal(result?.state, 'listening')
  assert.equal(result?.success, true)

  socket.send(JSON.stringify({ schema: STACKCHAN_GATEWAY_SCHEMA, type: 'text.input', text: 'good morning' }))
  await waitFor('transcript.output')
  const output = received.find((frame) => frame.type === 'transcript.output')
  assert.equal(output?.text, 'echo: good morning')
})

test('a device with the wrong token never reaches session.ready', async (t) => {
  const config = parseGatewayConfig({
    gateway: {
      listen: { host: '127.0.0.1', port: 0, path: '/stackchan' },
      devices: [{ deviceId: 'stackchan-01', token: 'secret' }],
    },
  })
  const server = createGatewayServer({
    config,
    backend: createEchoBackend(),
    stt: createNullStt(),
    tts: createNullTts(),
    logger: () => {},
  })
  const address = await server.listen()
  t.after(async () => {
    await server.close()
  })

  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/stackchan`)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const frames: Array<Record<string, unknown>> = []
  socket.on('message', (data) => frames.push(JSON.parse(data.toString()) as Record<string, unknown>))

  socket.send(
    JSON.stringify({
      schema: STACKCHAN_GATEWAY_SCHEMA,
      type: 'session.hello',
      protocolVersion: 1,
      deviceId: 'stackchan-01',
      clientId: 'client-1',
      token: 'wrong',
      capabilities: { audioInput: [PCM16], audioOutput: [PCM16], embodiment: [], approval: true },
    }),
  )
  await new Promise<void>((resolve) => socket.once('close', () => resolve()))
  assert.equal(
    frames.some((frame) => frame.type === 'session.ready'),
    false,
  )
  assert.equal(frames.find((frame) => frame.type === 'agent.error')?.code, 'unauthorized')
})
