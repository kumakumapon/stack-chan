import type { RemoteConversationTransportState } from 'capabilities'
import {
  type AgentError,
  type GatewayDeviceCapabilities,
  type GatewayServerMessage,
  isGatewayEnvelope,
  parseGatewayServerMessage,
  STACKCHAN_GATEWAY_PROTOCOL_VERSION,
  STACKCHAN_GATEWAY_SCHEMA,
  sessionHello,
} from 'stackchan-gateway-protocol'
import type { RealtimeEventBridge, RealtimeEventSendResult, RealtimeRetryScheduler } from 'stackchan-realtime-session'

import type { GatewaySocket, GatewaySocketFactory } from './socket-types.js'

export type { GatewaySocket, GatewaySocketFactory, GatewaySocketOptions } from './socket-types.js'

export type GatewayBridgeEndpoint = {
  secure: boolean
  host: string
  port: number
  path: string
}

export type GatewayBridgeOptions = {
  endpoint: GatewayBridgeEndpoint
  deviceId: string
  clientId: string
  token?: string
  capabilities: GatewayDeviceCapabilities
  headers?: [string, string][]
  socketFactory: GatewaySocketFactory
  scheduler: RealtimeRetryScheduler
}

export type GatewayBridge = RealtimeEventBridge & {
  readonly transportState: RemoteConversationTransportState
  /** Local send failure category only; never includes payloads or credentials. */
  readonly lastSendFailure?: 'bridge-full' | 'socket-full' | 'write-error' | 'disconnected'
  clearPendingAudio?(): void
  sendGatewayMessage(message: Record<string, unknown>): 'queued' | 'overflow' | 'disconnected'
  setSidebandHandler(handler?: (message: GatewayServerMessage) => void): void
  close(): void
}

const MAX_PENDING_OUTBOUND_BYTES = 32 * 1024
const OUTBOUND_RELEASE_MILLISECONDS = 0
const INITIAL_RECONNECT_MILLISECONDS = 1_000
const MAX_RECONNECT_MILLISECONDS = 30_000

