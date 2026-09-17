import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MotionRecognizer, type MotionType } from '../imu-motion.js'
import { GestureRecognizer, type TouchPanelGestureType } from '../touch-panel-gesture.js'
import {
  createWasmImuSensor,
  createWasmTouchPanelSensor,
  installWasmSensor,
  type WasmImuReader,
  type WasmSensorEnvironment,
  type WasmTouchPanelReader,
} from './input-sensor-bridge.js'

// A reader whose read() replays scripted "frames" (one frame per sample), and
// advances to the next frame exactly when channel/axis 0 is read. This
// mirrors the real contract (see WASM_IMU_AXES): a driver's sample() reads
// index 0 first, so that is the only safe place to advance scripted motion.
function createScriptedReader(frames: number[][]): { available: () => number; read: (index: number) => number } {
  let frame = -1
  return {
    available: () => 1,
    read(index: number) {
      if (index === 0) frame = Math.min(frame + 1, frames.length - 1)
      return frames[frame]?.[index] ?? 0
    },
  }
}

// --- createWasmTouchPanelSensor -------------------------------------------

test('createWasmTouchPanelSensor returns undefined when the reader is unavailable', () => {
  const reader: WasmTouchPanelReader = { available: () => 0, read: () => 0 }
  assert.equal(createWasmTouchPanelSensor(reader), undefined)
})

test('createWasmTouchPanelSensor reads channels in ascending order starting at 0', () => {
  const calls: number[] = []
  const reader: WasmTouchPanelReader = {
    available: () => 1,
    read: (channel) => {
      calls.push(channel)
      return 0
    },
  }
  const Sensor = createWasmTouchPanelSensor(reader)
  assert.ok(Sensor)
  new Sensor().sample()

  assert.deepEqual(calls, [0, 1, 2])
})

test('createWasmTouchPanelSensor coerces non-finite and negative reads to 0', () => {
  const values = [Number.NaN, -5, Number.POSITIVE_INFINITY]
  const reader: WasmTouchPanelReader = { available: () => 1, read: (channel) => values[channel] }
  const Sensor = createWasmTouchPanelSensor(reader)
  assert.ok(Sensor)

  assert.deepEqual(new Sensor().sample(), [0, 0, 0])
})

test('createWasmTouchPanelSensor passes through legitimate positive intensities', () => {
  const values = [3, 0, 7]
  const reader: WasmTouchPanelReader = { available: () => 1, read: (channel) => values[channel] }
  const Sensor = createWasmTouchPanelSensor(reader)
  assert.ok(Sensor)

  assert.deepEqual(new Sensor().sample(), [3, 0, 7])
})

test('createWasmTouchPanelSensor sample() returns a fresh array each call', () => {
  const reader: WasmTouchPanelReader = { available: () => 1, read: () => 5 }
  const Sensor = createWasmTouchPanelSensor(reader)
  assert.ok(Sensor)
  const sensor = new Sensor()

  const first = sensor.sample()
  first[0] = 999
  const second = sensor.sample()

  assert.deepEqual(second, [5, 5, 5])
})

// --- createWasmImuSensor ----------------------------------------------------

test('createWasmImuSensor returns undefined when the reader is unavailable', () => {
  const reader: WasmImuReader = { available: () => 0, read: () => 0 }
  assert.equal(createWasmImuSensor(reader), undefined)
})

test('createWasmImuSensor reads axes in ascending order starting at 0', () => {
  const calls: number[] = []
  const reader: WasmImuReader = {
    available: () => 1,
    read: (axis) => {
      calls.push(axis)
      return 0
    },
  }
  const Sensor = createWasmImuSensor(reader)
  assert.ok(Sensor)
  new Sensor().sample()

  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5])
})

test('createWasmImuSensor coerces non-finite reads to 0 but keeps legitimate negative values', () => {
  const values = [Number.NaN, -9.8, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 2]
  const reader: WasmImuReader = { available: () => 1, read: (axis) => values[axis] }
  const Sensor = createWasmImuSensor(reader)
  assert.ok(Sensor)

  assert.deepEqual(new Sensor().sample(), {
    accelerometer: { x: 0, y: -9.8, z: 0 },
    gyroscope: { x: 0, y: -1, z: 2 },
  })
})

