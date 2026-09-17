import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { type OperationState } from '@/features/operations/operation-state'
import { useLogBuffer } from '@/hooks/use-log-buffer'
import { toAppError } from '@/lib/errors/app-error'
import {
  type CameraStatus,
  type DeviceProfile,
  type DeviceProfileId,
  type ImuOrientation,
  type InstalledMod,
  type SimulatorModStorage,
  type SimulatorModResult,
  type SimulatorReady,
  type SimulatorStatusCode,
  SimulatorEngine,
} from '@/services/simulator/simulator-engine.mjs'
import { DEFAULT_DEVICE_PROFILE_ID, resolveDeviceProfile } from '../../../simulator/device-profile.mjs'
import { createMemoryModStorage, createModStorage } from '../../../simulator/mod-storage.mjs'

export type { DeviceProfile, DeviceProfileId, ImuOrientation }

export type PerformanceMode = 'desktop' | 'mobile'

type ModState = {
  result: SimulatorModResult
  installedMod?: InstalledMod | null
}

type SimulatorEngineOptions = {
  initialMod?: {
    name: string
    bytes: Uint8Array
  }
  persistence?: 'persistent' | 'session'
  runtimeBaseUrl?: string
  deviceProfile?: DeviceProfileId
  // Only the value present at construction seeds the engine; changing it later never
  // recreates the engine (see `setPerformanceMode` below and the effect's dependency list).
  performanceMode?: PerformanceMode
  onTrace?: (message: string) => void
  onReady?: (ready: SimulatorReady) => void
  onError?: (error: unknown) => void
}

const SIMULATOR_STATUS_MESSAGES: Record<SimulatorStatusCode, string> = {
  'wasm-loading': 'WASMを読み込み中',
  'wasm-load-failed': 'WASMを読み込めませんでした',
  'firmware-ready-timeout': 'ファームウェアの起動準備がタイムアウトしました',
  'firmware-ready': '準備完了',
}

