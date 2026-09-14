import assert from 'node:assert/strict'
import { register } from 'node:module'
import { before, beforeEach, test } from 'node:test'
import Timer from '../../testing/fakes/timer.js'
import './fakes/module-aliases.js'
import { createFakeServoBus, getFakeSerial } from './fakes/serial.js'

/**
 * End-to-end driver behaviour against a scriptable servo bus.
 *
 * The driver chains pan and tilt writes, so a fault on one axis decides whether
 * the other axis is commanded at all. That interaction is what made the CoreS3
 * head failures hard to read on the device.
 */

register(new URL('./fakes/module-aliases.js', import.meta.url))

const GOAL_POSITION_ADDRESS = 42
const PRESENT_POSITION_ADDRESS = 56
const REFERENCE_GOAL_TIME_MS = 20

type DriverModule = typeof import('../m5stackchan-servo-driver.js')
let driver: InstanceType<DriverModule['M5StackChanServoDriver']>
let serial: ReturnType<typeof getFakeSerial>

before(async () => {
  ;(globalThis as typeof globalThis & { trace: (...args: unknown[]) => void }).trace = () => {}
  const { M5StackChanServoDriver } = await import('../m5stackchan-servo-driver.js')
  // The protocol allows one instance per servo id, so the whole file shares one driver.
  driver = new M5StackChanServoDriver()
  serial = getFakeSerial()
})

beforeEach(() => {
  Timer.reset()
  serial.written.length = 0
  serial.fragmentReceive = false
  serial.respond = createFakeServoBus()
})

function positionWrites(): Uint8Array[] {
  return serial.written.filter((packet) => packet[4] === 0x03 && packet[5] === GOAL_POSITION_ADDRESS)
}

test('both axes are commanded with the reference goal time and the full register window', () => {
  // Regression: a goal time derived from the motion duration left the CoreS3 head
  // below static friction, and a short register window left a stale goal speed.
  let error: unknown = 'not called'
  driver.applyRotation({ y: 0.12, p: 0, r: 0 }, 1, (result) => {
    error = result
  })
  Timer.delay(0)
  assert.equal(error, undefined)
  const writes = positionWrites()
  assert.equal(writes.length, 2, 'pan and tilt must both be commanded')
  for (const packet of writes) {
    assert.equal(packet[3], 9, 'length covers six value bytes')
    assert.equal(packet[8], (REFERENCE_GOAL_TIME_MS >> 8) & 0xff)
    assert.equal(packet[9], REFERENCE_GOAL_TIME_MS & 0xff)
    assert.deepEqual(Array.from(packet.subarray(10, 12)), [0, 0], 'goal speed is always rewritten')
  }
  assert.notEqual(writes[0][2], writes[1][2], 'pan and tilt are separate ids')
})

test('a head movement completes even when every acknowledgement is lost', () => {
  serial.respond = createFakeServoBus({ dropResponses: true, echoRequests: true })
  // Counters are cumulative for the life of the driver, so compare deltas.
  const responsesBefore = driver.getDiagnostics().pan.responsesReceived
  const sentBefore = driver.getDiagnostics().pan.commandsSent
  let error: unknown = 'not called'
  driver.applyRotation({ y: -0.12, p: 0.05, r: 0 }, 1, (result) => {
    error = result
  })
  Timer.delay(0)
  assert.equal(error, undefined)
  assert.equal(positionWrites().length, 2, 'the second axis must still be commanded')
  const diagnostics = driver.getDiagnostics()
  assert.equal(diagnostics.pan.commandsSent - sentBefore, 1)
  assert.equal(diagnostics.pan.responsesReceived - responsesBefore, 0, 'an echo is not an acknowledgement')
})

test('diagnostics report the board profile, the power state and both axes', () => {
  driver.onAttached()
  const diagnostics = driver.getDiagnostics()
  // The CoreS3 head bus: UART1, TX=GPIO6, RX=GPIO7, 1 Mbps, ids 1 and 2.
  assert.deepEqual(diagnostics.serial, { port: 1, transmit: 6, receive: 7, baud: 1_000_000 })
  assert.equal(diagnostics.goalTimeMilliseconds, REFERENCE_GOAL_TIME_MS)
  assert.equal(diagnostics.power.configured, true)
  assert.equal(diagnostics.power.available, true)
  assert.equal(diagnostics.power.enabled, true)
  assert.equal(diagnostics.pan.id, 1)
  assert.equal(diagnostics.tilt.id, 2)
  assert.ok(diagnostics.bus)
  driver.onDetached()
  assert.equal(driver.getDiagnostics().power.enabled, false)
})

test('the measured rotation is read back from the servos, not from the last command', () => {
  driver.applyRotation({ y: 0.12, p: 0, r: 0 }, 1)
  Timer.delay(0)
  const commanded = driver.getDiagnostics().pan.lastGoalPosition
  assert.ok(commanded > 0)

  let measured: number | undefined
  driver.getRotation((result) => {
    if (result.success === true) measured = result.value.y
  })
  Timer.delay(0)
  assert.equal(typeof measured, 'number')
  const reads = serial.written.filter((packet) => packet[4] === 0x02 && packet[5] === PRESENT_POSITION_ADDRESS)
  assert.equal(reads.length, 2, 'both axes are read back')
  assert.equal(driver.getDiagnostics().pan.lastReadPosition, commanded)
})

test('a servo that never answers a read is reported as a failure, not as position zero', () => {
  serial.respond = createFakeServoBus({ dropResponses: true })
  let reason: string | undefined
  let success: boolean | undefined
  driver.getRotation((result) => {
    success = result.success
    if (result.success === false) reason = result.reason
  })
  Timer.delay(200)
  assert.equal(success, false)
  assert.match(String(reason), /timed out/)
})
