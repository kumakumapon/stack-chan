import { describe, expect, it, vi } from 'vitest'

import { bindManagedViewportTouches } from '@/services/simulator/simulator-engine.mjs'

type Listener = (event: PointerEventLike) => void

type PointerEventLike = {
  pointerId: number
  clientX: number
  clientY: number
  timeStamp: number
  preventDefault(): void
  stopImmediatePropagation(): void
}

function harness({ screenHit, headHit, withHeadTouch = true }: {
  screenHit?: { x: number; y: number }
  headHit?: number
  withHeadTouch?: boolean
}) {
  const listeners = new Map<string, Listener>()
  const viewport = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  }
  const scene = {
    screenPointFromViewportEvent: vi.fn(() => screenHit),
    headTouchPositionFromViewportEvent: vi.fn(() => headHit),
    setViewportControlsSuppressed: vi.fn(),
  }
  const wasmView = { touchScreenPoint: vi.fn() }
  const headTouch = { setPosition: vi.fn(), release: vi.fn() }

  const unbind = bindManagedViewportTouches({
    viewport,
    scene,
    wasmView,
    ...(withHeadTouch ? { headTouch } : {}),
  } as never)

  let timeStamp = 0
  const fire = (type: string, pointerId = 1) => {
    timeStamp += 16
    const event: PointerEventLike = {
      pointerId,
      clientX: 10,
      clientY: 10,
      timeStamp,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    }
    listeners.get(type)?.(event)
    return event
  }

  return { fire, viewport, scene, wasmView, headTouch, unbind, listeners }
}

describe('viewport pointer routing', () => {
  it('gives the LCD first refusal, exactly as before', () => {
    const { fire, wasmView, headTouch, scene } = harness({ screenHit: { x: 5, y: 6 }, headHit: 40 })

    fire('pointerdown')
    fire('pointermove')
    fire('pointerup')

    expect(wasmView.touchScreenPoint).toHaveBeenCalledTimes(3)
    expect(headTouch.setPosition).not.toHaveBeenCalled()
    expect(scene.headTouchPositionFromViewportEvent).not.toHaveBeenCalled()
  })

  it('offers a pointer that misses the screen to the head', () => {
    const { fire, wasmView, headTouch, viewport } = harness({ screenHit: undefined, headHit: 40 })

    fire('pointerdown')
    fire('pointermove')
    fire('pointerup')

    expect(headTouch.setPosition).toHaveBeenNthCalledWith(1, 40)
    expect(headTouch.setPosition).toHaveBeenNthCalledWith(2, 40)
    expect(headTouch.release).toHaveBeenCalledTimes(1)
    expect(wasmView.touchScreenPoint).not.toHaveBeenCalled()
    expect(viewport.setPointerCapture).toHaveBeenCalledTimes(1)
  })

  it('leaves the gesture to the camera when neither the screen nor the head is hit', () => {
    const { fire, wasmView, headTouch, scene, viewport } = harness({ screenHit: undefined, headHit: undefined })

    const event = fire('pointerdown')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(viewport.setPointerCapture).not.toHaveBeenCalled()
    expect(scene.setViewportControlsSuppressed).not.toHaveBeenCalled()
    expect(wasmView.touchScreenPoint).not.toHaveBeenCalled()
    expect(headTouch.setPosition).not.toHaveBeenCalled()
  })

  it('leaves the head to the camera on a board without a head touch panel', () => {
    const { fire, scene, viewport } = harness({ screenHit: undefined, headHit: 40, withHeadTouch: false })

    const event = fire('pointerdown')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(viewport.setPointerCapture).not.toHaveBeenCalled()
    // A profile without the sensor must not even ask the scene for a head hit.
    expect(scene.headTouchPositionFromViewportEvent).not.toHaveBeenCalled()
  })

  it('keeps the last position when a stroke slides off the silhouette', () => {
    const listenersHarness = harness({ screenHit: undefined, headHit: 40 })
    listenersHarness.fire('pointerdown')
    listenersHarness.scene.headTouchPositionFromViewportEvent.mockReturnValue(undefined as never)

    listenersHarness.fire('pointermove')

    // One call from pointerdown only: the stroke is still being measured, so
    // clipping the outline must not end it.
    expect(listenersHarness.headTouch.setPosition).toHaveBeenCalledTimes(1)
    expect(listenersHarness.headTouch.release).not.toHaveBeenCalled()
  })

  it('releases the head touch when the pointer is cancelled', () => {
    const { fire, headTouch, scene } = harness({ screenHit: undefined, headHit: 40 })

    fire('pointerdown')
    fire('pointercancel')

    expect(headTouch.release).toHaveBeenCalledTimes(1)
    expect(scene.setViewportControlsSuppressed).toHaveBeenLastCalledWith(false)
  })

  it('ignores a second pointer while a stroke is active', () => {
    const { fire, headTouch } = harness({ screenHit: undefined, headHit: 40 })

    fire('pointerdown', 1)
    fire('pointerdown', 2)

    expect(headTouch.setPosition).toHaveBeenCalledTimes(1)
  })

  it('unbinds every listener it added', () => {
    const { unbind, listeners } = harness({ screenHit: undefined, headHit: 40 })

    expect(listeners.size).toBeGreaterThan(0)
    unbind()
    expect(listeners.size).toBe(0)
  })
})
