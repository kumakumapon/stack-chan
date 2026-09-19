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
test('base64 codec agrees with an independent byte encoder for every tail length', () => {
  for (let n = 0; n < 260; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => i)
    const encoded = encodePCM(bytes)
    assert.equal(encoded, Buffer.from(bytes).toString('base64'))
    assert.deepEqual(decodePCM(encoded), bytes)
  }
  assert.throws(() => decodePCM('invalid!'))
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
