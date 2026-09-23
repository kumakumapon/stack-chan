import assert from 'node:assert/strict'
import test from 'node:test'
import { decodePCM, encodePCM, PCMFramer, pcmWave } from './pcm.js'

test('stereo PCM split at arbitrary byte boundaries becomes 20ms mono frames', () => {
  const source = new Uint8Array(1280),
    view = new DataView(source.buffer)
  for (let i = 0; i < 320; i++) {
    view.setInt16(i * 4, -1000, true)
    view.setInt16(i * 4 + 2, 3000, true)
  }
  const frames: Uint8Array[] = []
  const framer = new PCMFramer(2, (frame) => frames.push(frame))
  for (let i = 0; i < source.length; i += 7) framer.push(source.subarray(i, i + 7))
  assert.equal(frames.length, 1)
  const mono = new DataView(frames[0].buffer)
  assert.equal(mono.byteLength, 640)
  for (let i = 0; i < 320; i++) assert.equal(mono.getInt16(i * 2, true), 1000)
})
test('PCM frames are independent and preserve signed extremes', () => {
  const frames: Uint8Array[] = []
  const framer = new PCMFramer(1, (frame) => frames.push(frame))
  framer.push(new Uint8Array(640).fill(255))
  framer.push(new Uint8Array(640))
  assert.equal(frames[0][0], 255)
  assert.equal(frames[1][0], 0)
  assert.throws(() => new PCMFramer(3, () => {}))
})
test('40ms mono frames preserve the same byte stream with fewer messages', () => {
  const source = Uint8Array.from({ length: 1280 * 3 + 320 }, (_, index) => index & 255)
  const frames: Uint8Array[] = []
  const framer = new PCMFramer(1, (frame) => frames.push(frame), 1280)
  for (let at = 0; at < source.length; at += 137) framer.push(source.subarray(at, at + 137))
  assert.equal(frames.length, 3)
  for (let index = 0; index < frames.length; index++)
    assert.deepEqual(frames[index], source.slice(index * 1280, (index + 1) * 1280))
  assert.throws(() => new PCMFramer(1, () => {}, 0), RangeError)
  assert.throws(() => new PCMFramer(1, () => {}, 1279), RangeError)
})
test('base64 codec agrees with an independent byte encoder for every tail length', () => {
  for (const n of [...Array.from({ length: 260 }, (_, i) => i), 640, 1280, 16384]) {
    const storage = Uint8Array.from({ length: n + 9 }, (_, i) => i * 31)
    const bytes = storage.subarray(3, n + 3)
    const encoded = encodePCM(bytes)
    assert.equal(encoded, Buffer.from(bytes).toString('base64'))
    assert.deepEqual(decodePCM(encoded), bytes)
    Object.defineProperty(bytes, 'toBase64', { value: undefined })
    assert.equal(encodePCM(bytes), encoded, 'fallback matches native output, padding and view boundaries')
  }
  assert.throws(() => decodePCM('invalid!'))
})

test('framing preserves independently mixed samples across mono/stereo chunks and frame boundaries', () => {
  const values = [-32768, 32767, -1, 0, 1, -30001, 10000]
  for (const channels of [1, 2]) {
    const samples = 320 * 3 + 17
    const storage = new Uint8Array(samples * channels * 2 + 5)
    const input = storage.subarray(3, storage.length - 2)
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength)
    const expected = new Uint8Array(samples * 2)
    const output = new DataView(expected.buffer)
    for (let sample = 0; sample < samples; sample++) {
      let sum = 0
      for (let channel = 0; channel < channels; channel++) {
        const value = values[(sample * channels + channel) % values.length]
        view.setInt16((sample * channels + channel) * 2, value, true)
        sum += value
      }
      output.setInt16(sample * 2, Math.round(sum / channels), true)
    }
    for (const chunk of [1, 2, 3, 4, 7, 639, 640, 641, 1280, 4096]) {
      const frames: Uint8Array[] = []
      const framer = new PCMFramer(channels, (frame) => frames.push(frame))
      for (let at = 0; at < input.length; at += chunk) {
        framer.push(input.subarray(at, at + chunk))
        framer.push(new Uint8Array(0))
      }
      assert.equal(frames.length, 3)
      for (let i = 0; i < frames.length; i++) assert.deepEqual(frames[i], expected.slice(i * 640, (i + 1) * 640))
      assert.notEqual(frames[0].buffer, frames[1].buffer)
    }
  }
})
test('PCM wave has a valid mono 16kHz header and unchanged samples', () => {
  const samples = new Uint8Array([255, 127, 0, 128])
  const wave = pcmWave([encodePCM(samples)], 16000, 1),
    view = new DataView(wave)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint32(40, true), samples.length)
  assert.deepEqual(new Uint8Array(wave, 44), samples)
  assert.throws(() => pcmWave([], 48000, 2))
})
