import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  encodeSCServoCommand,
  fromBigEndianBytes,
  SCSERVO_ADDRESS,
  SCSERVO_COMMAND,
  scservoChecksum,
  toBigEndianBytes,
  WRITE_POSITION_VALUE_COUNT,
  writePositionValues,
} from '../protocols/scservo-codec.js'
import { SCServoDecoder, type SCServoFrame } from '../protocols/scservo-decoder.js'

function decodeOwnFrame(packet: Uint8Array, length: number): SCServoFrame | undefined {
  let decoded: SCServoFrame | undefined
  const decoder = new SCServoDecoder((frame) => {
    decoded = frame
  })
  for (let i = 0; i < length; i++) decoder.push(packet[i])
  return decoded
}

test('encoded commands carry the declared length and a checksum the decoder accepts', () => {
  const buffer = new Uint8Array(64)
  const length = encodeSCServoCommand(buffer, 1, SCSERVO_COMMAND.READ, SCSERVO_ADDRESS.PRESENT_POSITION, [2])
  assert.deepEqual(Array.from(buffer.subarray(0, 4)), [0xff, 0xff, 1, 4])
  assert.equal(length, buffer[3] + 4)
  // The bus echoes our own frames, so a command must survive the same decoder.
  const frame = decodeOwnFrame(buffer, length)
  assert.equal(frame?.id, 1)
  assert.equal(frame?.status, SCSERVO_COMMAND.READ)
})

test('write commands place every value after the address in order', () => {
  const buffer = new Uint8Array(64)
  const values = [1, 2, 3]
  const length = encodeSCServoCommand(buffer, 7, SCSERVO_COMMAND.WRITE, SCSERVO_ADDRESS.GOAL_POSITION, values)
  assert.equal(buffer[2], 7)
  assert.equal(buffer[4], SCSERVO_COMMAND.WRITE)
  assert.equal(buffer[5], SCSERVO_ADDRESS.GOAL_POSITION)
  assert.deepEqual(Array.from(buffer.subarray(6, 6 + values.length)), values)
  assert.equal(buffer[length - 1] & 0xff, scservoChecksum(buffer, length - 1) & 0xff)
})

test('a command longer than the transmit buffer is refused instead of truncated', () => {
  assert.throws(
    () => encodeSCServoCommand(new Uint8Array(8), 1, SCSERVO_COMMAND.WRITE, SCSERVO_ADDRESS.GOAL_POSITION, [1, 2, 3]),
    /transmit buffer too small/,
  )
})

test('WritePos fills the whole position, time and speed register window', () => {
  // Regression: writing only position and time left a stale goal speed in the
  // servo, which looked like a dead servo on the device.
  const values = writePositionValues(new Array(WRITE_POSITION_VALUE_COUNT).fill(0xee), 0x0234, 20)
  assert.equal(values.length, WRITE_POSITION_VALUE_COUNT)
  assert.deepEqual(values, [0x02, 0x34, 0x00, 20, 0x00, 0x00])
})

test('goal values survive a big-endian round trip', () => {
  for (const value of [0, 20, 0x03ff, 0xffff]) {
    const [high, low] = toBigEndianBytes(value)
    assert.equal(fromBigEndianBytes(high, low), value)
  }
})
