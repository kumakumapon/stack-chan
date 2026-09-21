import assert from 'node:assert/strict'
import test from 'node:test'
import { readMicrophone } from './microphone-read.js'

test('reads PCM into reused storage, bounded and sample aligned', () => {
  const storage = new Uint8Array(640)
  const input = {
    read(target: Uint8Array) {
      assert.equal(target.buffer, storage.buffer)
      target.fill(7)
      return target.byteLength
    },
  }
  assert.equal(readMicrophone(input, storage, 4096), storage)
  assert.equal(readMicrophone(input, storage, 101)?.byteLength, 100)
  assert.equal(storage[0], 7)
})

test('stale size is reduced without losing or duplicating available samples', () => {
  const storage = new Uint8Array(640)
  let remaining = 238
  let consumed = 0
  const input = {
    read(target: Uint8Array) {
      if (!remaining) return
      if (target.byteLength > remaining) throw new Error('invalid size')
      for (let i = 0; i < target.byteLength; i++) target[i] = consumed++ % 256
      remaining -= target.byteLength
      return target.byteLength
    },
  }
  const output: number[] = []
  for (;;) {
    const bytes = readMicrophone(input, storage, 640)
    if (!bytes) break
    output.push(...bytes)
  }
  assert.deepEqual(
    output,
    Array.from({ length: 238 }, (_, i) => i % 256),
  )
})

test('empty input ends reading; partial reads expose only initialized bytes', () => {
  const storage = new Uint8Array(640)
  assert.equal(readMicrophone({ read: () => undefined }, storage, 640), undefined)
  assert.equal(readMicrophone({ read: () => 20 }, storage, 640)?.byteLength, 20)
  assert.equal(
    readMicrophone(
      {
        read: () => {
          throw new Error('must not read')
        },
      },
      storage,
      1,
    ),
    undefined,
  )
})

test('other errors and persistently invalid sizes surface without endless retries', () => {
  const storage = new Uint8Array(640)
  const memoryError = new RangeError('not enough memory')
  assert.throws(
    () =>
      readMicrophone(
        {
          read: () => {
            throw memoryError
          },
        },
        storage,
        640,
      ),
    (error) => error === memoryError,
  )
  let attempts = 0
  assert.throws(
    () =>
      readMicrophone(
        {
          read: () => {
            attempts++
            throw new Error('invalid size')
          },
        },
        storage,
        640,
      ),
    /invalid size/,
  )
  assert.ok(attempts < 12)
})
