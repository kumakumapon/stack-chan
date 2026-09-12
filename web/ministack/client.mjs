import { BLELocalPeerCapability } from '../local-peer/ble-local-peer.mjs'

// Call connect from a browser user gesture. Secrets remain in memory only.
export class MiniStackClient {
  constructor(createCapability = () => new BLELocalPeerCapability(), onDisconnect = () => {}) {
    this.createCapability = createCapability
    this.onDisconnect = onDisconnect
    this.pending = new Map()
    this.counter = 0
    this.revision = 0
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
    if (hadSession) this.onDisconnect(reason)
  }
}
