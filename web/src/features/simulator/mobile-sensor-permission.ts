// Detects and requests access to the DeviceMotion API across the three shapes it comes in:
// absent entirely (desktop browsers, most non-Safari mobile browsers before motion access was
// gated), implicitly granted (Android, desktop), and gated behind an explicit, gesture-scoped
// prompt (iOS 13+). Everything the browser API touches is injected via `win` so this stays
// testable in jsdom, which offers none of it.

export type SensorPermissionState = 'unsupported' | 'prompt' | 'granted' | 'denied'

// iOS's DeviceMotionEvent.requestPermission() is not part of lib.dom.d.ts (it is a Safari-only
// extension), so it has to be typed locally rather than assumed to exist on the DOM lib's type.
type DeviceMotionEventCtorWithPermission = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function resolveWindow(win?: Window & typeof globalThis): (Window & typeof globalThis) | undefined {
  if (win) return win
  return typeof window === 'undefined' ? undefined : window
}

function deviceMotionCtor(win?: Window & typeof globalThis): DeviceMotionEventCtorWithPermission | undefined {
  const target = resolveWindow(win)
  const ctor = target?.DeviceMotionEvent
  return typeof ctor === 'function' ? (ctor as unknown as DeviceMotionEventCtorWithPermission) : undefined
}

export function deviceMotionSupport(win?: Window & typeof globalThis): 'unsupported' | 'prompt' | 'granted' {
  const ctor = deviceMotionCtor(win)
  if (!ctor) return 'unsupported'
  return typeof ctor.requestPermission === 'function' ? 'prompt' : 'granted'
}

export async function requestDeviceMotionPermission(win?: Window & typeof globalThis): Promise<SensorPermissionState> {
  const support = deviceMotionSupport(win)
  if (support !== 'prompt') return support

  const ctor = deviceMotionCtor(win)
  try {
    // iOS rejects this promise (rather than resolving 'denied') when it wasn't invoked
    // synchronously within a user gesture. That rejection is a normal "no access" outcome for
    // this hook's purposes, not an exceptional one, so it must never propagate as a throw.
    const result = await ctor?.requestPermission?.()
    return result === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}
