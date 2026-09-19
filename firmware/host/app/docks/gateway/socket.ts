import type { GatewaySocket, GatewaySocketFactory, GatewaySocketOptions } from 'stackchan-gateway-bridge'
import TextEncoder from 'text/encoder'

/**
 * Moddable WebSocket client behind the Dock's socket seam.
 *
 * Everything policy-shaped (reconnect, queueing, protocol) lives in
 * `stackchan-gateway-bridge`, which is pure and unit-tested. This file is the
 * thin, device-only adapter that owns `device.network.ws` and nothing else, so
 * the untestable surface stays a few lines wide.
 */

const TEXT_FRAME = Object.freeze({ binary: false })

/** XS extension: decodes a buffer as a JavaScript string without a TextDecoder. */
const fromArrayBuffer = (String as unknown as { fromArrayBuffer(buffer: ArrayBuffer): string }).fromArrayBuffer

type WebSocketClientOptions = Record<string, unknown>

type WebSocketClient = {
  read(count: number): ArrayBuffer
  write(buffer: ArrayBufferLike | Uint8Array, options?: Record<string, unknown>): void
  close(): void
}

type WebSocketClientConstructor = {
  new (options: WebSocketClientOptions): WebSocketClient
  readonly close: number
  readonly ping: number
  readonly pong: number
  readonly text: number
  readonly binary: number
}

export const createGatewaySocket: GatewaySocketFactory = (options: GatewaySocketOptions): GatewaySocket => {
  const device = (globalThis as { device?: { network?: Record<string, { io?: WebSocketClientConstructor }> } }).device
  const network = options.secure ? device?.network?.wss : device?.network?.ws
  const WebSocketClient = network?.io
  if (!network || !WebSocketClient) throw new Error('this target has no WebSocket client for the Gateway Dock')

  const encoder = new TextEncoder()
  let pending: Uint8Array[] = []
  let pendingBytes = 0
  let writable = 0
  let opened = false
  let closed = false
  let socket: WebSocketClient | undefined

  const finish = (reason?: string) => {
    if (closed) return
    closed = true
    pending = []
    try {
      socket?.close()
    } catch {
      // The transport may already be gone.
    }
    socket = undefined
    options.onClosed(reason)
  }

  const flush = () => {
    if (!socket || closed) return
    while (pending.length > 0) {
      const frame = pending[0]
      if (!frame) {
        pending.shift()
        continue
      }
      if (writable < frame.byteLength) return
      pending.shift()
      pendingBytes -= frame.byteLength
      writable -= frame.byteLength
      socket.write(frame, TEXT_FRAME)
    }
  }

  socket = new WebSocketClient({
    ...network,
    host: options.host,
    path: options.path,
    port: options.port,
    headers: options.headers ?? [],
    onClose: () => finish('connection closed'),
    onControl: (opcode: number, data: ArrayBuffer) => {
      if (opcode !== WebSocketClient.close) return
      const bytes = new Uint8Array(data)
      const reason = bytes.length > 2 ? fromArrayBuffer(bytes.buffer.slice(2)) : 'connection closed'
      finish(reason)
    },
    onError: (error: { message?: string } | undefined) => finish(error?.message ?? 'network error'),
    onReadable: (count: number, readOptions: { more?: boolean }) => {
      if (!socket || closed) return
      const buffer = socket.read(count)
      accumulate(buffer, readOptions?.more === true)
    },
    onWritable: (count: number) => {
      writable = count
      if (!opened) {
        opened = true
        options.onReady()
      }
      flush()
    },
  })

  // A frame may arrive split across reads; the Gateway's control plane is JSON
  // text, so reassemble before parsing rather than parsing partial frames.
  let partial: string = ''
  function accumulate(buffer: ArrayBuffer, more: boolean): void {
    partial += fromArrayBuffer(buffer)
    if (partial.length > 262144) {
      partial = ''
      finish('Gateway input overflow')
      return
    }
    if (more) return
    const message = partial
    partial = ''
    options.onMessage(message)
  }

  return {
    write(data: string): void {
      if (closed) throw new Error('the Gateway socket is closed')
      const frame = encoder.encode(data)
      if (pendingBytes + frame.byteLength > 32768) throw new Error('Gateway output overflow')
      pendingBytes += frame.byteLength
      pending.push(frame)
      flush()
    },
    close(): void {
      finish()
    },
  }
}

export default createGatewaySocket
