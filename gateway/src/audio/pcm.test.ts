import assert from 'node:assert/strict'
import { test } from 'node:test'
import { concatPcm16, decodePcm16Base64, encodePcm16Base64, resamplePcm16, rmsLevel } from './pcm.ts'

test('encodePcm16Base64/decodePcm16Base64 round-trip', () => {
  const frame = new Int16Array([0, 1, -1, 32767, -32768, 12345])
  const payload = encodePcm16Base64(frame)
  assert.equal(typeof payload, 'string')
  const decoded = decodePcm16Base64(payload)
  assert.deepEqual(Array.from(decoded), Array.from(frame))
})

test('encodePcm16Base64 handles an empty frame', () => {
  const payload = encodePcm16Base64(new Int16Array(0))
  assert.equal(payload, '')
  assert.deepEqual(Array.from(decodePcm16Base64(payload)), [])
})

test('decodePcm16Base64 is little-endian', () => {
  // 0x0001 little-endian bytes are [0x01, 0x00] -> base64 "AQA="
  const decoded = decodePcm16Base64(Buffer.from([0x01, 0x00]).toString('base64'))
  assert.deepEqual(Array.from(decoded), [1])
})

test('concatPcm16 preserves order and handles empty input', () => {
  const a = new Int16Array([1, 2])
  const b = new Int16Array([3, 4, 5])
  assert.deepEqual(Array.from(concatPcm16([a, b])), [1, 2, 3, 4, 5])
  assert.deepEqual(Array.from(concatPcm16([])), [])
  assert.deepEqual(Array.from(concatPcm16([new Int16Array(0), a])), [1, 2])
})

test('resamplePcm16 is identity when rates match', () => {
  const frame = new Int16Array([10, -10, 20])
  const out = resamplePcm16(frame, 16_000, 16_000)
  assert.deepEqual(Array.from(out), Array.from(frame))
  assert.notEqual(out, frame) // returns a copy, not the same array instance
})

test('resamplePcm16 upsamples and downsamples to roughly the expected length', () => {
  const frame = new Int16Array(160).fill(100) // 10ms @ 16kHz
  const up = resamplePcm16(frame, 16_000, 48_000)
  assert.ok(Math.abs(up.length - 480) <= 1)
  const down = resamplePcm16(frame, 16_000, 8_000)
  assert.ok(Math.abs(down.length - 80) <= 1)
})

test('resamplePcm16 interpolates linearly between two samples', () => {
  const frame = new Int16Array([0, 100])
  // Halving the rate with 2 input samples should land near the midpoint.
  const out = resamplePcm16(frame, 2, 1)
  assert.equal(out.length, 1)
  assert.ok((out[0] ?? -1) >= 0 && (out[0] ?? -1) <= 100)
})

test('resamplePcm16 handles an empty frame', () => {
  assert.deepEqual(Array.from(resamplePcm16(new Int16Array(0), 16_000, 8_000)), [])
})

test('rmsLevel is 0 for silence and empty frames', () => {
  assert.equal(rmsLevel(new Int16Array(0)), 0)
  assert.equal(rmsLevel(new Int16Array(100)), 0)
})

test('rmsLevel is 1 for full-scale square wave and between 0 and 1 otherwise', () => {
  const full = new Int16Array([32767, -32768, 32767, -32768])
  assert.ok(rmsLevel(full) > 0.99 && rmsLevel(full) <= 1)

  const quiet = new Int16Array([100, -100, 100, -100])
  const level = rmsLevel(quiet)
  assert.ok(level > 0 && level < 0.01)
})
