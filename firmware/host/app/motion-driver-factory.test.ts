import assert from 'node:assert/strict'
import { register } from 'node:module'
import { before, test } from 'node:test'

register(new URL('../modules/motion/__tests__/fakes/module-aliases.js', import.meta.url))

type Factory = typeof import('./motion-driver-factory.js')
let createHostMotionDriver: Factory['createHostMotionDriver']
let productDriver: ReturnType<Factory['createHostMotionDriver']>

before(async () => {
  ;(globalThis as typeof globalThis & { trace: (...args: unknown[]) => void }).trace = () => {}
  ;({ createHostMotionDriver } = await import('./motion-driver-factory.js'))
  productDriver = createHostMotionDriver({ panId: 31, tiltId: 32 })
})

test('the host defaults to the calibrated M5StackChan driver and forwards its settings', async () => {
  const { M5StackChanServoDriver } = await import('../modules/motion/m5stackchan-servo-driver.js')
  assert.ok(productDriver instanceof M5StackChanServoDriver)
  const diagnostics = productDriver.getDiagnostics()
  assert.equal(diagnostics.pan.id, 31)
  assert.equal(diagnostics.tilt.id, 32)
  assert.equal(diagnostics.power.configured, true)
})

test('desktop no-hardware mode completes motion callbacks without accessing the servo bus', async () => {
  const { NoneDriver } = await import('../modules/motion/none-driver.js')
  const driver = createHostMotionDriver({ type: 'none' })
  assert.ok(driver instanceof NoneDriver)
  const calls: string[] = []
  driver.setTorque(true, (error) => {
    assert.equal(error, undefined)
    calls.push('torque')
  })
  driver.applyRotation({ y: 0.1, p: 0.2, r: 0 }, 1, (error) => {
    assert.equal(error, undefined)
    calls.push('move')
  })
  driver.getRotation((result) => {
    assert.deepEqual(result, { success: true, value: { y: 0, p: 0, r: 0 } })
    calls.push('read')
  })
  assert.deepEqual(calls, ['torque', 'move', 'read'])
})

test('retired and unknown motion drivers are rejected instead of selecting different hardware', () => {
  for (const type of ['dynamixel', 'rs30x', 'pwm', 'scservo', 'unknown', '']) {
    assert.throws(() => createHostMotionDriver({ type }), /Unsupported motion driver/)
  }
})
