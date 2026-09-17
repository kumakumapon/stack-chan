// Converts a browser DeviceMotionEvent-shaped sample into the accelerometer vector the
// simulated CoreS3 IMU expects (see web/simulator/bridge.mjs -> createHostImuBridge /
// IMU_ORIENTATIONS, and firmware/host/modules/input/imu-motion.ts -> MotionRecognizer).
//
// The device's raw sensor frame and the robot's IMU frame turn out to coincide axis-for-axis:
// holding the phone the same way you would hold (or lay down) the CoreS3 produces the matching
// posture, with no extra negation needed on X, Y or Z. That is not an accident of this function
// -- it falls out of how IMU_ORIENTATIONS.fallenBackward/fallenForward were chosen (a phone flat
// on a table, screen up, is the same "lying on its back, face to the ceiling" pose as the robot's
// fallenBackward, and both read +1g on the axis that points out of the face in that pose) -- but
// it is exactly the kind of fact that is easy to get backwards by re-deriving it from scratch.
// This function is the single place that encodes it. Nothing else in the app should re-derive or
// hand-roll the device-to-robot conversion; call this instead.
//
// The one real degree of freedom is the accelerometer's own units (m/s^2, gravity-inclusive) vs
// the robot's (g), handled by GRAVITY_METRES_PER_SECOND_SQUARED below, and the screen rotation,
// handled by rotateForScreenAngle.

export const GRAVITY_METRES_PER_SECOND_SQUARED = 9.80665

export type DeviceAcceleration = {
  x: number
  y: number
  z: number
}

export type DeviceMotionSample = {
  accelerationIncludingGravity?: DeviceAcceleration | null
}

// screen.orientation.angle is how many degrees the OS has rotated the presented content
// clockwise from the device's natural (portrait) orientation. The physical accelerometer axes
// never move with that software rotation, so to keep "upright" meaning "upright as the user is
// currently holding it" we rotate the raw x/y pair by the inverse of that same physical turn.
// Concretely: angle 90 is reached by physically turning the device 90 degrees counter-clockwise
// (its right edge ends up pointing at the sky), so the axis that used to read "up" when held in
// portrait (local +y) is now the local +x axis; rotateForScreenAngle maps that back onto y.
function rotateForScreenAngle(x: number, y: number, screenAngle: number): { x: number; y: number } {
  const normalized = ((screenAngle % 360) + 360) % 360
  switch (normalized) {
    case 90:
      return { x: -y, y: x }
    case 180:
      return { x: -x, y: -y }
    case 270:
      return { x: y, y: -x }
    default:
      return { x, y }
  }
}

export function accelerationFromDeviceMotion(sample: DeviceMotionSample, screenAngle = 0): DeviceAcceleration | undefined {
  const raw = sample?.accelerationIncludingGravity
  if (!raw) return undefined

  // Real DeviceMotionEvent instances can report individual axes as null when the platform
  // doesn't support them, even though our own DeviceAcceleration type (built for callers that
  // construct samples themselves) declares plain numbers. Treat a fully-null reading as "no
  // usable data"; treat an individually-null axis as 0 (the axis is simply unsupported, not
  // actively signalling a value), same as most DeviceMotion polyfills do.
  if (raw.x == null && raw.y == null && raw.z == null) return undefined

  const rawX = raw.x ?? 0
  const rawY = raw.y ?? 0
  const rawZ = raw.z ?? 0
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !Number.isFinite(rawZ)) return undefined

  const rotated = rotateForScreenAngle(rawX, rawY, screenAngle)

  return {
    x: rotated.x / GRAVITY_METRES_PER_SECOND_SQUARED,
    y: rotated.y / GRAVITY_METRES_PER_SECOND_SQUARED,
    z: rawZ / GRAVITY_METRES_PER_SECOND_SQUARED,
  }
}
