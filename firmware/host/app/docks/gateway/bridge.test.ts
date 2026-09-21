import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  GatewayDeviceCapabilities,
  GatewayServerMessage,
} from '../../../modules/conversation/gateway/gateway-protocol.js'
import { installGatewayDockTestAliases } from './__tests__/node-aliases.js'
import type { GatewaySocketFactory, GatewaySocketOptions } from './bridge.js'

installGatewayDockTestAliases()

const { createGatewayBridge } = await import('./bridge.js')

type FakeGatewaySocket = {
  options: GatewaySocketOptions
  written: string[]
  closed: boolean
  writeThrows: boolean
  writeError?: string
  backpressured?: boolean
}

function createFakeSocketFactory(): {
  factory: GatewaySocketFactory
  sockets: FakeGatewaySocket[]
  failNextFactory(): void
} {
  const sockets: FakeGatewaySocket[] = []
  let failNext = false
  const factory: GatewaySocketFactory = (options) => {
    if (failNext) {
      failNext = false
      throw new Error('socket factory failed')
    }
    const record: FakeGatewaySocket = { options, written: [], closed: false, writeThrows: false }
    sockets.push(record)
    return {
      write(data) {
        if (record.backpressured) return false
        if (record.writeThrows) throw new Error(record.writeError ?? 'write failed')
        record.written.push(data)
      },
      close() {
        record.closed = true
      },
    }
  }
  return {
    factory,
    sockets,
    failNextFactory() {
      failNext = true
    },
  }
}

type ScheduledCall = { id: number; callback: () => void; delay: number }

function createFakeScheduler() {
  let nextId = 1
  const scheduled = new Map<number, ScheduledCall>()
  return {
    scheduler: {
      set(callback: () => void, milliseconds: number): unknown {
        const id = nextId++
        scheduled.set(id, { id, callback, delay: milliseconds })
        return id
      },
      clear(handle: unknown): void {
        scheduled.delete(handle as number)
      },
    },
    pendingCount(): number {
      return scheduled.size
    },
    delays(): number[] {
      return [...scheduled.values()].map((call) => call.delay)
    },
    fireAll(): void {
      const calls = [...scheduled.values()]
      scheduled.clear()
      for (const call of calls) call.callback()
    },
    fireOne(): boolean {
      const [first] = scheduled.values()
      if (!first) return false
      scheduled.delete(first.id)
      first.callback()
      return true
    },
  }
}

const capabilities: GatewayDeviceCapabilities = {
  audioInput: [{ codec: 'pcm16', sampleRate: 16_000, channels: 1 }],
  audioOutput: [{ codec: 'pcm16', sampleRate: 16_000, channels: 1 }],
  embodiment: ['stackchan.say'],
  approval: false,
}

const validSessionReady: GatewayServerMessage = {
  schema: 'stackchan.gateway.v1',
  type: 'session.ready',
  protocolVersion: 1,
  sessionId: 'session-1',
  audio: {
    input: { codec: 'pcm16', sampleRate: 16_000, channels: 1 },
    output: { codec: 'pcm16', sampleRate: 16_000, channels: 1 },
  },
  features: { audioInput: true, audioOutput: true, approval: false, tools: true },
}

function createBridgeForTest() {
  const { factory, sockets, failNextFactory } = createFakeSocketFactory()
  const fakeScheduler = createFakeScheduler()
  const bridge = createGatewayBridge({
    endpoint: { secure: false, host: 'gateway.local', port: 8080, path: '/ws' },
    deviceId: 'device-1',
    clientId: 'client-1',
    capabilities,
    socketFactory: factory,
    scheduler: fakeScheduler.scheduler,
  })
  return { bridge, sockets, fakeScheduler, failNextFactory }
}

function bringToReady(sockets: FakeGatewaySocket[], socketIndex = 0) {
  sockets[socketIndex].options.onReady()
  sockets[socketIndex].options.onMessage(JSON.stringify(validSessionReady))
}

