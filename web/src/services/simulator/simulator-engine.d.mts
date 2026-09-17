export type SimulatorStatusCode = 'wasm-loading' | 'wasm-load-failed' | 'firmware-ready-timeout' | 'firmware-ready'

export type SimulatorStatus = {
  status: 'pending' | 'success' | 'error'
  code: SimulatorStatusCode
}

export type SimulatorModResult = {
  status: 'empty' | 'saved' | 'prepared' | 'installed' | 'unsupported' | 'restarting' | 'error'
  name?: string
  size?: number
  error?: string
}

export type InstalledMod = {
  name: string
  size: number
  storage?: 'memory' | 'indexedDB'
}

export type StoredMod = InstalledMod & {
  bytes: Uint8Array
  installedAt?: number
}

export type SimulatorModStorage = {
  saveInstalledMod(mod: { name: string; bytes: Uint8Array }): Promise<StoredMod>
  loadInstalledMod(): Promise<StoredMod | null>
  clearInstalledMod(): Promise<void>
}

export type CameraStatus = {
  status: 'idle' | 'pending' | 'connected' | 'fallback' | 'error'
  error?: string
}

export type SimulatorReady = {
  runCount: number
  installationStatus: SimulatorModResult['status']
}

export type DeviceProfileId = 'm5stackchan-cores3' | 'legacy-compat'

export type DeviceProfileInputs = {
  screenTouch: boolean
  virtualButtons: boolean
  headTouch: boolean
  imu: boolean
}

export type DeviceProfile = {
  id: DeviceProfileId
  label: string
  description: string
  inputs: DeviceProfileInputs
}

export type HeadSwipeDirection = 'forward' | 'backward'

export type ImuOrientation = 'upright' | 'upsideDown' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight'

export type PerformanceMode = 'desktop' | 'mobile'

export type CameraFacingMode = 'user' | 'environment'

export type ImuAcceleration = {
  x: number
  y: number
  z: number
}

export type ViewportPointerBinding = {
  viewport: {
    addEventListener(type: string, listener: (event: never) => void, options?: unknown): void
    removeEventListener(type: string, listener: (event: never) => void, options?: unknown): void
    setPointerCapture(pointerId: number): void
    releasePointerCapture(pointerId: number): void
  }
  scene: {
    screenPointFromViewportEvent(event: unknown): { x: number; y: number } | undefined
    headTouchPositionFromViewportEvent(event: unknown): number | undefined
    setViewportControlsSuppressed(suppressed: boolean): void
  }
  wasmView: { touchScreenPoint(kind: number, id: number, x: number, y: number, timeStamp: number): void }
  headTouch?: { setPosition(position: number): void; release(): void }
}

/**
 * Routes viewport pointers to the LCD first, then the head touch panel, then
 * OrbitControls. Exported so the routing precedence can be tested without a
 * WebGL context.
 */
export function bindManagedViewportTouches(binding: ViewportPointerBinding): () => void

/**
 * Derives whether the 3D camera may orbit from two independent inputs: a drag in progress
 * (`suppressed`) and the user's rotation lock (`locked`). Exported so the interaction between
 * them can be tested without a WebGL context.
 */
export class ViewportControlsGate {
  constructor(apply: (enabled: boolean) => void)
  locked: boolean
  suppressed: boolean
  readonly enabled: boolean
  setLocked(locked: boolean): void
  setSuppressed(suppressed: boolean): void
}

export class SimulatorEngine {
  constructor(options: {
    viewport: HTMLCanvasElement
    screen: HTMLCanvasElement
    runtimeBaseUrl?: string
    modStorage?: SimulatorModStorage
    deviceProfile?: DeviceProfileId
    /** Rations the 3D redraw only; the firmware keeps its tick rate in every mode. */
    performanceMode?: PerformanceMode
    onStatus?: (status: SimulatorStatus) => void
    onTrace?: (message: string) => void
    onModStatus?: (result: SimulatorModResult, installedMod?: InstalledMod | null) => void
    onCameraStatus?: (status: CameraStatus) => void
    onReady?: (ready: SimulatorReady) => void
    onError?: (error: unknown) => void
  })
  readonly deviceProfile: DeviceProfile
  start(): Promise<void>
  refreshModStatus(): Promise<InstalledMod | null>
  installMod(file: File): Promise<void>
  restart(): Promise<void>
  clearMod(): Promise<void>
  connectCamera(options?: { facingMode?: CameraFacingMode }): Promise<void>
  readonly cameraFacingMode: CameraFacingMode | undefined
  readonly performanceMode: PerformanceMode
  setPerformanceMode(mode: PerformanceMode): void
  /** Feeds a measured accelerometer vector, in g, straight to the simulated IMU. */
  setImuAccelerometer(vector: ImuAcceleration): void
  pushButton(name: 'a' | 'b' | 'c'): void
  headSwipe(direction: HeadSwipeDirection): void
  setHeadTouchPosition(position: number): void
  releaseHeadTouch(): void
  setImuOrientation(name: ImuOrientation): void
  shakeImu(): void
  /** Puts the 3D camera back on the pose the simulator opens with. */
  resetViewportCamera(): void
  readonly viewportControlsLocked: boolean
  /** Stops the 3D camera orbiting, so a stray stroke on the viewport cannot drag the view. */
  setViewportControlsLocked(locked: boolean): void
  dispose(): void
}
