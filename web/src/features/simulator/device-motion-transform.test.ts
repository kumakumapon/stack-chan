import { describe, expect, it } from 'vitest'

import {
  accelerationFromDeviceMotion,
  GRAVITY_METRES_PER_SECOND_SQUARED,
  type DeviceAcceleration,
} from './device-motion-transform'

// Re-derivation of firmware/host/modules/input/imu-motion.ts's detectPosture, kept independent
// of the firmware source (per the task) so these tests exercise the *contract*, not a shared
// implementation the two sides could both get wrong the same way.
type Posture = 'unknown' | 'upright' | 'fallenForward' | 'fallenBackward' | 'fallenLeft' | 'fallenRight' | 'upsideDown'

function firmwarePosture(vector: DeviceAcceleration, threshold = 0.75): Posture {
  const magnitude = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
  if (magnitude === 0) return 'unknown'

  const x = vector.x / magnitude
  const y = vector.y / magnitude
  const z = vector.z / magnitude

  if (y >= threshold) return 'upright'
  if (y <= -threshold) return 'upsideDown'
  if (Math.abs(x) >= Math.abs(z) && Math.abs(x) >= threshold) return x >= 0 ? 'fallenLeft' : 'fallenRight'
  if (Math.abs(z) >= threshold) return z < 0 ? 'fallenForward' : 'fallenBackward'
  return 'unknown'
}

const G = GRAVITY_METRES_PER_SECOND_SQUARED

describe('accelerationFromDeviceMotion', () => {
  describe('posture mapping', () => {
    it('reads upright when held in portrait, screen toward the user', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: G, z: 0 } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('upright')
    })

    it('reads fallenBackward when lying flat on a table, screen up', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: 0, z: G } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('fallenBackward')
    })

    it('reads fallenForward when face down', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: 0, z: -G } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('fallenForward')
    })

    it('reads upsideDown when upside down in portrait', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: -G, z: 0 } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('upsideDown')
    })

    it('reads fallenLeft when rolled onto its left edge (+x)', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: G, y: 0, z: 0 } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('fallenLeft')
    })

    it('reads fallenRight when rolled onto its right edge (-x)', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: -G, y: 0, z: 0 } })
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('fallenRight')
    })
  })

  describe('screen angle rotation', () => {
    it('reads upright when held in landscape at screen angle 90', () => {
      // Physically rotating the device 90 degrees counter-clockwise from portrait (the turn
      // that produces screen.orientation.angle === 90) puts the local +x axis where +y used to
      // be, so this is the raw sensor reading of the same "upright" hold, just landscape.
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: G, y: 0, z: 0 } }, 90)
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('upright')
    })

    it('reads upright when held in landscape at screen angle 270', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: -G, y: 0, z: 0 } }, 270)
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('upright')
    })

    it('leaves the reading untouched at screen angle 0 (the default)', () => {
      const withDefault = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: G, z: 0 } })
      const withExplicitZero = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: G, z: 0 } }, 0)
      expect(withDefault).toEqual(withExplicitZero)
    })

    it('inverts the portrait reading at screen angle 180', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: G, z: 0 } }, 180)
      expect(result).toBeDefined()
      expect(firmwarePosture(result!)).toBe('upsideDown')
    })
  })

  describe('unit conversion', () => {
    it('converts metres per second squared into g', () => {
      const result = accelerationFromDeviceMotion({ accelerationIncludingGravity: { x: 0, y: G, z: 0 } })
      expect(result).toBeDefined()
      expect(result!.y).toBeCloseTo(1, 10)
      expect(result!.x).toBeCloseTo(0, 10)
      expect(result!.z).toBeCloseTo(0, 10)
    })
  })

  describe('rejected samples', () => {
    it('returns undefined for a missing sample', () => {
      expect(accelerationFromDeviceMotion(undefined as never)).toBeUndefined()
    })

    it('returns undefined when accelerationIncludingGravity is absent', () => {
      expect(accelerationFromDeviceMotion({})).toBeUndefined()
    })

    it('returns undefined when accelerationIncludingGravity is null', () => {
      expect(accelerationFromDeviceMotion({ accelerationIncludingGravity: null })).toBeUndefined()
    })

    it('returns undefined when all components are null', () => {
      const sample = { accelerationIncludingGravity: { x: null, y: null, z: null } } as unknown as {
        accelerationIncludingGravity: DeviceAcceleration
      }
      expect(accelerationFromDeviceMotion(sample)).toBeUndefined()
    })

    it('returns undefined when a component is NaN', () => {
      const sample = { accelerationIncludingGravity: { x: Number.NaN, y: 0, z: 0 } }
      expect(accelerationFromDeviceMotion(sample)).toBeUndefined()
    })

    it('returns undefined when a component is Infinity', () => {
      const sample = { accelerationIncludingGravity: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } }
      expect(accelerationFromDeviceMotion(sample)).toBeUndefined()
    })

    it('treats an individually-null axis as 0 rather than rejecting the whole sample', () => {
      const sample = { accelerationIncludingGravity: { x: null, y: G, z: 0 } } as unknown as {
        accelerationIncludingGravity: DeviceAcceleration
      }
      const result = accelerationFromDeviceMotion(sample)
      expect(result).toBeDefined()
      expect(result!.x).toBe(0)
      expect(firmwarePosture(result!)).toBe('upright')
    })
  })
})