test('outbound accounting preserves exact UTF-8 limits for ASCII and multilingual envelopes', async () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  bringToReady(sockets)
  fakeScheduler.fireAll()
  for (const text of ['audio/base64+==', '日本語', '😀', '\n\t']) {
    const envelope = JSON.stringify({ type: 'text.input', text })
    const bytes = Buffer.byteLength(envelope, 'utf8')
    assert.equal(await bridge.sendEvent(envelope), 'queued')
    assert.equal(await bridge.sendEvent(' '.repeat(32768 - bytes)), 'queued')
    assert.equal(await bridge.sendEvent(' '), 'overflow')
    fakeScheduler.fireAll()
  }
  bridge.close()
})

test('opens a socket on creation using the configured endpoint', () => {
  const { sockets } = createBridgeForTest()
  assert.equal(sockets.length, 1)
  assert.deepEqual(
    {
      secure: sockets[0].options.secure,
      host: sockets[0].options.host,
      port: sockets[0].options.port,
      path: sockets[0].options.path,
    },
    { secure: false, host: 'gateway.local', port: 8080, path: '/ws' },
  )
})

test('sends session.hello on socket ready, and stays disconnected until session.ready arrives', () => {
  const { bridge, sockets } = createBridgeForTest()
  assert.equal(bridge.transportState, 'disconnected')
  sockets[0].options.onReady()
  assert.equal(sockets[0].written.length, 1)
  const hello = JSON.parse(sockets[0].written[0])
  assert.equal(hello.type, 'session.hello')
  assert.equal(hello.protocolVersion, 1)
  assert.equal(hello.deviceId, 'device-1')
  assert.equal(hello.clientId, 'client-1')
  assert.deepEqual(hello.capabilities, capabilities)
  assert.equal(bridge.transportState, 'disconnected')
})

test('sendEvent resolves disconnected before the socket is ready', async () => {
  const { bridge } = createBridgeForTest()
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'disconnected')
})

test('sendEvent stays disconnected after socket-ready but before session.ready, while sendGatewayMessage works', async () => {
  const { bridge, sockets } = createBridgeForTest()
  sockets[0].options.onReady()
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'disconnected')
  assert.equal(bridge.sendGatewayMessage({ schema: 'stackchan.gateway.v1', type: 'text.input', text: 'hi' }), 'queued')
})

test('transitions to ready after a compatible session.ready, and can then send realtime events', async () => {
  const { bridge, sockets } = createBridgeForTest()
  const transportStates: string[] = []
  bridge.setTransportStateHandler((state) => transportStates.push(state))
  bringToReady(sockets)
  assert.equal(bridge.transportState, 'ready')
  assert.ok(transportStates.includes('ready'))
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'queued')
  assert.ok(sockets[0].written.some((raw) => raw === '{"type":"response.create"}'))
})

test('setTransportStateHandler immediately replays the current transport state', () => {
  const { bridge, sockets } = createBridgeForTest()
  bringToReady(sockets)
  const observed: string[] = []
  bridge.setTransportStateHandler((state) => observed.push(state))
  assert.deepEqual(observed, ['ready'])
})

test('routes stackchan.gateway.v1 frames to the sideband handler and forwards everything else verbatim', () => {
  const { bridge, sockets } = createBridgeForTest()
  bringToReady(sockets)
  const sideband: GatewayServerMessage[] = []
  const realtimeEvents: string[] = []
  bridge.setSidebandHandler((message) => sideband.push(message))
  bridge.setEventHandler((event) => realtimeEvents.push(event))

  const transcript: GatewayServerMessage = {
    schema: 'stackchan.gateway.v1',
    type: 'transcript.output',
    text: 'hello human',
    final: true,
  }
  sockets[0].options.onMessage(JSON.stringify(transcript))
  assert.deepEqual(sideband, [validSessionReady, transcript])
  assert.deepEqual(realtimeEvents, [])

  const realtimeRaw = '{"type":"response.function_call_arguments.done","call_id":"c1"}'
  sockets[0].options.onMessage(realtimeRaw)
  assert.deepEqual(sideband, [validSessionReady, transcript])
  assert.deepEqual(realtimeEvents, [realtimeRaw])
})

