import { createGatewaySocket } from 'stackchan-gateway-socket'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let native
class FakeWebSocket {
  constructor(options) {
    native = this
    this.options = options
    this.sent = []
    this.closed = 0
    this.remaining = 0
  }
  writable(bytes) {
    this.remaining = bytes
    this.options.onWritable(bytes)
  }
  write(bytes) {
    if (this.fail) throw new Error('transport failure')
    assert(bytes.byteLength <= this.remaining, 'adapter exceeded native payload capacity')
    this.sent.push(bytes.byteLength)
    this.remaining = Math.max(0, this.remaining - bytes.byteLength - 8)
    return this.remaining
  }
  close() {
    this.closed++
  }
}
globalThis.device = { network: { ws: { io: FakeWebSocket } } }
let ready = 0
const reasons = []
const socket = createGatewaySocket({
  secure: false,
  host: 'localhost',
  port: 80,
  path: '/',
  onReady: () => ready++,
  onClosed: (reason) => reasons.push(reason),
  onMessage() {},
})

// Payload-only accounting would send both frames despite native overhead.
socket.write('a'.repeat(100))
socket.write('b'.repeat(100))
native.writable(200)
assert(native.sent.length === 1, 'second frame waits for native capacity')
assert(reasons.length === 0, 'backpressure does not disconnect')
native.writable(200)
assert(native.sent.length === 2, 'queued frame resumes on writable notification')
assert(ready === 1, 'ready callback is only emitted once')
socket.write('c'.repeat(100))
assert(native.sent.length === 2, 'synchronous writes also respect remaining capacity')
native.writable(200)
assert(native.sent.length === 3, 'later audio frames resume without loss')

socket.write('d'.repeat(100))
native.fail = true
native.writable(200)
assert(reasons.length === 1 && reasons[0] === 'transport failure', 'async failures report disconnection')
assert(native.closed === 1, 'failed transport is closed once')
socket.close()
assert(native.closed === 1, 'close is idempotent')
const queueReasons = []
const queued = createGatewaySocket({
  secure: false,
  host: 'localhost',
  port: 80,
  path: '/',
  onReady() {},
  onClosed: (reason) => queueReasons.push(reason),
  onMessage() {},
})
native.writable(0)
assert(queued.write('a'.repeat(32000), true) === true, 'audio accepted within bound')
assert(queued.write('b'.repeat(1000), true) === false, 'full queue signals backpressure')
assert(native.closed === 0 && queueReasons.length === 0, 'capacity does not close transport')
assert(queued.write('control') === true, 'control fits remaining capacity')
queued.clearPendingAudio()
native.writable(40000)
assert(native.sent.length === 1 && native.sent[0] === 7, 'clearing audio preserves control messages')
assert(queued.write('resumed', true) === true, 'capacity and writes recover after clearing')
queued.close()
trace('ok\n')