test('createWasmImuSensor sample() returns a fresh object each call', () => {
  const reader: WasmImuReader = { available: () => 1, read: () => 1 }
  const Sensor = createWasmImuSensor(reader)
  assert.ok(Sensor)
  const sensor = new Sensor()

  const first = sensor.sample()
  first.accelerometer.x = 999
  first.gyroscope.z = 999
  const second = sensor.sample()

  assert.deepEqual(second, {
    accelerometer: { x: 1, y: 1, z: 1 },
    gyroscope: { x: 1, y: 1, z: 1 },
  })
})

// --- installWasmSensor -------------------------------------------------------

test('installWasmSensor creates device.sensor when missing', () => {
  const env: WasmSensorEnvironment = {}
  const sensor = { sample: () => [] }

  installWasmSensor('TouchPanel', sensor, env)

  assert.equal(env.device?.sensor?.TouchPanel, sensor)
})

test('installWasmSensor adds a sensor to an existing device without clobbering it', () => {
  const existingDevice = { sensor: undefined as Record<string, unknown> | undefined }
  const env: WasmSensorEnvironment = { device: existingDevice }
  const sensor = { sample: () => [] }

  installWasmSensor('IMU', sensor, env)

  assert.equal(env.device, existingDevice, 'device object identity must be preserved')
  assert.equal(env.device?.sensor?.IMU, sensor)
})

test('installWasmSensor never replaces an already-installed sensor of another name', () => {
  const fooSensor = { sample: () => [] }
  const existingDevice = { sensor: { Foo: fooSensor } }
  const env: WasmSensorEnvironment = { device: existingDevice }
  const barSensor = { sample: () => [] }

  installWasmSensor('Bar', barSensor, env)

  assert.equal(env.device?.sensor?.Foo, fooSensor, 'sibling sensor should survive')
  assert.equal(env.device?.sensor?.Bar, barSensor)
})

// --- Relational: the WASM drivers must actually drive the real recognizers -

test('createWasmTouchPanelSensor drives GestureRecognizer through press then forwardSwipe', () => {
  // Same script as the "recognizes forward swipe" case in
  // touch-panel-gesture.test.ts: left-only, then center, then right-only.
  const reader = createScriptedReader([
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, 0],
  ])
  const TouchPanel = createWasmTouchPanelSensor(reader)
  assert.ok(TouchPanel)
  const sensor = new TouchPanel()
  const recognizer = new GestureRecognizer()

  const types: TouchPanelGestureType[] = []
  for (let ticks = 0; ticks < 4 * 50; ticks += 50) {
    const gesture = recognizer.update(sensor.sample(), ticks)
    if (gesture) types.push(gesture.type)
  }

  assert.deepEqual(types, ['press', 'forwardSwipe', 'release'])
})

test('createWasmImuSensor drives MotionRecognizer through fallenForward and upsideDown postures', () => {
  const reader = createScriptedReader([
    [0, 0, -1, 0, 0, 0],
    [0, 0, -1, 0, 0, 0],
    [0, 0, -1, 0, 0, 0],
    [0, -1, 0, 0, 0, 0],
    [0, -1, 0, 0, 0, 0],
    [0, -1, 0, 0, 0, 0],
  ])
  const IMU = createWasmImuSensor(reader)
  assert.ok(IMU)
  const sensor = new IMU()
  const recognizer = new MotionRecognizer()

  const types: MotionType[] = []
  for (let ticks = 0; ticks < 6 * 100; ticks += 100) {
    const motion = recognizer.update(sensor.sample(), ticks)
    if (motion) types.push(motion.type)
  }

  assert.deepEqual(types, ['fallenForward', 'upsideDown'])
})

test('createWasmImuSensor drives MotionRecognizer through a shake', () => {
  // Alternating acceleration magnitude, matching the shake fixture in
  // imu-motion.test.ts, sourced through the WASM driver instead of literals.
  const reader = createScriptedReader([
    [0, 1, 0, 0, 0, 0],
    [0, 2.5, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0],
    [0, 2.5, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0],
    [0, 2.5, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0],
    [0, 2.5, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0],
    [0, 2.5, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 0],
  ])
  const IMU = createWasmImuSensor(reader)
  assert.ok(IMU)
  const sensor = new IMU()
  const recognizer = new MotionRecognizer()

  const types: MotionType[] = []
  for (let ticks = 0; ticks < 11 * 100; ticks += 100) {
    const motion = recognizer.update(sensor.sample(), ticks)
    if (motion) types.push(motion.type)
  }

  assert.deepEqual(types, ['shake'])
})
