import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { MotionRecognizer, type MotionType } from '../imu-motion.js'
import { GestureRecognizer, type TouchPanelGestureType } from '../touch-panel-gesture.js'
import { createWasmImuSensor, createWasmTouchPanelSensor } from './input-sensor-bridge.js'

/**
 * The browser half of the simulator input bridges lives in `web/simulator/bridge.mjs`
 * and is maintained independently of this package. Unit tests on either side can
 * both pass while the two disagree about channel order, axis order, units, or the
 * sample-boundary rule, and the only symptom would be a simulator whose head touch
 * and IMU quietly do nothing.
 *
 * So drive the real browser bridge through the real WASM driver into the real
 * recognizers, at the poll intervals the firmware actually uses.
 *
 * The web sources are plain dependency-free ESM, so they load directly. The import
 * specifier is built at runtime on purpose: a literal would put the module under
 * this package's tsconfig rootDir, which it is not.
 */

const WEB_BRIDGE_PATH = resolve(process.cwd(), '../web/simulator/bridge.mjs')

/** Poll intervals the firmware drivers default to; see touch-panel.ts and imu.ts. */
const TOUCH_PANEL_INTERVAL_MS = 50
const IMU_INTERVAL_MS = 100

type TouchPanelHostBridge = {
  TouchPanel: { read(channel: number): number }
  setPosition(position: number): void
  release(): void
  swipe(direction: 'forward' | 'backward'): unknown
  cancel(): void
}

type ImuVector = { x: number; y: number; z: number }

type ImuHostBridge = {
  IMU: { read(axis: number): number }
  setOrientation(name: string): void
  shake(options?: { durationMs?: number }): unknown
  isShaking(): boolean
  cancel(): void
}

type WebBridgeModule = {
  createHostTouchPanelBridge(options?: Record<string, unknown>): TouchPanelHostBridge
  createHostImuBridge(options?: Record<string, unknown>): ImuHostBridge
  IMU_ORIENTATIONS: Record<string, ImuVector>
}

async function loadWebBridge(): Promise<WebBridgeModule> {
  assert.ok(
    existsSync(WEB_BRIDGE_PATH),
    `the simulator bridge contract needs ${WEB_BRIDGE_PATH}; run this from the firmware package in a full checkout`,
  )
  return (await import(pathToFileURL(WEB_BRIDGE_PATH).href)) as WebBridgeModule
}

/** Deterministic clock: the browser bridge schedules its swipe steps through these. */
function createFakeClock() {
  let now = 0
  let nextHandle = 1
  const pending = new Map<number, { dueAt: number; callback: () => void }>()

  return {
    get now() {
      return now
    },
    setTimeoutFn(callback: () => void, delay = 0): number {
      const handle = nextHandle++
      pending.set(handle, { dueAt: now + delay, callback })
      return handle
    },
    clearTimeoutFn(handle: number): void {
      pending.delete(handle)
    },
    /** Advances to `target`, firing everything due at or before it, oldest first. */
    advanceTo(target: number): void {
      while (true) {
        let dueHandle: number | undefined
        let dueAt = Number.POSITIVE_INFINITY
        for (const [handle, timer] of pending) {
          if (timer.dueAt <= target && timer.dueAt < dueAt) {
            dueAt = timer.dueAt
            dueHandle = handle
          }
        }
        if (dueHandle === undefined) break
        const timer = pending.get(dueHandle)
        pending.delete(dueHandle)
        now = dueAt
        timer?.callback()
      }
      now = target
    },
  }
}

function touchPanelDriver(host: TouchPanelHostBridge) {
  const Sensor = createWasmTouchPanelSensor({ available: () => 1, read: (channel) => host.TouchPanel.read(channel) })
  assert.ok(Sensor, 'the WASM touch panel sensor must exist while the browser bridge is present')
  return new Sensor()
}

function imuDriver(host: ImuHostBridge) {
  const Sensor = createWasmImuSensor({ available: () => 1, read: (axis) => host.IMU.read(axis) })
  assert.ok(Sensor, 'the WASM IMU sensor must exist while the browser bridge is present')
  return new Sensor()
}

test('a browser head swipe reaches the firmware gesture recognizer as a forwardSwipe', async () => {
  const { createHostTouchPanelBridge } = await loadWebBridge()
  const clock = createFakeClock()
  const host = createHostTouchPanelBridge({
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })
  const driver = touchPanelDriver(host)
  const recognizer = new GestureRecognizer()
  const gestures: TouchPanelGestureType[] = []

  host.swipe('forward')
  // Poll exactly as TouchPanel.start() does, letting the browser's scripted steps
  // land between polls rather than driving the recognizer from the script directly.
  for (let elapsed = 0; elapsed <= 900; elapsed += TOUCH_PANEL_INTERVAL_MS) {
    clock.advanceTo(elapsed)
    const gesture = recognizer.update(driver.sample(), clock.now)
    if (gesture) gestures.push(gesture.type)
  }

  assert.deepEqual(gestures, ['press', 'forwardSwipe', 'release'])
})