test('forwards session.ready itself to the sideband handler, after the transport is already ready', () => {
  const { bridge, sockets } = createBridgeForTest()
  sockets[0].options.onReady()
  const sideband: GatewayServerMessage[] = []
  const observedTransportStateWhenDelivered: string[] = []
  bridge.setSidebandHandler((message) => {
    observedTransportStateWhenDelivered.push(bridge.transportState)
    sideband.push(message)
  })
  sockets[0].options.onMessage(JSON.stringify(validSessionReady))
  assert.deepEqual(sideband, [validSessionReady])
  assert.deepEqual(observedTransportStateWhenDelivered, ['ready'])
})

test('drops malformed JSON and malformed gateway frames instead of forwarding or crashing', () => {
  const { bridge, sockets } = createBridgeForTest()
  bringToReady(sockets)
  const sideband: GatewayServerMessage[] = []
  const realtimeEvents: string[] = []
  bridge.setSidebandHandler((message) => sideband.push(message))
  bridge.setEventHandler((event) => realtimeEvents.push(event))

  sockets[0].options.onMessage('{not valid json')
  sockets[0].options.onMessage(JSON.stringify({ schema: 'stackchan.gateway.v1', type: 'transcript.output' }))

  assert.deepEqual(sideband, [validSessionReady])
  assert.deepEqual(realtimeEvents, [])
})

test('a protocol-version mismatch on session.ready marks the transport unsupported instead of ready', async () => {
  const { bridge, sockets } = createBridgeForTest()
  sockets[0].options.onReady()
  const sideband: GatewayServerMessage[] = []
  bridge.setSidebandHandler((message) => sideband.push(message))
  sockets[0].options.onMessage(
    JSON.stringify({ ...validSessionReady, protocolVersion: validSessionReady.protocolVersion + 1 }),
  )
  assert.equal(bridge.transportState, 'unsupported')
  assert.equal(sideband.length, 1)
  assert.equal(sideband[0].type, 'agent.error')
  assert.equal((sideband[0] as { code: string }).code, 'unsupportedProtocol')
  assert.equal((sideband[0] as { fatal: boolean }).fatal, true)
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'unsupported')
})

test('sendGatewayMessage rejects once the pending outbound byte total would exceed the cap, and recovers after release', () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  sockets[0].options.onReady()
  const big = (marker: string) => ({ schema: 'stackchan.gateway.v1', type: 'text.input', text: marker.repeat(25_000) })

  assert.equal(bridge.sendGatewayMessage(big('a')), 'queued')
  assert.equal(bridge.sendGatewayMessage(big('b')), 'overflow')
  assert.equal(bridge.lastSendFailure, 'bridge-full')

  fakeScheduler.fireAll()
  assert.equal(bridge.sendGatewayMessage(big('c')), 'queued')
  assert.equal(bridge.lastSendFailure, undefined)
})

test('a throwing write resolves disconnected, never rejects, and tears the socket down for reconnect', async () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  bringToReady(sockets)
  sockets[0].writeThrows = true

  const result = await bridge.sendEvent('{"type":"response.create"}')
  assert.equal(result, 'disconnected')
  assert.equal(bridge.lastSendFailure, 'write-error')
  assert.equal(bridge.transportState, 'disconnected')
  assert.equal(sockets[0].closed, true)
  assert.deepEqual(fakeScheduler.delays(), [1_000])

  fakeScheduler.fireOne()
  assert.equal(sockets.length, 2)
})

test('send diagnostics distinguish socket capacity from disconnected transport without exposing the payload', () => {
  const { bridge, sockets } = createBridgeForTest()
  assert.equal(bridge.sendGatewayMessage({ type: 'audio.input', payload: 'private' }), 'disconnected')
  assert.equal(bridge.lastSendFailure, 'disconnected')
  bringToReady(sockets)
  sockets[0].writeThrows = true
  sockets[0].writeError = 'Gateway output overflow'
  assert.equal(bridge.sendGatewayMessage({ type: 'audio.input', payload: 'private' }), 'disconnected')
  assert.equal(bridge.lastSendFailure, 'socket-full')
})

