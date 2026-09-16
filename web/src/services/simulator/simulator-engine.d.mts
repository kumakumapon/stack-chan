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

export class SimulatorEngine {
  constructor(options: {
    viewport: HTMLCanvasElement
    screen: HTMLCanvasElement
    runtimeBaseUrl?: string
    modStorage?: SimulatorModStorage
    deviceProfile?: DeviceProfileId
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
  connectCamera(): Promise<void>
  pushButton(name: 'a' | 'b' | 'c'): void
  headSwipe(direction: HeadSwipeDirection): void
  setHeadTouchPosition(position: number): void
  releaseHeadTouch(): void
  setImuOrientation(name: ImuOrientation): void
  shakeImu(): void
  dispose(): void
}
