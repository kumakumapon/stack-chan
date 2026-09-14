import assert from 'node:assert/strict'
import { register } from 'node:module'
import { afterEach, before, beforeEach, test } from 'node:test'
import Timer from '../../testing/fakes/timer.js'
import './fakes/module-aliases.js'
import { createFakeServoBus, type FakeSerialOptions, getFakeSerial } from './fakes/serial.js'

/**
 * Transport-fault regressions for the SCServo protocol.
 *
 * Every failure reproduced here cost a device flash, a reconnect and a guess
 * during the MiniStack CoreS3 work. They are reproduced against the real
 * protocol implementation driven by a scriptable serial port.
 */

register(new URL('./fakes/module-aliases.js', import.meta.url))

// The protocol opens one shared serial port for the whole module, so every test
// in this file talks to the same bus and uses its own servo id.
const SERIAL = { port: 1, transmit: 6, receive: 7, baud: 1_000_000 }
const GOAL_POSITION_ADDRESS = 42
const WRITE = 0x03
const RESPONSE_TIMEOUT_MS = 120
const RECOVERY_DELAY_MS = 20

type SCServoModule = typeof import('../protocols/scservo.js')
let SCServo: SCServoModule['default']
let serial: ReturnType<typeof getFakeSerial>
let nextId = 1

before(async () => {
  ;(globalThis as typeof globalThis & { trace: (...args: unknown[]) => void }).trace = () => {}
  SCServo = (await import('../protocols/scservo.js')).default
  // Opening the port is what creates the shared packet handler.
  new SCServo({ id: 0x40, serial: SERIAL as FakeSerialOptions }).teardown()
  serial = getFakeSerial()
})

beforeEach(() => {
  Timer.reset()
  serial.written.length = 0
  serial.failWrites = false
  serial.fragmentReceive = false
  serial.respond = createFakeServoBus()
})

afterEach(() => {
  Timer.reset()
})

function createServo(awaitWriteResponse = false) {
  return new SCServo({ id: nextId++, serial: SERIAL as FakeSerialOptions, awaitWriteResponse })
}

function lastWrite(): Uint8Array {
  return serial.written[serial.written.length - 1]
}

test('a position command writes the whole register window at the requested goal time', () => {
  const servo = createServo()
  try {
    let error: unknown = 'not called'
    servo.setRawPositionInTime(600, 20, (result) => {
      error = result
    })
    Timer.delay(0)
    assert.equal(error, undefined)
    const packet = lastWrite()
    assert.equal(packet[2], servo.id)
    assert.equal(packet[4], WRITE)
    assert.equal(packet[5], GOAL_POSITION_ADDRESS)
    // position high/low, goal time high/low, goal speed high/low
    assert.deepEqual(Array.from(packet.subarray(6, 12)), [(600 >> 8) & 0xff, 600 & 0xff, 0, 20, 0, 0])
  } finally {
    servo.teardown()
  }
})

test('a lost write acknowledgement does not turn an issued command into a failure', () => {
  // Regression: treating a missing ACK as an error stopped the MiniStack MOD and
  // its BLE session even though the servo had already been commanded.
  const servo = createServo()
  serial.respond = createFakeServoBus({ dropResponses: true })
  try {
    const errors: unknown[] = []
    servo.setRawPositionInTime(600, 20, (error) => errors.push(error))
    Timer.delay(0)
    servo.setRawPositionInTime(400, 20, (error) => errors.push(error))
    Timer.delay(0)
    assert.deepEqual(errors, [undefined, undefined])
    const diagnostics = servo.getDiagnostics()
    assert.equal(diagnostics.commandsSent, 2)
    assert.equal(diagnostics.responsesReceived, 0)
    assert.equal(diagnostics.lastGoalPosition, 400)
    assert.equal(diagnostics.lastGoalTimeMilliseconds, 20)
  } finally {
    servo.teardown()
  }
})

