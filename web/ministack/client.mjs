import { BLELocalPeerCapability } from '../local-peer/ble-local-peer.mjs'

/** Settings the PC may change, mirroring firmware/mods/examples/ministack/controller.js CONFIG_KEYS. */
export const CONFIG_KEYS = {
  speechVolume: { min: 0, max: 100 },
  longPressMs: { min: 300, max: 2000 },
  faceMotion: { boolean: true },
}

/** Raw bytes per transfer chunk; base64 of this still fits the 2 KiB Local Peer envelope. */
export const TRANSFER_CHUNK_MAX = 1024

/**
 * Tracks event delivery so the UI sees each event exactly once.
 *
 * Events can arrive twice (a pushed `event` message and a later `events.since`
 * replay covering the same id) and out of order (a push racing ahead of a
 * replay that is still catching up). This buffers anything that arrives ahead
 * of the contiguous chain and releases it in id order once the gap in the
 * chain fills in, so `onEvent` fires exactly once per id, in order.
 *
 * `gap: true` on a replay means the MOD's buffer dropped an id for good: the
 * chain will never become contiguous there, so whatever is still buffered for
 * it is discarded, the survivors in that reply are delivered directly, and
 * `onGap` fires so the caller resyncs anything it inferred from events.
 */
export function createEventTracker({ onEvent = () => {}, onGap = () => {} } = {}) {
  let cursor = 0
  const pending = new Map()
  const flush = () => {
    for (;;) {
      const next = pending.get(cursor + 1)
      if (next === undefined) return
      pending.delete(cursor + 1)
      cursor += 1
      onEvent(next)
    }
  }
  const ingest = (event) => {
    if (!event || !Number.isInteger(event.eventId) || event.eventId <= cursor || pending.has(event.eventId)) return
    pending.set(event.eventId, event)
    flush()
  }
  return {
    get cursor() {
      return cursor
    },
    ingest,
    /** Feeds one `events.since` reply. */
    ingestReplay({ events = [], gap = false } = {}) {
      if (gap) {
        pending.clear()
        for (const event of events) {
          if (!Number.isInteger(event?.eventId) || event.eventId <= cursor) continue
          cursor = event.eventId
          onEvent(event)
        }
        onGap()
        return
      }
      for (const event of events) ingest(event)
    },
  }
}

