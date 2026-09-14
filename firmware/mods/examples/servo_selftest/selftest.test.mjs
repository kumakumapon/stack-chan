import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyServoSelfTest,
  formatServoSelfTestSummary,
  MOVEMENT_EPSILON_RAD,
  runServoSelfTest,
} from './selftest.js'

const wait = async () => {}

/**
 * Fake head. `movesPerCommand` of 0 models the failure that cost the most device
 * cycles: the command is accepted and acknowledged, but the head stays put.
 */
function fakeMotion({
  movesPerCommand = 1,
  readFails = false,
  readFailsAfter = Number.POSITIVE_INFINITY,
  torqueFails = false,
  power = { configured: true, available: true, enabled: true },
  bus = { framesDecoded: 12, checksumErrors: 0, discardedBytes: 0 },
} = {}) {
  let measured = 0
  let reads = 0
  const diagnostics = { power, bus, pan: { commandsSent: 0 }, tilt: { commandsSent: 0 } }
  return {
    calls: [],
    getDiagnostics() {
      return diagnostics
    },
    async setTorque(value) {
      this.calls.push(['torque', value])
      if (torqueFails) throw new Error('torque rejected')
    },
    async setPose(pose) {
      this.calls.push(['pose', pose.rotation.y])
      diagnostics.pan.commandsSent++
      measured += (pose.rotation.y - measured) * movesPerCommand
    },
    async getRotation() {
      reads++
      if (readFails || reads > readFailsAfter)
        return { success: false, reason: 'scservo command timed out after 120ms' }
      return { success: true, value: { y: measured, p: 0, r: 0 } }
    },
  }
}

test('a healthy head is reported as ok with the movement it actually made', async () => {
  const motion = fakeMotion()
  const report = await runServoSelfTest({ motion, wait })
  assert.equal(report.layer, 'ok')
  assert.ok(report.movedRad > MOVEMENT_EPSILON_RAD)
  assert.equal(report.measurements.length, 3)
  assert.deepEqual(
    motion.calls.filter(([kind]) => kind === 'pose').map(([, yaw]) => yaw),
    [0.12, -0.12, 0],
  )
  assert.ok(report.steps.every((step) => step.ok))
})

test('an acknowledged command that never moves the head is a motion failure', async () => {
  // The CoreS3 case: the position command is correct and acknowledged, but the
  // goal time leaves the head below static friction.
  const report = await runServoSelfTest({ motion: fakeMotion({ movesPerCommand: 0 }), wait })
  assert.equal(report.layer, 'motion')
  assert.equal(report.movedRad, 0)
  assert.equal(report.measurements.length, 3, 'the servos still answer')
})

test('a bus that never decodes a frame is a link failure, a partly readable one is framing', async () => {
  const silent = await runServoSelfTest({
    motion: fakeMotion({ readFails: true, bus: { framesDecoded: 0, checksumErrors: 0, discardedBytes: 0 } }),
    wait,
  })
  assert.equal(silent.layer, 'link')

  const noisy = await runServoSelfTest({
    motion: fakeMotion({ readFails: true, bus: { framesDecoded: 4, checksumErrors: 9, discardedBytes: 40 } }),
    wait,
  })
  assert.equal(noisy.layer, 'framing')

  const intermittent = await runServoSelfTest({ motion: fakeMotion({ readFailsAfter: 1 }), wait })
  assert.equal(intermittent.layer, 'framing')
})

test('an unpowered servo rail outranks every later symptom', async () => {
  const report = await runServoSelfTest({
    motion: fakeMotion({
      movesPerCommand: 0,
      readFails: true,
      power: { configured: true, available: true, enabled: false },
    }),
    wait,
  })
  assert.equal(report.layer, 'power')
  assert.equal(report.steps[0].ok, false)
})

test('a failing step is recorded without aborting the sequence', async () => {
  const report = await runServoSelfTest({ motion: fakeMotion({ torqueFails: true }), wait })
  const torque = report.steps.find((step) => step.name === 'torque')
  assert.equal(torque.ok, false)
  assert.match(torque.detail, /torque rejected/)
  assert.equal(report.measurements.length, 3, 'the sequence continues so the report stays comparable')
})

test('the report is JSON-safe and does not follow the reused diagnostics object', async () => {
  const motion = fakeMotion()
  const report = await runServoSelfTest({ motion, wait })
  const encoded = JSON.stringify(report)
  assert.equal(JSON.parse(encoded).layer, 'ok')
  const commandsSent = report.servo.pan.commandsSent
  motion.getDiagnostics().pan.commandsSent = 999
  assert.equal(report.servo.pan.commandsSent, commandsSent)
})

test('the screen summary names the failing layer', async () => {
  const report = await runServoSelfTest({ motion: fakeMotion({ movesPerCommand: 0 }), wait })
  assert.match(formatServoSelfTestSummary(report), /NG motion/)
  assert.match(formatServoSelfTestSummary(await runServoSelfTest({ motion: fakeMotion(), wait })), /^Servo OK/)
})

test('a head that cannot be read at all is not reported as ok', () => {
  assert.equal(classifyServoSelfTest({ readsAttempted: 0, readsSucceeded: 0, movedRad: 0 }), 'link')
})