export function createGatewayBridge(options: GatewayBridgeOptions): GatewayBridge {
  let eventHandler: ((event: string) => void) | undefined
  let transportStateHandler: ((state: RemoteConversationTransportState) => void) | undefined
  let sidebandHandler: ((message: GatewayServerMessage) => void) | undefined
  let sessionReady: GatewayServerMessage | undefined

  let transportState: RemoteConversationTransportState = 'disconnected'
  let socket: GatewaySocket | undefined
  let socketOpen = false
  let socketGeneration = 0
  let pendingBytes = 0
  let lastSendFailure: GatewayBridge['lastSendFailure']
  const releaseHandles = new Set<unknown>()
  let reconnectHandle: unknown | undefined
  let reconnectDelayMilliseconds = INITIAL_RECONNECT_MILLISECONDS
  let closed = false

  const setTransportState = (next: RemoteConversationTransportState) => {
    if (next !== 'ready') sessionReady = undefined
    if (next === transportState) return
    transportState = next
    transportStateHandler?.(next)
  }

  const releaseAllPending = () => {
    for (const handle of releaseHandles) {
      try {
        options.scheduler.clear(handle)
      } catch (error) {
        log(`[gateway-bridge] failed to clear a pending-send timer: ${errorMessage(error)}\n`)
      }
    }
    releaseHandles.clear()
    pendingBytes = 0
  }

  const scheduleReconnect = () => {
    if (closed || reconnectHandle !== undefined) return
    const delay = reconnectDelayMilliseconds
    reconnectDelayMilliseconds = Math.min(reconnectDelayMilliseconds * 2, MAX_RECONNECT_MILLISECONDS)
    reconnectHandle = options.scheduler.set(() => {
      reconnectHandle = undefined
      connect()
    }, delay)
  }

  const retireSocket = (generation: number) => {
    if (generation !== socketGeneration) return
    socket = undefined
    socketOpen = false
    releaseAllPending()
    setTransportState('disconnected')
    scheduleReconnect()
  }

  const writeToSocket = (serialized: string, audioInput = false): 'queued' | 'overflow' | 'disconnected' => {
    lastSendFailure = undefined
    if (closed || !socket || !socketOpen) {
      lastSendFailure = 'disconnected'
      return 'disconnected'
    }
    const size = byteLength(serialized)
    if (pendingBytes + size > MAX_PENDING_OUTBOUND_BYTES) {
      lastSendFailure = 'bridge-full'
      return 'overflow'
    }
    pendingBytes += size
    const activeSocket = socket
    const activeGeneration = socketGeneration
    let released = false
    let handle: unknown
    const release = () => {
      if (released) return
      released = true
      releaseHandles.delete(handle)
      pendingBytes = Math.max(0, pendingBytes - size)
    }
    try {
      if (activeSocket.write(serialized, audioInput) === false) {
        release()
        lastSendFailure = 'socket-full'
        return 'overflow'
      }
    } catch (error) {
      release()
      log(`[gateway-bridge] socket write failed: ${errorMessage(error)}\n`)
      try {
        activeSocket.close()
      } catch (closeError) {
        log(`[gateway-bridge] socket close after write failure failed: ${errorMessage(closeError)}\n`)
      }
      retireSocket(activeGeneration)
      lastSendFailure = errorMessage(error) === 'Gateway output overflow' ? 'socket-full' : 'write-error'
      return 'disconnected'
    }
    // The socket interface has no write-completion signal, so a scheduler
    // tick is the best available proxy for "handed off to the transport".
    // Accounted bytes stay pending — and can push later sends into overflow —
    // until this release runs or the connection is torn down.
    handle = options.scheduler.set(release, OUTBOUND_RELEASE_MILLISECONDS)
    releaseHandles.add(handle)
    return 'queued'
  }

  const handleGatewayServerMessage = (message: GatewayServerMessage) => {
    if (message.type === 'session.ready') {
      if (message.protocolVersion > STACKCHAN_GATEWAY_PROTOCOL_VERSION) {
        setTransportState('unsupported')
        const mismatch: AgentError = {
          schema: STACKCHAN_GATEWAY_SCHEMA,
          type: 'agent.error',
          code: 'unsupportedProtocol',
          message:
            `gateway session.ready protocolVersion ${message.protocolVersion} is newer than the device's ` +
            `${STACKCHAN_GATEWAY_PROTOCOL_VERSION}`,
          fatal: true,
        }
        sidebandHandler?.(mismatch)
        return
      }
      reconnectDelayMilliseconds = INITIAL_RECONNECT_MILLISECONDS
      // Flip the transport to ready before handing the Dock runtime the
      // session.ready message itself, so a handler that inspects
      // `transportState` while reacting to `session.ready` observes 'ready'.
      setTransportState('ready')
      sessionReady = message
    }
    sidebandHandler?.(message)
  }

  const handleReady = (generation: number) => {
    if (generation !== socketGeneration || closed) return
    socketOpen = true
    const hello = sessionHello({
      deviceId: options.deviceId,
      clientId: options.clientId,
      token: options.token,
      capabilities: options.capabilities,
    })
    const result = writeToSocket(JSON.stringify(hello))
    if (result !== 'queued') {
      log(`[gateway-bridge] session.hello was not sent: ${result}\n`)
    }
  }

  const handleMessage = (generation: number, raw: string) => {
    if (generation !== socketGeneration || closed) return
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch (error) {
      log(`[gateway-bridge] dropped malformed JSON frame: ${errorMessage(error)}\n`)
      return
    }
    if (isGatewayEnvelope(value)) {
      const message = parseGatewayServerMessage(value)
      if (!message) {
        log('[gateway-bridge] dropped malformed stackchan.gateway.v1 frame\n')
        return
      }
      handleGatewayServerMessage(message)
      return
    }
    eventHandler?.(raw)
  }

  const handleClosed = (generation: number, reason?: string) => {
    if (generation !== socketGeneration) return
    if (reason) log(`[gateway-bridge] socket closed: ${reason}\n`)
    retireSocket(generation)
  }

  function connect(): void {
    if (closed) return
    const generation = ++socketGeneration
    let created: GatewaySocket
    try {
      created = options.socketFactory({
        secure: options.endpoint.secure,
        host: options.endpoint.host,
        port: options.endpoint.port,
        path: options.endpoint.path,
        headers: options.headers,
        onReady: () => handleReady(generation),
        onMessage: (message) => handleMessage(generation, message),
        onClosed: (reason) => handleClosed(generation, reason),
      })
    } catch (error) {
      log(`[gateway-bridge] socket factory failed: ${errorMessage(error)}\n`)
      scheduleReconnect()
      return
    }
    socket = created
  }

  connect()

  return {
    clearPendingAudio() {
      socket?.clearPendingAudio?.()
    },
    get lastSendFailure() {
      return lastSendFailure
    },
    get transportState() {
      return transportState
    },
    setEventHandler(handler) {
      eventHandler = handler
    },
    setTransportStateHandler(handler) {
      transportStateHandler = handler
      handler?.(transportState)
    },
    sendEvent(event) {
      if (transportState !== 'ready') {
        const result: RealtimeEventSendResult = transportState === 'unsupported' ? 'unsupported' : 'disconnected'
        return Promise.resolve(result)
      }
      return Promise.resolve(writeToSocket(event))
    },
    sendGatewayMessage(message) {
      return writeToSocket(JSON.stringify(message), message.type === 'audio.input')
    },
    setSidebandHandler(handler) {
      sidebandHandler = handler
      if (handler && sessionReady) handler(sessionReady)
    },
    close() {
      if (closed) return
      closed = true
      if (reconnectHandle !== undefined) {
        try {
          options.scheduler.clear(reconnectHandle)
        } catch (error) {
          log(`[gateway-bridge] failed to clear the reconnect timer: ${errorMessage(error)}\n`)
        }
        reconnectHandle = undefined
      }
      releaseAllPending()
      const activeSocket = socket
      socket = undefined
      socketOpen = false
      socketGeneration++
      if (activeSocket) {
        try {
          activeSocket.close()
        } catch (error) {
          log(`[gateway-bridge] socket close failed: ${errorMessage(error)}\n`)
        }
      }
      transportState = 'disconnected'
      eventHandler = undefined
      transportStateHandler = undefined
      sidebandHandler = undefined
    },
  }
}

/** UTF-8 byte length without relying on Buffer/TextEncoder, neither guaranteed on XS. */
function byteLength(value: string): number {
  // Audio envelopes are ASCII. Let the native regexp scan avoid a JS loop
  // over every base64 character; retain UTF-8 accounting for other messages.
  if (!/[^\x20-\x7e]/.test(value)) return value.length
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4
        i++
        continue
      }
    }
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else bytes += 3
  }
  return bytes
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
