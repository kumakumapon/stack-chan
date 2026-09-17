import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GRAVITY_METRES_PER_SECOND_SQUARED } from './device-motion-transform'
import { useMobileDeviceSensors } from './use-mobile-device-sensors'

const G = GRAVITY_METRES_PER_SECOND_SQUARED

class GrantedDeviceMotionEvent {}

class PromptDeviceMotionEvent {
  static requestPermission() {
    return Promise.resolve('granted' as const)
  }
}

class DeniedDeviceMotionEvent {
  static requestPermission() {
    return Promise.resolve('denied' as const)
  }
}

function fakeWindow(DeviceMotionEventCtor: unknown, angle = 0): Window & typeof globalThis {
  // A real EventTarget gives us working addEventListener/removeEventListener/dispatchEvent
  // without reimplementing DOM event dispatch semantics.
  const target = new EventTarget()
  return Object.assign(target, {
    DeviceMotionEvent: DeviceMotionEventCtor,
    screen: { orientation: { angle } },
  }) as unknown as Window & typeof globalThis
}

function dispatchMotion(win: Window & typeof globalThis, acceleration: { x: number; y: number; z: number }) {
  const event = new Event('devicemotion') as Event & { accelerationIncludingGravity?: unknown }
  event.accelerationIncludingGravity = acceleration
  win.dispatchEvent(event)
}

describe('useMobileDeviceSensors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enable subscribes and forwards converted vectors', async () => {
    const win = fakeWindow(GrantedDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result } = renderHook(() => useMobileDeviceSensors({ onAcceleration, win }))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.state).toBe('granted')
    expect(result.current.active).toBe(true)

    dispatchMotion(win, { x: 0, y: G, z: 0 })

    expect(onAcceleration).toHaveBeenCalledTimes(1)
    const vector = onAcceleration.mock.calls[0][0]
    expect(vector.y).toBeCloseTo(1, 10)
  })

  it('requests permission via the iOS prompt and subscribes once granted', async () => {
    const win = fakeWindow(PromptDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result } = renderHook(() => useMobileDeviceSensors({ onAcceleration, win }))

    expect(result.current.state).toBe('prompt')

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.state).toBe('granted')
    dispatchMotion(win, { x: 0, y: G, z: 0 })
    expect(onAcceleration).toHaveBeenCalledTimes(1)
  })

  it('throttles a burst of samples down to roughly one per 100ms poll interval', async () => {
    const win = fakeWindow(GrantedDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result } = renderHook(() => useMobileDeviceSensors({ onAcceleration, win }))

    await act(async () => {
      await result.current.enable()
    })

    // A burst of 5 samples arriving back-to-back (well under 100ms apart, as a real 60Hz+
    // sensor would fire) should be collapsed to a single forwarded sample.
    for (let i = 0; i < 5; i += 1) {
      dispatchMotion(win, { x: 0, y: G, z: 0 })
    }
    expect(onAcceleration).toHaveBeenCalledTimes(1)

    // Advancing past the poll interval lets the next sample through.
    act(() => {
      vi.advanceTimersByTime(101)
    })
    dispatchMotion(win, { x: 0, y: G, z: 0 })
    expect(onAcceleration).toHaveBeenCalledTimes(2)
  })

  it('reports denied and never subscribes when the permission prompt is declined', async () => {
    const win = fakeWindow(DeniedDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result } = renderHook(() => useMobileDeviceSensors({ onAcceleration, win }))

    await act(async () => {
      await result.current.enable()
    })

    expect(result.current.state).toBe('denied')
    expect(result.current.active).toBe(false)

    dispatchMotion(win, { x: 0, y: G, z: 0 })
    expect(onAcceleration).not.toHaveBeenCalled()
  })

  it('removes the listener on unmount', async () => {
    const win = fakeWindow(GrantedDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result, unmount } = renderHook(() => useMobileDeviceSensors({ onAcceleration, win }))

    await act(async () => {
      await result.current.enable()
    })

    unmount()

    dispatchMotion(win, { x: 0, y: G, z: 0 })
    expect(onAcceleration).not.toHaveBeenCalled()
  })

  it('removes the listener when enabled goes false', async () => {
    const win = fakeWindow(GrantedDeviceMotionEvent)
    const onAcceleration = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled }) => useMobileDeviceSensors({ onAcceleration, win, enabled }),
      { initialProps: { enabled: true } }
    )

    await act(async () => {
      await result.current.enable()
    })

    act(() => {
      rerender({ enabled: false })
    })
    expect(result.current.active).toBe(false)

    dispatchMotion(win, { x: 0, y: G, z: 0 })
    expect(onAcceleration).not.toHaveBeenCalled()
  })
})
