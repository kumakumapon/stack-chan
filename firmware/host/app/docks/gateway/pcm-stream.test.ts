import assert from 'node:assert/strict'
import test from 'node:test'
import { installGatewayDockTestAliases } from './__tests__/node-aliases.js'
import { encodePCM } from './pcm.js'

installGatewayDockTestAliases()
const { createPCMStream } = await import('./pcm-stream.js')

const format = { codec: 'pcm16' as const, sampleRate: 16000, channels: 1 }
test('PCM starts once the prebuffer threshold is reached, drains in order without re-buffering, and handles replies larger than the queue', async () => {
  const writes: Uint8Array[] = []
  let played!: () => void,
    closed = 0
  const sink = createPCMStream(format, (callback) => {
    played = callback
    return {
      write: (bytes) => writes.push(bytes),
      close: () => {
        closed++
      },
    }
  })
  const frame = (n: number) => new Uint8Array(640).fill(n)
  sink.push(encodePCM(frame(0)))
  sink.push(encodePCM(frame(1)))
  assert.equal(writes.length, 0, 'buffers below the prebuffer threshold instead of writing immediately')
  sink.push(encodePCM(frame(2)))
  assert.deepEqual(writes, [frame(0), frame(1), frame(2)], 'threshold reached: flushes everything queued so far')

  // Once playback has started, a push must not wait for the threshold again:
  // each slot drained by played() is refilled by the very next push.
  for (let i = 3; i < 200; i++) {
    sink.push(encodePCM(frame(i)))
    played()
    assert.deepEqual(writes[writes.length - 1], frame(i))
  }
  sink.push(encodePCM(new Uint8Array(640)))
  let done = false
  const pending = sink.finish().then(() => {
    done = true
  })
  await Promise.resolve()
  assert.equal(done, false)
  for (let i = 0; i < 4; i++) played()
  await pending
  assert.equal(closed, 1)
})

test('PCM buffers below the prebuffer threshold and starts once it is reached', () => {
  const writes: Uint8Array[] = []
  const sink = createPCMStream(format, () => ({
    write: (bytes) => writes.push(bytes),
    close() {},
  }))
  sink.push(encodePCM(new Uint8Array(2048).fill(1)))
  sink.push(encodePCM(new Uint8Array(2048).fill(2)))
  assert.equal(writes.length, 0)
  sink.push(encodePCM(new Uint8Array(2048).fill(3)))
  assert.equal(writes.length, 3)
  assert.deepEqual(writes[0], new Uint8Array(2048).fill(1))
  assert.deepEqual(writes[1], new Uint8Array(2048).fill(2))
  assert.deepEqual(writes[2], new Uint8Array(2048).fill(3))
})

test('finish() flushes audio queued below the prebuffer threshold', async () => {
  const writes: Uint8Array[] = []
  let played!: () => void,
    closed = 0
  const sink = createPCMStream(format, (callback) => {
    played = callback
    return {
      write: (bytes) => writes.push(bytes),
      close: () => {
        closed++
      },
    }
  })
  const frame = new Uint8Array(640).fill(9)
  sink.push(encodePCM(frame))
  assert.equal(writes.length, 0, 'still below the threshold')
  let done = false
  const pending = sink.finish().then(() => {
    done = true
  })
  assert.deepEqual(writes, [frame], 'finish() flushes the short reply immediately, even under threshold')
  played()
  await pending
  assert.equal(done, true)
  assert.equal(closed, 1)
})

test('PCM queue overflow drops the oldest not-yet-sent chunk, keeps in-flight audio intact and keeps draining', async () => {
  const writes: Uint8Array[] = []
  let played!: () => void,
    closed = 0
  const sink = createPCMStream(format, (callback) => {
    played = callback
    return {
      write: (bytes) => writes.push(bytes),
      close: () => {
        closed++
      },
    }
  })
  const pushCount = 20
  const chunkSize = 4096
  for (let i = 0; i < pushCount; i++) sink.push(encodePCM(new Uint8Array(chunkSize).fill(i + 1)))
  // The first two pushes reach the prebuffer threshold and are already
  // handed to output.write(): they must survive later overflow evictions.
  assert.equal(writes.length, 3)
  assert.deepEqual(writes[0], new Uint8Array(2048).fill(1))
  assert.deepEqual(writes[1], new Uint8Array(2048).fill(1))
  assert.deepEqual(writes[2], new Uint8Array(2048).fill(2))

  let done = false
  const pending = sink.finish().then(() => {
    done = true
  })
  for (let i = 0; i < 64 && !done; i++) played()
  await pending
  assert.equal(closed, 1)

  const totalWritten = writes.reduce((sum, bytes) => sum + bytes.byteLength, 0)
  assert.ok(totalWritten < pushCount * chunkSize, 'overflow must drop some not-yet-sent audio')
  assert.ok(totalWritten <= 65536, 'surviving audio must never exceed the queue byte cap')
})

test('PCM cancellation resolves drain, releases output and ignores late callbacks', async () => {
  let played!: () => void,
    writes = 0,
    closed = 0
  const sink = createPCMStream(format, (callback) => {
    played = callback
    return {
      write: () => {
        writes++
      },
      close: () => {
        closed++
      },
    }
  })
  sink.push(encodePCM(new Uint8Array(16384)))
  assert.equal(writes, 3)
  const pending = sink.finish()
  sink.stop()
  played()
  await pending
  assert.equal(writes, 3)
  assert.equal(closed, 1)
})

test('overflow and broken PCM release the output immediately', () => {
  for (const payload of ['!!!', 'AA==', encodePCM(new Uint8Array(65538))]) {
    let closed = false
    const sink = createPCMStream(format, () => ({
      write() {},
      close: () => {
        closed = true
      },
    }))
    assert.throws(() => sink.push(payload))
    assert.equal(closed, true)
  }
})
