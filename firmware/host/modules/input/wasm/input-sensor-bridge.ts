// Pure logic shared by the WASM TouchPanel and IMU native bridges. This module
// owns no native() calls and no browser globals, so it is Node-testable; the
// thin .js/.c pairs next to it (touch-panel-bridge.*, imu-bridge.*) only wire
// native() readers into the factories below.

export type WasmSensorEnvironment = { device?: { sensor?: Record<string, unknown> } }

// Installs a sensor under globalThis.device.sensor.<name>, the seam compose.ts
// reads (host/app/compose.ts:193-205). Never replaces an existing device
// object or clobbers a sibling sensor already installed under another name -
// several bridges share this environment and install independently in
// main.ts, each guarded by its own Modules.has() check.
export function installWasmSensor(name: string, sensor: unknown, env: WasmSensorEnvironment): void {
  if (!env.device) env.device = {}
  if (!env.device.sensor) env.device.sensor = {}
  const registry = env.device.sensor
  if (name in registry) return
  registry[name] = sensor
}

export type WasmTouchPanelReader = {
  available(): number
  read(channel: number): number
}

type WasmTouchPanelDriver = {
  sample(): number[]
  configure(): void
  close(): void
}

type WasmTouchPanelConstructor = new (options?: unknown) => WasmTouchPanelDriver

function sanitizeIntensity(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0
}

// Returns a TouchPanel driver constructor (see touch-panel.ts) backed by
// `reader`, or undefined when the browser profile does not provide a
// TouchPanel bridge. `reader` crosses the XS/WebAssembly boundary through
// native() in touch-panel-bridge.js.
export function createWasmTouchPanelSensor(
  reader: WasmTouchPanelReader,
  channels = 3,
): WasmTouchPanelConstructor | undefined {
  if (!reader.available()) return undefined

  return class WasmTouchPanelSensor implements WasmTouchPanelDriver {
    constructor(_options?: unknown) {
      void _options
    }

    sample(): number[] {
      // Ascending order matches GestureRecognizer's [left, center, right]
      // channel layout (touch-panel-gesture.ts getPosition/#isTouched).
      const sample: number[] = []
      for (let channel = 0; channel < channels; channel++) {
        sample.push(sanitizeIntensity(reader.read(channel)))
      }
      return sample
    }

    configure(): void {}

    close(): void {}
  }
}

export type WasmImuReader = {
  available(): number
  read(axis: number): number
}

// Axis order read by createWasmImuSensor's sample(). This is a two-sided
// contract with the browser-side scripted-motion bridge (web/): axis 0 marks
// the START of a sample, and the bridge advances any in-progress scripted
// waveform (e.g. a shake gesture) only when it observes a read of axis 0. A
// driver MUST read axes 0..5 in ascending order within one sample() call, or
// the browser's waveform desyncs from what XS actually samples.
export const WASM_IMU_AXES = [
  'accelerometer.x',
  'accelerometer.y',
  'accelerometer.z',
  'gyroscope.x',
  'gyroscope.y',
  'gyroscope.z',
] as const

type WasmImuVector3 = { x: number; y: number; z: number }

type WasmImuSample = {
  accelerometer: WasmImuVector3
  gyroscope: WasmImuVector3
}

type WasmImuDriver = {
  sample(): WasmImuSample
  configure(): void
  close(): void
}

type WasmImuConstructor = new (options?: unknown) => WasmImuDriver

function sanitizeAxis(value: number): number {
  return Number.isFinite(value) ? value : 0
}

// Returns an IMU driver constructor (see imu.ts) backed by `reader`, or
// undefined when the browser profile does not provide an IMU bridge.
export function createWasmImuSensor(reader: WasmImuReader): WasmImuConstructor | undefined {
  if (!reader.available()) return undefined

  return class WasmImuSensor implements WasmImuDriver {
    constructor(_options?: unknown) {
      void _options
    }

    sample(): WasmImuSample {
      // Ascending 0..5 within a single call: see the WASM_IMU_AXES contract above.
      const x = sanitizeAxis(reader.read(0))
      const y = sanitizeAxis(reader.read(1))
      const z = sanitizeAxis(reader.read(2))
      const gx = sanitizeAxis(reader.read(3))
      const gy = sanitizeAxis(reader.read(4))
      const gz = sanitizeAxis(reader.read(5))
      return {
        accelerometer: { x, y, z },
        gyroscope: { x: gx, y: gy, z: gz },
      }
    }

    configure(): void {}

    close(): void {}
  }
}
