import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installFocusTimerVisibility } from './focus-timer-lifecycle.mjs'

test('visibility captures the first hidden instant, nudges the host once and cleans up', () => {
  let handler
  let now = 42
  let ticks = 0
  const pending = new Set()
  const document = {
    hidden: false,
    addEventListener(name, callback) {
      assert.equal(name, 'visibilitychange')
      handler = callback
    },
    removeEventListener(_name, callback) {
      assert.equal(callback, handler)
      handler = undefined
    },
  }
  const runtime = { state: {} }
  const dispose = installFocusTimerVisibility({
    document,
    runtime,
    idle: () => ticks++,
    now: () => now,
    setTimeoutFn: (callback) => {
      pending.add(callback)
      return callback
    },
    clearTimeoutFn: (callback) => pending.delete(callback),
  })
  document.hidden = true
  handler()
  now = 500
  document.hidden = false
  handler()
  document.hidden = true
  handler()
  assert.equal(runtime.state.focusHiddenAt, 42, 'throttling must not replace the first hidden instant')
  assert.equal(pending.size, 1)
  const callback = [...pending][0]
  callback()
  assert.equal(ticks, 1)
  document.hidden = false
  handler()
  assert.equal(ticks, 1, 'returning cannot restart the timer')
  dispose()
  assert.equal(handler, undefined)
  assert.equal(runtime.state.focusHiddenAt, undefined)
  callback()
  assert.equal(ticks, 1, 'disposed lifecycle cannot call a destroyed WASM machine')
})
