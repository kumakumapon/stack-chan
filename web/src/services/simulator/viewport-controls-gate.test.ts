import { describe, expect, it, vi } from 'vitest'

import { ViewportControlsGate } from '@/services/simulator/simulator-engine.mjs'

describe('ViewportControlsGate', () => {
  it('lets the camera orbit while nothing holds it back', () => {
    const apply = vi.fn()
    const gate = new ViewportControlsGate(apply)

    expect(gate.enabled).toBe(true)
    expect(apply).toHaveBeenLastCalledWith(true)
  })

  it('keeps the view locked across a drag that releases', () => {
    // The regression this exists for: the pointer routing suppresses orbiting on pointerdown and
    // lifts that suppression on release. If release restored the flag directly instead of going
    // back through the gate, ending a stroke would silently unlock a view the user locked.
    const apply = vi.fn()
    const gate = new ViewportControlsGate(apply)

    gate.setLocked(true)
    gate.setSuppressed(true)
    gate.setSuppressed(false)

    expect(gate.enabled).toBe(false)
    expect(apply).toHaveBeenLastCalledWith(false)
  })

  it('resumes orbiting when the lock is lifted after a drag', () => {
    const apply = vi.fn()
    const gate = new ViewportControlsGate(apply)

    gate.setLocked(true)
    gate.setSuppressed(true)
    gate.setSuppressed(false)
    gate.setLocked(false)

    expect(gate.enabled).toBe(true)
    expect(apply).toHaveBeenLastCalledWith(true)
  })

  it('suppresses orbiting during a drag on an unlocked view, and restores it on release', () => {
    const apply = vi.fn()
    const gate = new ViewportControlsGate(apply)

    gate.setSuppressed(true)
    expect(gate.enabled).toBe(false)

    gate.setSuppressed(false)
    expect(gate.enabled).toBe(true)
  })
})
