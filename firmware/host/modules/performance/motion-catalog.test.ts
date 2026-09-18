import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'performance-types', resolve(modulesRoot, 'performance/performance-types.js'))

const { MOTION_NAMES } = await import('./performance-types.js')
const { MOTION_CATALOG, motionDefinition } = await import('./motion-catalog.js')

const YAW_LIMIT = Math.PI / 6
const PITCH_LIMIT = Math.PI / 8
const MIN_STEP_SPACING_MS = 150
const MIN_STEP_DURATION_MS = 150
const MAX_STEP_DURATION_MS = 3000

test('every MOTION_NAMES entry has a catalog definition whose name matches', () => {
  for (const name of MOTION_NAMES) {
    const entry = MOTION_CATALOG[name]
    assert.ok(entry, `missing catalog entry for ${name}`)
    assert.equal(entry.name, name)
    assert.equal(motionDefinition(name), entry)
  }
})

test('every motion has at least one step, sorted and spaced at least 150 ms apart', () => {
  for (const name of MOTION_NAMES) {
    const { steps } = MOTION_CATALOG[name]
    assert.ok(steps.length > 0, `${name} should have at least one step`)
    let previousAt: number | undefined
    for (const step of steps) {
      assert.ok(step.at >= 0, `${name} step time must be non-negative`)
      if (previousAt !== undefined) assert.ok(step.at - previousAt >= MIN_STEP_SPACING_MS, `${name} steps too close`)
      previousAt = step.at
    }
  }
})

test('every step stays within the head clamp and per-step duration range', () => {
  for (const name of MOTION_NAMES) {
    for (const step of MOTION_CATALOG[name].steps) {
      assert.ok(Math.abs(step.yaw) <= YAW_LIMIT, `${name} yaw ${step.yaw} exceeds ±π/6`)
      assert.ok(Math.abs(step.pitch) <= PITCH_LIMIT, `${name} pitch ${step.pitch} exceeds ±π/8`)
      assert.ok(step.durationMs >= MIN_STEP_DURATION_MS, `${name} step duration below 150 ms`)
      assert.ok(step.durationMs <= MAX_STEP_DURATION_MS, `${name} step duration above 3000 ms`)
    }
  }
})

test('durationMs covers the last step', () => {
  for (const name of MOTION_NAMES) {
    const { steps, durationMs } = MOTION_CATALOG[name]
    const last = steps[steps.length - 1]
    assert.ok(durationMs >= last.at + last.durationMs, `${name} durationMs is shorter than its last step`)
  }
})

test('center is a single step to yaw 0 pitch 0', () => {
  const { steps } = MOTION_CATALOG.center
  assert.equal(steps.length, 1)
  assert.equal(steps[0].yaw, 0)
  assert.equal(steps[0].pitch, 0)
})

test('non-holding motions return to (near) center by their last step', () => {
  const returning = ['nod', 'shake', 'sway-left', 'sway-right', 'bounce', 'center'] as const
  for (const name of returning) {
    const { steps } = MOTION_CATALOG[name]
    const last = steps[steps.length - 1]
    assert.ok(Math.abs(last.yaw) < 0.01, `${name} should end near yaw 0`)
    assert.ok(Math.abs(last.pitch) < 0.01, `${name} should end near pitch 0`)
  }
})

test('look-* and head-* motions hold their target rather than return to center', () => {
  const holding = ['look-up', 'look-down', 'head-left', 'head-right'] as const
  for (const name of holding) {
    const { steps } = MOTION_CATALOG[name]
    const last = steps[steps.length - 1]
    assert.ok(Math.abs(last.yaw) > 0.01 || Math.abs(last.pitch) > 0.01, `${name} should hold a non-center target`)
  }
})
