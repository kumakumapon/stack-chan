/**
 * Named head motions, spelled out as data. Every step's `yaw`/`pitch` is an
 * absolute radian target within the reaction/performance head clamp
 * (±π/6 yaw, ±π/8 pitch), and every step is at least 150 ms apart from the
 * one before it, so a servo move never gets asked to finish before it can. A
 * performance cue names one of these; this file is the one place that turns
 * the name into steps.
 */

import type { MotionDefinition, MotionName, MotionStep } from 'performance-types'

function motion(name: MotionName, steps: readonly MotionStep[], durationMs: number): MotionDefinition {
  for (const step of steps) Object.freeze(step)
  return Object.freeze({ name, steps: Object.freeze(steps), durationMs })
}

export const MOTION_CATALOG: Readonly<Record<MotionName, MotionDefinition>> = Object.freeze({
  nod: motion(
    'nod',
    [
      { at: 0, yaw: 0, pitch: 0.2, durationMs: 220 },
      { at: 220, yaw: 0, pitch: -0.05, durationMs: 200 },
      { at: 420, yaw: 0, pitch: 0.15, durationMs: 200 },
      { at: 620, yaw: 0, pitch: 0, durationMs: 200 },
    ],
    820,
  ),
  shake: motion(
    'shake',
    [
      { at: 0, yaw: -0.3, pitch: 0, durationMs: 220 },
      { at: 220, yaw: 0.3, pitch: 0, durationMs: 220 },
      { at: 440, yaw: -0.25, pitch: 0, durationMs: 220 },
      { at: 660, yaw: 0, pitch: 0, durationMs: 220 },
    ],
    880,
  ),
  'sway-left': motion(
    'sway-left',
    [
      { at: 0, yaw: -0.2, pitch: 0, durationMs: 260 },
      { at: 260, yaw: 0, pitch: 0, durationMs: 260 },
    ],
    520,
  ),
  'sway-right': motion(
    'sway-right',
    [
      { at: 0, yaw: 0.2, pitch: 0, durationMs: 260 },
      { at: 260, yaw: 0, pitch: 0, durationMs: 260 },
    ],
    520,
  ),
  bounce: motion(
    'bounce',
    [
      { at: 0, yaw: 0, pitch: 0.15, durationMs: 200 },
      { at: 200, yaw: 0, pitch: -0.06, durationMs: 180 },
      { at: 380, yaw: 0, pitch: 0, durationMs: 180 },
    ],
    560,
  ),
  'look-up': motion('look-up', [{ at: 0, yaw: 0, pitch: -0.3, durationMs: 300 }], 300),
  'look-down': motion('look-down', [{ at: 0, yaw: 0, pitch: 0.3, durationMs: 300 }], 300),
  'head-left': motion('head-left', [{ at: 0, yaw: -0.45, pitch: 0, durationMs: 300 }], 300),
  'head-right': motion('head-right', [{ at: 0, yaw: 0.45, pitch: 0, durationMs: 300 }], 300),
  center: motion('center', [{ at: 0, yaw: 0, pitch: 0, durationMs: 200 }], 200),
  bow: motion(
    'bow',
    [
      { at: 0, yaw: 0, pitch: 0.3, durationMs: 500 },
      { at: 900, yaw: 0, pitch: 0, durationMs: 450 },
    ],
    1350,
  ),
  'double-nod': motion(
    'double-nod',
    [
      { at: 0, yaw: 0, pitch: 0.2, durationMs: 220 },
      { at: 220, yaw: 0, pitch: -0.05, durationMs: 220 },
      { at: 440, yaw: 0, pitch: 0.2, durationMs: 220 },
      { at: 660, yaw: 0, pitch: 0, durationMs: 220 },
    ],
    880,
  ),
  'peek-left': motion(
    'peek-left',
    [
      { at: 0, yaw: -0.32, pitch: -0.1, durationMs: 400 },
      { at: 800, yaw: 0, pitch: 0, durationMs: 400 },
    ],
    1200,
  ),
  'peek-right': motion(
    'peek-right',
    [
      { at: 0, yaw: 0.32, pitch: -0.1, durationMs: 400 },
      { at: 800, yaw: 0, pitch: 0, durationMs: 400 },
    ],
    1200,
  ),
  scan: motion(
    'scan',
    [
      { at: 0, yaw: -0.4, pitch: 0, durationMs: 500 },
      { at: 1000, yaw: 0.4, pitch: 0, durationMs: 700 },
      { at: 2200, yaw: 0, pitch: 0, durationMs: 500 },
    ],
    2700,
  ),
  stretch: motion(
    'stretch',
    [
      { at: 0, yaw: 0, pitch: -0.28, durationMs: 700 },
      { at: 1200, yaw: 0, pitch: 0.2, durationMs: 600 },
      { at: 2100, yaw: 0, pitch: 0, durationMs: 500 },
    ],
    2600,
  ),
})

export function motionDefinition(name: MotionName): MotionDefinition {
  return MOTION_CATALOG[name]
}