test('a browser head swipe the other way reaches the recognizer as a backwardSwipe', async () => {
  const { createHostTouchPanelBridge } = await loadWebBridge()
  const clock = createFakeClock()
  const host = createHostTouchPanelBridge({
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })
  const driver = touchPanelDriver(host)
  const recognizer = new GestureRecognizer()
  const gestures: TouchPanelGestureType[] = []

  host.swipe('backward')
  for (let elapsed = 0; elapsed <= 900; elapsed += TOUCH_PANEL_INTERVAL_MS) {
    clock.advanceTo(elapsed)
    const gesture = recognizer.update(driver.sample(), clock.now)
    if (gesture) gestures.push(gesture.type)
  }

  assert.deepEqual(gestures, ['press', 'backwardSwipe', 'release'])
})

test('repeated browser head swipes reproduce the petting cadence the default behavior looks for', async () => {
  const { createHostTouchPanelBridge } = await loadWebBridge()
  const clock = createFakeClock()
  const host = createHostTouchPanelBridge({
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })
  const driver = touchPanelDriver(host)
  const recognizer = new GestureRecognizer()
  const swipes: TouchPanelGestureType[] = []

  let elapsed = 0
  for (const direction of ['forward', 'backward', 'forward'] as const) {
    host.swipe(direction)
    const until = elapsed + 700
    for (; elapsed <= until; elapsed += TOUCH_PANEL_INTERVAL_MS) {
      clock.advanceTo(elapsed)
      const gesture = recognizer.update(driver.sample(), clock.now)
      if (gesture?.type === 'forwardSwipe' || gesture?.type === 'backwardSwipe') swipes.push(gesture.type)
    }
  }

  assert.deepEqual(swipes, ['forwardSwipe', 'backwardSwipe', 'forwardSwipe'])
})

test('a released browser panel reads as untouched by the firmware driver', async () => {
  const { createHostTouchPanelBridge } = await loadWebBridge()
  const host = createHostTouchPanelBridge()
  const driver = touchPanelDriver(host)

  host.setPosition(0)
  assert.ok(
    driver.sample().some((intensity) => intensity > 0),
    'a positioned panel must read as touched',
  )
  host.release()
  assert.deepEqual(driver.sample(), [0, 0, 0])
})

test('each browser IMU orientation reaches the firmware recognizer as its own posture', async () => {
  const { createHostImuBridge } = await loadWebBridge()
  const expected: Array<[string, MotionType]> = [
    ['fallenForward', 'fallenForward'],
    ['fallenBackward', 'fallenBackward'],
    ['fallenLeft', 'fallenLeft'],
    ['fallenRight', 'fallenRight'],
    ['upsideDown', 'upsideDown'],
  ]

  for (const [orientation, posture] of expected) {
    const host = createHostImuBridge()
    const driver = imuDriver(host)
    const recognizer = new MotionRecognizer()
    const motions: MotionType[] = []
    let ticks = 0

    // Settle upright first, the way a simulator session starts, so the posture
    // change is a real transition rather than the recognizer's initial unknown.
    host.setOrientation('upright')
    for (let index = 0; index < 5; index += 1, ticks += IMU_INTERVAL_MS) {
      const motion = recognizer.update(driver.sample(), ticks)
      if (motion) motions.push(motion.type)
    }
    host.setOrientation(orientation)
    for (let index = 0; index < 5; index += 1, ticks += IMU_INTERVAL_MS) {
      const motion = recognizer.update(driver.sample(), ticks)
      if (motion) motions.push(motion.type)
    }

    assert.deepEqual(motions, [posture], `${orientation} must be recognized as ${posture}`)
  }
})

test('a browser shake reaches the firmware recognizer as a shake and reports no bogus posture', async () => {
  const { createHostImuBridge } = await loadWebBridge()
  const clock = createFakeClock()
  const host = createHostImuBridge({
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })
  const driver = imuDriver(host)
  const recognizer = new MotionRecognizer()
  const motions: MotionType[] = []

  host.setOrientation('upright')
  for (let ticks = 0; ticks < 5 * IMU_INTERVAL_MS; ticks += IMU_INTERVAL_MS) {
    const motion = recognizer.update(driver.sample(), ticks)
    if (motion) motions.push(motion.type)
  }

  host.shake()
  let ticks = 5 * IMU_INTERVAL_MS
  for (; ticks <= 5 * IMU_INTERVAL_MS + 1400; ticks += IMU_INTERVAL_MS) {
    clock.advanceTo(ticks)
    const motion = recognizer.update(driver.sample(), ticks)
    if (motion) motions.push(motion.type)
  }

  // The waveform inverts the measured vector on alternate samples, which the
  // posture rule would read as upsideDown if it ever stabilized. It must not:
  // shake is the only thing a shake reports.
  assert.deepEqual(motions, ['shake'])
  assert.equal(host.isShaking(), false, 'the shake must stop on its own after its duration')
})

test('the shake waveform advances per firmware sample, not per axis read', async () => {
  const { createHostImuBridge } = await loadWebBridge()
  const clock = createFakeClock()
  const host = createHostImuBridge({
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  })
  const driver = imuDriver(host)

  host.setOrientation('upright')
  host.shake()
  const first = driver.sample().accelerometer
  const second = driver.sample().accelerometer

  // Within one sample() the six axis reads must describe one consistent vector;
  // only the next sample() may move the waveform on.
  assert.notEqual(first.y, second.y, 'consecutive samples must differ while shaking')
  // The waveform scales the resting vector, so an upright shake stays on the Y
  // axis. (Scaling by a negative factor yields -0, so compare by absolute value.)
  for (const vector of [first, second]) {
    assert.equal(Math.abs(vector.x), 0)
    assert.equal(Math.abs(vector.z), 0)
  }
})
