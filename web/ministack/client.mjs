import { BLELocalPeerCapability } from '../local-peer/ble-local-peer.mjs'

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
    this.autoReconnect = false
    this.retries = 0
  }
  async connect(sharedKey) {
    if (this.connecting) throw new Error('Connection already in progress')
    this.close()
    this.disconnectReason = undefined
    this.polling = false
    this.heartbeatFailures = 0
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
      const capabilities = await this.request('capabilities.get')
      if (revision !== this.revision) throw new Error('Connection cancelled')
      this.sessionId = capabilities.sessionId
      const poll = () => {
        if (!this.polling) {
          this.polling = true
          this.request('state.get')            .then(() => {
              this.heartbeatFailures = 0
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
