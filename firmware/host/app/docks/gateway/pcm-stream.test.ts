import assert from 'node:assert/strict'
import test from 'node:test'
import { installGatewayDockTestAliases } from './__tests__/node-aliases.js'
import { encodePCM } from './pcm.js'

installGatewayDockTestAliases()
const { createPCMStream } = await import('./pcm-stream.js')

const format = { codec: 'pcm16' as const, sampleRate: 16000, channels: 1 }
test('PCM starts before completion, drains in order and handles replies larger than the queue', async () => {
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
  for (let i = 0; i < 200; i++) {
    const frame = new Uint8Array(640).fill(i)
    sink.push(encodePCM(frame))
    assert.deepEqual(writes[i], frame)
    played()
  }
  sink.push(encodePCM(new Uint8Array(640)))
  let done = false
  const pending = sink.finish().then(() => {
    done = true
  })
  await Promise.resolve()
  assert.equal(done, false)
  played()
  await pending
  assert.equal(closed, 1)
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
