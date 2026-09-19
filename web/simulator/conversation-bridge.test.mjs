import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationBridge } from './conversation-bridge.mjs'

function harness() {
  const sockets = []
  class Socket {
    readyState = 1
    bufferedAmount = 0
    sent = []
    constructor(url) {
      this.url = url
      sockets.push(this)
    }
    send(data) {
      this.sent.push(data)
    }
    close() {
      this.closed = true
    }
  }
  return { bridge: createConversationBridge({ WebSocketClass: Socket }), sockets }
}
const open = { action: 'open', secure: false, host: 'localhost', port: 8765, path: '/stackchan' }

test('configuration selects standalone or gateway and rejects embedded credentials', () => {
  const { bridge } = harness()
  assert.equal(bridge.exchange({ action: 'config' }).backend, 'none')
  assert.throws(() => bridge.configure({ endpoint: 'https://localhost' }))
  assert.throws(() => bridge.configure({ endpoint: 'ws://user:secret@localhost' }))
  bridge.configure({ endpoint: 'ws://localhost:8765/stackchan', microphone: false })
  assert.equal(bridge.exchange({ action: 'config' }).backend, 'gateway')
  bridge.configure({ endpoint: '' })
  assert.equal(bridge.exchange({ action: 'config' }).backend, 'none')
})

test('transport forwards frames and ignores retired socket callbacks', () => {
  const { bridge, sockets } = harness()
  bridge.exchange(open)
  sockets[0].onopen()
  assert.deepEqual(bridge.exchange({ action: 'socket' }), { type: 'ready' })
  bridge.exchange({ action: 'write', data: 'hello' })
  assert.deepEqual(sockets[0].sent, ['hello'])
  bridge.exchange(open)
  sockets[0].onmessage({ data: 'stale' })
  sockets[0].onclose()
  assert.equal(bridge.exchange({ action: 'socket' }), null)
  sockets[1].onmessage({ data: 'current' })
  assert.deepEqual(bridge.exchange({ action: 'socket' }), { type: 'message', data: 'current' })
  bridge.close()
  assert.equal(sockets[1].closed, true)
})

test('backpressure and oversized inbound frames terminate bounded transport', () => {
  const { bridge, sockets } = harness()
  bridge.exchange(open)
  sockets[0].bufferedAmount = 32769
  assert.throws(() => bridge.exchange({ action: 'write', data: 'hello' }), /overflow/)
  sockets[0].onmessage({ data: 'x'.repeat(262145) })
  assert.equal(sockets[0].closed, true)
  assert.equal(bridge.exchange({ action: 'socket' }).type, 'closed')
})

test('controls and status cross the bridge without implementing a second session', () => {
  const { bridge } = harness()
  bridge.command({ type: 'start' })
  bridge.command({ type: 'text', text: 'こんにちは' })
  assert.deepEqual(bridge.exchange({ action: 'control' }), { type: 'start' })
  assert.deepEqual(bridge.exchange({ action: 'control' }), { type: 'text', text: 'こんにちは' })
  bridge.exchange({ action: 'status', status: { state: 'speaking' } })
  const copy = bridge.status
  copy.state = 'listening'
  assert.equal(bridge.status.state, 'speaking')
})
