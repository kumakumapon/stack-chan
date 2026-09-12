import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SCServoDecoder, type SCServoFrame } from '../protocols/scservo-decoder.js'

const ACK = [0xff, 0xff, 1, 2, 0, 0xfc]
const POSITION = [0xff, 0xff, 1, 4, 0, 1, 0xd8, 0x21]

test('servo responses survive arbitrary prefix noise and fragmented input', () => {
  for (const prefix of [[], [0], [0, 1], [0xff], [0, 0xff], [0xff, 0xff, 0xff]]) {
    const frames: SCServoFrame[] = []
    const decoder = new SCServoDecoder((frame) => frames.push(frame))
    for (const byte of [...prefix, ...ACK, ...POSITION]) decoder.push(byte)
    assert.equal(frames.length, 2, JSON.stringify(prefix))
    assert.deepEqual(frames[0], { id: 1, status: 0, payload: new Uint8Array() })
    assert.deepEqual(Array.from(frames[1].payload), [1, 0xd8])
  }
})

test('invalid lengths and checksums do not block the following response', () => {
  for (const bad of [
    [0xff, 0xff, 1, 0],
    [0xff, 0xff, 1, 255],
    [...ACK.slice(0, -1), 0],
  ]) {
    const frames: SCServoFrame[] = []
    const decoder = new SCServoDecoder((frame) => frames.push(frame))
    for (const byte of [...bad, ...POSITION]) decoder.push(byte)
    assert.equal(frames.length, 1)
    assert.deepEqual(Array.from(frames[0].payload), [1, 0xd8])
  }
})

test('decoder releases consumed bytes before callbacks and owns response payloads', () => {
  const frames: SCServoFrame[] = []
  const decoder = new SCServoDecoder((frame) => {
    frames.push(frame)
    if (frames.length === 1) for (const byte of POSITION) decoder.push(byte)
  })
  for (const byte of ACK) decoder.push(byte)
  for (const byte of ACK) decoder.push(byte)
  assert.equal(frames.length, 3)
  assert.deepEqual(Array.from(frames[1].payload), [1, 0xd8])
})
