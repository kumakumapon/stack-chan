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

const NOD: MotionDefinition = motion(
  'nod',
  [
    { at: 0, yaw: 0, pitch: 0.2, durationMs: 220 },
    { at: 220, yaw: 0, pitch: -0.05, durationMs: 200 },
    { at: 420, yaw: 0, pitch: 0.15, durationMs: 200 },
    { at: 620, yaw: 0, pitch: 0, durationMs: 200 },
  ],
  820,
)

const SHAKE: MotionDefinition = motion(
  'shake',
  [
    { at: 0, yaw: -0.3, pitch: 0, durationMs: 220 },
    { at: 220, yaw: 0.3, pitch: 0, durationMs: 220 },
    { at: 440, yaw: -0.25, pitch: 0, durationMs: 220 },
    { at: 660, yaw: 0, pitch: 0, durationMs: 220 },
  ],
  880,
)

const SWAY_LEFT: MotionDefinition = motion(
  'sway-left',
  [
    { at: 0, yaw: -0.2, pitch: 0, durationMs: 260 },
    { at: 260, yaw: 0, pitch: 0, durationMs: 260 },
  ],
  520,
)

const SWAY_RIGHT: MotionDefinition = motion(
  'sway-right',
  [
    { at: 0, yaw: 0.2, pitch: 0, durationMs: 260 },
    { at: 260, yaw: 0, pitch: 0, durationMs: 260 },
  ],
  520,
)

const BOUNCE: MotionDefinition = motion(
  'bounce',
  [
    { at: 0, yaw: 0, pitch: 0.15, durationMs: 200 },
    { at: 200, yaw: 0, pitch: -0.06, durationMs: 180 },
    { at: 380, yaw: 0, pitch: 0, durationMs: 180 },
  ],
  560,
)

const LOOK_UP: MotionDefinition = motion('look-up', [{ at: 0, yaw: 0, pitch: -0.3, durationMs: 300 }], 300)

const LOOK_DOWN: MotionDefinition = motion('look-down', [{ at: 0, yaw: 0, pitch: 0.3, durationMs: 300 }], 300)

const HEAD_LEFT: MotionDefinition = motion('head-left', [{ at: 0, yaw: -0.45, pitch: 0, durationMs: 300 }], 300)

const HEAD_RIGHT: MotionDefinition = motion('head-right', [{ at: 0, yaw: 0.45, pitch: 0, durationMs: 300 }], 300)

const CENTER: MotionDefinition = motion('center', [{ at: 0, yaw: 0, pitch: 0, durationMs: 200 }], 200)

export const MOTION_CATALOG: Readonly<Record<MotionName, MotionDefinition>> = Object.freeze({
  nod: NOD,
  shake: SHAKE,
  'sway-left': SWAY_LEFT,
  'sway-right': SWAY_RIGHT,
  bounce: BOUNCE,
  'look-up': LOOK_UP,
  'look-down': LOOK_DOWN,
  'head-left': HEAD_LEFT,
  'head-right': HEAD_RIGHT,
  center: CENTER,
})

export function motionDefinition(name: MotionName): MotionDefinition {
  return MOTION_CATALOG[name]
}