export function useSimulatorEngine({
  initialMod,
  persistence = 'persistent',
  runtimeBaseUrl = new URL('../simulator/', document.baseURI).href,
  deviceProfile: initialDeviceProfile,
  performanceMode: initialPerformanceMode,
  onTrace,
  onReady,
  onError,
}: SimulatorEngineOptions = {}) {
  const { t } = useI18n()
  const viewportRef = useRef<HTMLCanvasElement>(null)
  const screenRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<SimulatorEngine | null>(null)
  const callbacksRef = useRef({ onTrace, onReady, onError, t })
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const [modState, setModState] = useState<ModState>({ result: { status: 'empty' } })
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ status: 'idle' })
  const [cameraFacingMode, setCameraFacingMode] = useState<'user' | 'environment' | undefined>(undefined)
  const [deviceProfileId, setDeviceProfileId] = useState<DeviceProfileId>(
    initialDeviceProfile ?? (DEFAULT_DEVICE_PROFILE_ID as DeviceProfileId)
  )
  const [performanceMode, setPerformanceModeState] = useState<PerformanceMode>(initialPerformanceMode ?? 'desktop')
  const [viewportControlsLocked, setViewportControlsLockedState] = useState(false)
  const { entries, append, clear } = useLogBuffer(120)

  useLayoutEffect(() => {
    callbacksRef.current = { onTrace, onReady, onError, t }
  }, [onError, onReady, onTrace, t])

  useEffect(() => {
    const viewport = viewportRef.current
    const screen = screenRef.current
    if (!viewport || !screen) return
    let active = true
    const modStorage = (
      persistence === 'session' ? createMemoryModStorage() : createModStorage()
    ) as SimulatorModStorage
    const engine = new SimulatorEngine({
      viewport,
      screen,
      modStorage,
      runtimeBaseUrl,
      deviceProfile: deviceProfileId,
      // Read once at construction time only: `performanceMode` is intentionally left out of
      // this effect's dependency list below, so later calls to `setPerformanceMode` adjust the
      // running engine in place instead of tearing it down and restarting the firmware.
      performanceMode,
      onStatus: (status) => {
        if (!active) return
        const message = callbacksRef.current.t(SIMULATOR_STATUS_MESSAGES[status.code])
        if (status.status === 'pending') {
          setOperation({ status: 'pending', message })
        } else if (status.status === 'success') {
          setOperation({ status: 'success', result: undefined, message })
        } else {
          setOperation({ status: 'error', error: toAppError(message, 'simulator') })
        }
      },
      onTrace: (message) => {
        if (!active) return
        append(message, message.startsWith('[err]') ? 'error' : 'trace', 'simulator')
        callbacksRef.current.onTrace?.(message)
      },
      onModStatus: (result, installedMod) => {
        if (active) setModState({ result, installedMod })
      },
      onCameraStatus: (status) => {
        if (active) setCameraStatus(status)
      },
      onReady: (ready) => {
        if (active) callbacksRef.current.onReady?.(ready)
      },
      onError: (error) => {
        if (active) callbacksRef.current.onError?.(error)
      },
    })
    engineRef.current = engine
    // Switching device profile rebuilds the engine, and a fresh one always starts unlocked.
    // Replaying the lock keeps the toggle in the UI telling the truth about the new engine.
    // Read directly rather than through this effect's dependencies, for the same reason
    // `performanceMode` is: it must adjust the engine, never recreate it.
    engine.setViewportControlsLocked(viewportControlsLocked)
    void (async () => {
      if (initialMod) await modStorage.saveInstalledMod(initialMod)
      if (active) await engine.start()
    })().catch((error) => {
      if (!active) return
      setOperation({ status: 'error', error: toAppError(error, 'simulator.start') })
      callbacksRef.current.onError?.(error)
    })
    return () => {
      active = false
      if (engineRef.current === engine) engineRef.current = null
      engine.dispose()
    }
    // `performanceMode` deliberately excluded: it is a runtime setter (see above), not a
    // construction-time option like `deviceProfileId`, so it must never recreate the engine.
  }, [append, deviceProfileId, initialMod?.bytes, initialMod?.name, persistence, runtimeBaseUrl])

  const run = useCallback(async (action: (engine: SimulatorEngine) => Promise<void>) => {
    const engine = engineRef.current
    if (!engine) return
    try {
      await action(engine)
    } catch (error) {
      setOperation({ status: 'error', error: toAppError(error, 'simulator.action') })
    }
  }, [])

  return {
    viewportRef,
    screenRef,
    operation,
    modState,
    cameraStatus,
    cameraFacingMode,
    logs: entries,
    clearLogs: clear,
    deviceProfile: resolveDeviceProfile(deviceProfileId),
    setDeviceProfile: (id: DeviceProfileId) => setDeviceProfileId(id),
    performanceMode,
    setPerformanceMode: (mode: PerformanceMode) => {
      engineRef.current?.setPerformanceMode(mode)
      setPerformanceModeState(mode)
    },
    installMod: (file: File) => run((engine) => engine.installMod(file)),
    restart: () => run((engine) => engine.restart()),
    clearMod: () => run((engine) => engine.clearMod()),
    connectCamera: (options?: { facingMode?: 'user' | 'environment' }) =>
      run(async (engine) => {
        await engine.connectCamera(options)
        setCameraFacingMode(engine.cameraFacingMode)
      }),
    pushButton: (name: 'a' | 'b' | 'c') => engineRef.current?.pushButton(name),
    headSwipe: (direction: 'forward' | 'backward') => engineRef.current?.headSwipe(direction),
    setHeadTouchPosition: (position: number) => engineRef.current?.setHeadTouchPosition(position),
    releaseHeadTouch: () => engineRef.current?.releaseHeadTouch(),
    setImuOrientation: (orientation: ImuOrientation) => engineRef.current?.setImuOrientation(orientation),
    shakeImu: () => engineRef.current?.shakeImu(),
    setImuAccelerometer: (vector: { x: number; y: number; z: number }) =>
      engineRef.current?.setImuAccelerometer(vector),
    resetViewportCamera: () => engineRef.current?.resetViewportCamera(),
    viewportControlsLocked,
    setViewportControlsLocked: (locked: boolean) => {
      engineRef.current?.setViewportControlsLocked(locked)
      setViewportControlsLockedState(locked)
    },
  }
}