test('socket backpressure rejects only the frame and recovers without reconnect or leaked accounting', () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  bringToReady(sockets)
  fakeScheduler.fireAll()
  sockets[0].backpressured = true
  const message = { type: 'audio.input', payload: 'a'.repeat(1000) }
  for (let i = 0; i < 100; i++) {
    assert.equal(bridge.sendGatewayMessage(message), 'overflow')
    assert.equal(bridge.lastSendFailure, 'socket-full')
  }
  assert.equal(bridge.transportState, 'ready')
  assert.equal(sockets[0].closed, false)
  assert.deepEqual(fakeScheduler.delays(), [])
  sockets[0].backpressured = false
  assert.equal(bridge.sendGatewayMessage(message), 'queued')
  assert.equal(bridge.lastSendFailure, undefined)
  bridge.close()
})

test('onClosed drops to disconnected, fails pending sends, and schedules a reconnect', async () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  bringToReady(sockets)
  sockets[0].options.onClosed('server closed')
  assert.equal(bridge.transportState, 'disconnected')
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'disconnected')
  assert.equal(
    bridge.sendGatewayMessage({ schema: 'stackchan.gateway.v1', type: 'text.input', text: 'hi' }),
    'disconnected',
  )
  assert.deepEqual(fakeScheduler.delays(), [1_000])
})

test('reconnect backoff doubles on repeated failures and caps at 30s', () => {
  const { sockets, fakeScheduler } = createBridgeForTest()
  const expectedDelays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
  for (const expected of expectedDelays) {
    const lastSocket = sockets[sockets.length - 1]
    lastSocket.options.onClosed('closed')
    assert.deepEqual(fakeScheduler.delays(), [expected])
    fakeScheduler.fireOne()
  }
  // one reconnect attempt happened per expected delay, plus the initial connect
  assert.equal(sockets.length, expectedDelays.length + 1)
})

test('reconnect backoff resets to 1s after a successful session.ready', () => {
  const { sockets, fakeScheduler } = createBridgeForTest()
  sockets[0].options.onClosed('closed')
  assert.deepEqual(fakeScheduler.delays(), [1_000])
  fakeScheduler.fireOne()

  sockets[1].options.onClosed('closed')
  assert.deepEqual(fakeScheduler.delays(), [2_000])
  fakeScheduler.fireOne()

  bringToReady(sockets, 2)
  sockets[2].options.onClosed('closed again')
  assert.deepEqual(fakeScheduler.delays(), [1_000])
})

test('a factory failure is treated like a lost connection and still backs off', () => {
  const { sockets, fakeScheduler, failNextFactory } = createBridgeForTest()
  sockets[0].options.onClosed('closed')
  assert.deepEqual(fakeScheduler.delays(), [1_000])
  failNextFactory()
  fakeScheduler.fireOne()
  assert.equal(sockets.length, 1)
  assert.deepEqual(fakeScheduler.delays(), [2_000])
})

test('close() closes the live socket and is idempotent', () => {
  const { bridge, sockets } = createBridgeForTest()
  bringToReady(sockets)
  bridge.close()
  assert.equal(sockets[0].closed, true)
  assert.equal(bridge.transportState, 'disconnected')
  assert.doesNotThrow(() => bridge.close())
})

test('close() cancels a pending reconnect timer and stops further reconnects', () => {
  const { bridge, sockets, fakeScheduler } = createBridgeForTest()
  bringToReady(sockets)
  sockets[0].options.onClosed('closed')
  assert.equal(fakeScheduler.pendingCount() > 0, true)

  bridge.close()
  assert.equal(fakeScheduler.pendingCount(), 0)

  fakeScheduler.fireAll()
  assert.equal(sockets.length, 1)
})

test('sends resolve disconnected after close()', async () => {
  const { bridge, sockets } = createBridgeForTest()
  bringToReady(sockets)
  bridge.close()
  assert.equal(await bridge.sendEvent('{"type":"response.create"}'), 'disconnected')
  assert.equal(
    bridge.sendGatewayMessage({ schema: 'stackchan.gateway.v1', type: 'text.input', text: 'hi' }),
    'disconnected',
  )
})
