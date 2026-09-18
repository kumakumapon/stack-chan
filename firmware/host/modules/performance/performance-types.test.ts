import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isMotionName, isPerformanceName, MOTION_NAMES, PERFORMANCE_NAMES } from './performance-types.js'

test('only catalogued names pass the guards', () => {
  for (const name of PERFORMANCE_NAMES) assert.equal(isPerformanceName(name), true)
  for (const name of MOTION_NAMES) assert.equal(isMotionName(name), true)
  assert.equal(isPerformanceName('moonwalk'), false)
  assert.equal(isMotionName('backflip'), false)
  assert.equal(isPerformanceName(42), false)
})