test('a read survives line noise and a response split across reads', () => {
  // Regression: the previous receive state machine let a noise byte consume the
  // first FF of a valid header, so a healthy servo looked unreachable.
  for (const noisePrefix of [[0xff], [0x00, 0xff, 0xff], [0xff, 0xff, 0x01]]) {
    const servo = createServo()
    serial.fragmentReceive = true
    serial.respond = createFakeServoBus({ noisePrefix, echoRequests: true })
    try {
      servo.setRawPosition(700)
      Timer.delay(0)
      let position = -1
      servo.readRawPosition((result) => {
        if (result.success === true) position = result.value.position
      })
      Timer.delay(0)
      assert.equal(position, 700, JSON.stringify(noisePrefix))
      assert.equal(servo.getDiagnostics().lastReadPosition, 700)
    } finally {
      servo.teardown()
    }
  }
})

test('a corrupt response is discarded, reported as a timeout, and the queue recovers', () => {
  const servo = createServo()
  const checksumErrorsBefore = SCServo.getBusDiagnostics()?.checksumErrors ?? 0
  serial.respond = createFakeServoBus({ corruptChecksum: true })
  try {
    let reason: string | undefined
    servo.readRawPosition((result) => {
      if (result.success === false) reason = result.reason
    })
    Timer.delay(RESPONSE_TIMEOUT_MS)
    assert.match(String(reason), /timed out/)
    assert.equal(servo.getDiagnostics().responseTimeouts, 1)
    assert.ok((SCServo.getBusDiagnostics()?.checksumErrors ?? 0) > checksumErrorsBefore)

    serial.respond = createFakeServoBus()
    let position = -1
    servo.readRawPosition((result) => {
      if (result.success === true) position = result.value.position
    })
    Timer.delay(RECOVERY_DELAY_MS)
    assert.equal(position, 512, 'the command queue must recover after a timeout')
  } finally {
    servo.teardown()
  }
})

test('our own echoed commands are never mistaken for a response', () => {
  const servo = createServo()
  const echoesBefore = SCServo.getBusDiagnostics()?.echoesIgnored ?? 0
  serial.respond = createFakeServoBus({ echoRequests: true, dropResponses: true })
  try {
    let reason: string | undefined
    servo.readRawPosition((result) => {
      if (result.success === false) reason = result.reason
    })
    Timer.delay(RESPONSE_TIMEOUT_MS)
    assert.match(String(reason), /timed out/)
    assert.ok((SCServo.getBusDiagnostics()?.echoesIgnored ?? 0) > echoesBefore)
    assert.equal(servo.getDiagnostics().responsesReceived, 0)
  } finally {
    servo.teardown()
  }
})

test('a failed serial write is reported once and leaves the servo usable', () => {
  const servo = createServo()
  serial.failWrites = true
  try {
    const errors: unknown[] = []
    servo.setRawPosition(600, (error) => errors.push(error))
    // The protocol retries a failed write once before giving up.
    Timer.delay(2)
    assert.equal(errors.length, 1)
    assert.match(String((errors[0] as Error).message), /serial write failed/)
    assert.equal(servo.getDiagnostics().writeFailures, 1)

    serial.failWrites = false
    servo.setRawPosition(400, (error) => errors.push(error))
    Timer.delay(0)
    assert.deepEqual(errors.slice(1), [undefined])
  } finally {
    servo.teardown()
  }
})

test('diagnostics separate a silent bus from a noisy one', () => {
  const servo = createServo()
  try {
    serial.respond = createFakeServoBus({ dropResponses: true })
    servo.setRawPositionInTime(600, 20)
    Timer.delay(0)
    const silent = servo.getDiagnostics()
    assert.equal(silent.commandsSent, 1)
    assert.equal(silent.responsesReceived, 0)
    assert.equal(silent.lastErrorMessage, null)

    const discardedBefore = SCServo.getBusDiagnostics()?.discardedBytes ?? 0
    serial.respond = () => [0x12, 0x34, 0x56]
    servo.setRawPositionInTime(400, 20)
    Timer.delay(0)
    assert.ok(
      (SCServo.getBusDiagnostics()?.discardedBytes ?? 0) > discardedBefore,
      'noise must be counted, not silently dropped',
    )
  } finally {
    servo.teardown()
  }
})