/** Decodes a base64 `transfer.read` chunk back into raw bytes. */
export function decodeBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function concatBytes(parts, totalLength) {
  const out = new Uint8Array(totalLength ?? parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

/**
 * Pulls a MOD-side transfer a chunk at a time and reassembles it.
 *
 * `read(offset, length)` performs one `transfer.read` round trip and resolves
 * to `{offset, byteLength, chunk, eof}` (`chunk` base64-encoded). A chunk read
 * is idempotent by offset on the MOD side, so a failing chunk is retried at
 * the same offset rather than restarting the whole transfer.
 */
export async function readTransfer(read, { chunkSize = TRANSFER_CHUNK_MAX, maxAttempts = 3, onProgress } = {}) {
  if (chunkSize > TRANSFER_CHUNK_MAX) throw new Error(`chunkSize must not exceed ${TRANSFER_CHUNK_MAX}`)
  const parts = []
  let offset = 0
  let total
  for (;;) {
    let result
    for (let attempt = 1; ; attempt++) {
      try {
        result = await read(offset, chunkSize)
        break
      } catch (error) {
        if (attempt >= maxAttempts) throw error
      }
    }
    total = result.byteLength
    const bytes = decodeBase64(result.chunk)
    parts.push(bytes)
    offset += bytes.byteLength
    onProgress?.({ bytesRead: offset, totalBytes: total })
    if (result.eof) break
  }
  return concatBytes(parts, total)
}

// Call connect from a browser user gesture. Secrets remain in memory only.
export class MiniStackClient {
  constructor(createCapability = () => new BLELocalPeerCapability(), onDisconnect = () => {}, options = {}) {
    this.createCapability = createCapability
    this.onDisconnect = onDisconnect
    this.pending = new Map()
    this.counter = 0
    this.revision = 0
    // Reflashing the host or the MOD invalidates the BLE session, so a test
    // session is interrupted many times per device cycle. Retry automatically
    // while the browser still holds permission for the remembered device.
    this.reconnectAttempts = options.reconnectAttempts ?? 3
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000
    this.schedule = options.schedule ?? ((run, delayMs) => setTimeout(run, delayMs))
    this.onReconnectAttempt = options.onReconnectAttempt ?? (() => {})
    // onEvent fires once per event id, in order (see createEventTracker).
    // onGap fires when an event was lost for good; the caller should treat
    // anything it inferred from events as stale until onState delivers fresh state.get.
    this.onEvent = options.onEvent ?? (() => {})
    this.onGap = options.onGap ?? (() => {})
    this.onState = options.onState ?? (() => {})
    this.autoReconnect = false
    this.retries = 0
  }
  async connect(sharedKey) {
    if (this.connecting) throw new Error('Connection already in progress')
    this.close()
    this.disconnectReason = undefined
    this.polling = false
    this.heartbeatFailures = 0
    this.gap = false
    this.ackInFlight = false
    this.ackQueued = false
    // Ids are monotonic within a device boot session and a restart changes the
    // session, so a fresh connection starts a fresh tracker rather than
    // reasoning about which ids from a previous boot are still meaningful.
    this.eventTracker = createEventTracker({
      onEvent: (event) => this.onEvent(event),
      onGap: () => this.handleGap(),
    })
    const revision = this.revision
    if (typeof sharedKey !== 'string' || sharedKey.length < 16)
      throw new Error('sharedKey must contain at least 16 characters')
    this.sharedKey = sharedKey
    this.connecting = true
    try {
      const session = await this.createCapability().open({
        service: 'io.github.kumakumapon.ministack',
        transport: 'ble',
        displayName: 'MiniStack PC',
        sharedKey,
      })
      if (revision !== this.revision) {
        session.close()
        throw new Error('Connection cancelled')
      }
      this.session = session
      const peers = await this.session.discover({ timeoutMs: 1000 })
      if (peers.length !== 1) throw new Error('Expected one MiniStack device')
      if (revision !== this.revision) throw new Error('Connection cancelled')
      this.peer = peers[0].id
      this.unsubscribe = this.session.subscribe('response', (message) => {
        if (message.peer.id !== this.peer) return
        const p = message.payload
        const item = this.pending.get(p?.requestId)
        if (!item || p.v !== 1) return
        if (this.sessionId && p.sessionId !== this.sessionId) {
          this.close(new Error('Device session changed'))
          return
        }
        clearTimeout(item.timer)
        this.pending.delete(p.requestId)
        if (p.ok) item.resolve(p.result)
        else item.reject(new Error(p.error?.code ?? 'invalid-response'))
      })
      this.unsubscribeEvents = this.session.subscribe('event', (message) => {
        if (message.peer.id !== this.peer) return
        // Event IDs restart at 1 each boot, so an event from a restarted MOD would look
        // like one already processed. Drop it and let the reconnect handshake start a
        // fresh tracker rather than deduplicating a new session against an old cursor.
        if (message.payload?.v !== 1 || message.payload?.sessionId !== this.sessionId) return
        const before = this.eventTracker.cursor
        this.eventTracker.ingest(message.payload)
        if (this.eventTracker.cursor !== before) this.ackEvents()
      })
      const capabilities = await this.request('capabilities.get')
      if (revision !== this.revision) throw new Error('Connection cancelled')
      this.sessionId = capabilities.sessionId
      const poll = () => {
        if (!this.polling) {
          this.polling = true
          this.request('state.get')
            .then((state) => {
              this.heartbeatFailures = 0
              this.onState(state)
            })
            .catch((error) => {
              if (revision !== this.revision) return
              this.heartbeatFailures++
              // BLE notifications may transiently lose their ACK. Keep sending
              // authenticated state probes; only close after three consecutive failures.
              if (this.heartbeatFailures >= 3)
                this.close(new Error(`Heartbeat failed (${this.heartbeatFailures} consecutive): ${error.message}`))
            })
            .finally(() => {
              if (revision === this.revision) this.polling = false
            })
          // Rides the same cadence as a backstop for a missed pushed `event`
          // message. Its own failures do not affect heartbeatFailures: the
          // heartbeat above is what decides whether the session is alive.
          this.request('events.since', { afterEventId: this.eventTracker.cursor })
            .then((replay) => {
              if (revision !== this.revision) return
              const before = this.eventTracker.cursor
              this.eventTracker.ingestReplay(replay)
              if (this.eventTracker.cursor !== before) this.ackEvents()
            })
            .catch(() => {})
        }
      }
      this.heartbeat = setInterval(poll, 1000)
      poll()
      this.autoReconnect = this.reconnectAttempts > 0
      this.retries = 0
      return capabilities
    } catch (error) {
      this.close(error)
      throw error
    } finally {
      this.connecting = false
    }
  }
  /** Coalesces acks so a burst of events sends at most one `events.ack` in flight at a time. */
  ackEvents() {
    if (this.ackInFlight) {
      this.ackQueued = true
      return
    }
    this.ackInFlight = true
    this.request('events.ack', { lastEventId: this.eventTracker.cursor })
      // Best-effort: a lost ack only delays the MOD freeing its event buffer,
      // and the next successful ack catches it up.
      .catch(() => {})
      .finally(() => {
        this.ackInFlight = false
        if (this.ackQueued) {
          this.ackQueued = false
          this.ackEvents()
        }
      })
  }
  /**
   * A gap means an event was lost for good, so anything the page inferred
   * from events (a command it thinks is still running, a pending transfer) is
   * now unreliable. Pull fresh ground truth instead of waiting for the next
   * heartbeat tick, and let the caller show the loss rather than swallow it.
   */
  handleGap() {
    this.gap = true
    this.onGap()
    this.request('state.get')
      .then((state) => this.onState(state))
      .catch(() => {})
  }
  /** Downloads a MOD-side transfer in chunks and releases it once complete. */
  async downloadTransfer(transferId, { onProgress } = {}) {
    const bytes = await readTransfer(
      (offset, length) => this.request('transfer.read', { transferId, offset, length }),
      { onProgress },
    )
    await this.request('transfer.release', { transferId }).catch(() => {})
    return bytes
  }
  async request(type, fields = {}) {
    if (!this.session) throw this.disconnectReason ?? new Error('Not connected')
    if (this.pending.size >= 8) throw new Error('Too many requests')
    const requestId = `pc-${++this.counter}`
    const payload = { ...fields, v: 1, requestId, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error('Response timeout'))
      }, 12000)
      this.pending.set(requestId, { resolve, reject, timer })
      this.session.send(this.peer, type, payload).catch((error) => {
        const item = this.pending.get(requestId)
        if (!item) return
        clearTimeout(timer)
        this.pending.delete(requestId)
        reject(error)
      })
    })
  }
  close(reason) {
    const hadSession = !!this.session
    if (reason) this.disconnectReason = reason
    this.revision++
    clearInterval(this.heartbeat)
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = undefined
    this.session?.close()
    this.session = undefined
    this.sessionId = undefined
    for (const item of this.pending.values()) {
      clearTimeout(item.timer)
      item.reject(reason ?? new Error('Disconnected'))
    }
    this.pending.clear()
    if (!hadSession) return
    this.onDisconnect(reason)
    // Only an unexpected drop is retried; an explicit disconnect stays closed.
    if (reason) this.scheduleReconnect(reason)
  }
  /** Stops auto-reconnect and closes the session, for an explicit user action. */
  disconnect() {
    this.autoReconnect = false
    this.close()
  }
  scheduleReconnect(reason) {
    if (!this.autoReconnect || !this.sharedKey || this.retries >= this.reconnectAttempts) return
    const attempt = ++this.retries
    const delayMs = this.reconnectBaseDelayMs * 2 ** (attempt - 1)
    this.onReconnectAttempt({ attempt, attempts: this.reconnectAttempts, delayMs, reason })
    // The callback returns the attempt so a caller driving the schedule can await it.
    this.schedule(() => {
      if (!this.autoReconnect || this.session || this.connecting) return undefined
      // A retry that needs the device chooser cannot run without a user gesture;
      // the rejection surfaces through onDisconnect so the page can say so.
      // A failed attempt keeps the chain going until the budget is spent; a
      // successful one resets it, because the next drop is a new interruption.
      return this.connect(this.sharedKey).catch((error) => this.scheduleReconnect(error))
    }, delayMs)
  }
}
