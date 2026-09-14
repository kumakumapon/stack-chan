/**
 * Platform-independent servo self-test.
 *
 * One device flash has to answer more than one hypothesis. The sequence walks
 * the stack from power to actual movement and names the lowest layer that
 * failed, so a device session ends with a diagnosis instead of "it did not
 * move". The caller injects the motion capability and a wait function.
 */

/** Movement smaller than this is treated as "the head did not move". */
export const MOVEMENT_EPSILON_RAD = 0.01

/** Bounded yaw targets, alternating so a repeated absolute target cannot hide a failure. */
export const DEFAULT_TARGETS = [
  { yawRad: 0.12, pitchRad: 0 },
  { yawRad: -0.12, pitchRad: 0 },
  { yawRad: 0, pitchRad: 0 },
]

export const LAYERS = ['power', 'link', 'framing', 'motion', 'ok']

/**
 * Names the lowest layer that failed.
 *
 * - power: the servo rail is configured but not enabled or not reachable
 * - link: nothing was ever decoded from the bus
 * - framing: frames arrive but responses are lost or corrupt
 * - motion: commands are acknowledged, yet the head does not move
 */
export function classifyServoSelfTest({ power, readsAttempted, readsSucceeded, movedRad, bus }) {
  if (power?.configured === true && (power.available === false || power.enabled === false)) return 'power'
  if (readsAttempted > 0 && readsSucceeded === 0) return bus == null || bus.framesDecoded === 0 ? 'link' : 'framing'
  if (readsSucceeded < readsAttempted) return 'framing'
  if (readsAttempted === 0) return 'link'
  if (movedRad < MOVEMENT_EPSILON_RAD) return 'motion'
  return 'ok'
}

function snapshot(value) {
  return value === undefined || value === null ? null : JSON.parse(JSON.stringify(value))
}

async function step(steps, name, run) {
  try {
    const detail = await run()
    steps.push({ name, ok: true, detail: detail ?? null })
    return detail
  } catch (error) {
    steps.push({ name, ok: false, detail: String(error?.message ?? error) })
    return undefined
  }
}

/**
 * Runs the sequence and returns a report that is safe to trace as one JSON line.
 *
 * @param motion - the robot motion capability
 * @param wait - resolves after the given number of milliseconds
 * @param targets - bounded head targets to visit in order
 * @param settleMs - time allowed for the head to reach each target
 */
export async function runServoSelfTest({ motion, wait, targets = DEFAULT_TARGETS, settleMs = 700 }) {
  const steps = []
  const diagnostics = () => (typeof motion?.getDiagnostics === 'function' ? motion.getDiagnostics() : undefined)
  const power = snapshot(diagnostics()?.power)
  steps.push({
    name: 'power',
    ok: !(power?.configured === true && (power.available === false || power.enabled === false)),
    detail: power,
  })

  const measurements = []
  let readsAttempted = 0
  await step(steps, 'torque', async () => {
    await motion.setTorque(true)
    return 'enabled'
  })

  for (const target of targets) {
    await step(steps, `move ${target.yawRad}`, () =>
      motion.setPose({ position: { x: 0, y: 0, z: 0 }, rotation: { y: target.yawRad, p: target.pitchRad, r: 0 } }, 1),
    )
    await wait(settleMs)
    readsAttempted++
    await step(steps, `read ${target.yawRad}`, async () => {
      const result = await motion.getRotation()
      if (result?.success !== true) throw new Error(result?.reason ?? 'unavailable')
      measurements.push({ target: target.yawRad, yawRad: result.value.y, pitchRad: result.value.p })
      return measurements[measurements.length - 1]
    })
  }

  const yaws = measurements.map((measurement) => measurement.yawRad)
  const movedRad = yaws.length > 1 ? Math.max(...yaws) - Math.min(...yaws) : 0
  const servo = snapshot(diagnostics())
  return {
    version: 1,
    layer: classifyServoSelfTest({
      power,
      readsAttempted,
      readsSucceeded: measurements.length,
      movedRad,
      bus: servo?.bus,
    }),
    movedRad,
    measurements,
    steps,
    servo,
  }
}

/** One short line for the device screen. */
export function formatServoSelfTestSummary(report) {
  const labels = {
    ok: 'OK',
    power: 'NG power',
    link: 'NG link',
    framing: 'NG framing',
    motion: 'NG motion',
  }
  const moved = `${Math.round(report.movedRad * 1000) / 1000} rad`
  return `Servo ${labels[report.layer] ?? report.layer}: moved ${moved}, reads ${report.measurements.length}/${
    report.steps.filter((entry) => entry.name.indexOf('read ') === 0).length
  }`
}
