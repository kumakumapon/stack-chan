import { useCallback, useEffect, useRef, useState } from 'react'

import { accelerationFromDeviceMotion, type DeviceAcceleration, type DeviceMotionSample } from './device-motion-transform'
import { deviceMotionSupport, requestDeviceMotionPermission, type SensorPermissionState } from './mobile-sensor-permission'

export type MobileDeviceSensorsOptions = {
  onAcceleration(vector: DeviceAcceleration): void
  enabled?: boolean
  win?: Window & typeof globalThis
}

// The firmware polls its IMU every 100ms (see firmware/host/modules/input/imu-motion.ts), while
// phones fire 'devicemotion' at 60Hz or faster. Feeding the bridge faster than the firmware ever
// reads it wastes work and, worse, lets a single extreme sample slip in and out between polls
// without MotionRecognizer's consecutive-sample logic ever seeing it. This mirrors that cadence.
const SAMPLE_INTERVAL_MS = 100

function resolveWindow(win?: Window & typeof globalThis): (Window & typeof globalThis) | undefined {
  if (win) return win
  return typeof window === 'undefined' ? undefined : window
}

export function useMobileDeviceSensors({ onAcceleration, enabled = true, win }: MobileDeviceSensorsOptions) {
  const targetWindow = resolveWindow(win)
  const [state, setState] = useState<SensorPermissionState>(() => deviceMotionSupport(targetWindow))
  const [active, setActive] = useState(false)
  const onAccelerationRef = useRef(onAcceleration)
  const lastSampleAtRef = useRef(0)
  const listenerRef = useRef<((event: Event) => void) | null>(null)

  useEffect(() => {
    onAccelerationRef.current = onAcceleration
  }, [onAcceleration])

  const removeListener = useCallback(() => {
    if (listenerRef.current && targetWindow) {
      targetWindow.removeEventListener('devicemotion', listenerRef.current)
    }
    listenerRef.current = null
    setActive(false)
  }, [targetWindow])

  const enable = useCallback(async () => {
    // requestDeviceMotionPermission must run synchronously up to its own first await from
    // here, with nothing awaited beforehand, so that a click handler calling enable() directly
    // still satisfies iOS's "requestPermission() must be called from within a user gesture" rule.
    const result = await requestDeviceMotionPermission(targetWindow)
    setState(result)
    if (result !== 'granted' || !targetWindow) return

    removeListener()

    const handler = (event: Event) => {
      const now = Date.now()
      if (now - lastSampleAtRef.current < SAMPLE_INTERVAL_MS) return
      lastSampleAtRef.current = now

      const angle = targetWindow.screen?.orientation?.angle ?? 0
      // DOM's DeviceMotionEventAcceleration types x/y/z as `number | null`; our DeviceMotionSample
      // type (shared with callers that build synthetic samples in tests) declares plain numbers.
      // accelerationFromDeviceMotion checks for null components defensively at runtime regardless
      // of what TypeScript believes here, so this cast is safe.
      const sample = event as unknown as DeviceMotionSample
      const vector = accelerationFromDeviceMotion(sample, angle)
      if (vector) onAccelerationRef.current(vector)
    }

    listenerRef.current = handler
    targetWindow.addEventListener('devicemotion', handler)
    setActive(true)
  }, [removeListener, targetWindow])

  const disable = useCallback(() => {
    removeListener()
  }, [removeListener])

  useEffect(() => {
    if (!enabled) removeListener()
    return () => removeListener()
  }, [enabled, removeListener])

  return {
    state,
    supported: state !== 'unsupported',
    active,
    enable,
    disable,
  }
}
