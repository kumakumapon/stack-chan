import assert from 'node:assert/strict'
import test from 'node:test'
import { captureScreenshot } from './test-browser-screenshot.mjs'

const captureError = () =>
  new Error('page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot')

test('a successful screenshot preserves its options and returns the captured image', async () => {
  const options = { path: '/tmp/example.png', fullPage: true }
  const image = Buffer.from('image')
  const page = {
    async screenshot(received) {
      assert.equal(received, options)
      return image
    },
    async waitForTimeout() {
      assert.fail('a successful capture must not wait or retry')
    },
  }
  assert.equal(await captureScreenshot(page, options), image)
})

test('a transient compositor error waits, then captures with the same options', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const options = { path: '/tmp/example.png', fullPage: false }
  const image = Buffer.from('image')
  const events = []
  const page = {
    async screenshot(received) {
      assert.equal(received, options)
      events.push('capture')
      if (events.length === 1) throw captureError()
      return image
    },
    async waitForTimeout(delay) {
      assert.ok(Number.isFinite(delay) && delay > 0, 'retry must allow the compositor to recover')
      events.push('wait')
    },
  }
  assert.equal(await captureScreenshot(page, options), image)
  assert.deepEqual(events, ['capture', 'wait', 'capture'])
})

test('persistent compositor errors fail within the retry budget instead of returning a missing image', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const failure = captureError()
  let attempts = 0
  const page = {
    async screenshot() {
      attempts++
      if (attempts > 3) throw new Error('retry budget exceeded')
      throw failure
    },
    async waitForTimeout() {},
  }
  await assert.rejects(captureScreenshot(page, {}), (error) => error === failure)
  assert.ok(attempts > 1 && attempts <= 3)
})

test('browser crashes, timeouts and other protocol errors are propagated without retry', async () => {
  for (const message of [
    'Target page, context or browser has been closed',
    'page.screenshot: Timeout 30000ms exceeded',
    'Protocol error (Page.captureScreenshot): Invalid parameters',
  ]) {
    const failure = new Error(message)
    let attempts = 0
    const page = {
      async screenshot() {
        attempts++
        throw failure
      },
      async waitForTimeout() {
        assert.fail('unrelated errors must not be retried')
      },
    }
    await assert.rejects(captureScreenshot(page, {}), (error) => error === failure)
    assert.equal(attempts, 1)
  }
})

test('an interrupted recovery wait fails immediately', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const failure = new Error('browser closed during recovery')
  const page = {
    async screenshot() {
      throw captureError()
    },
    async waitForTimeout() {
      throw failure
    },
  }
  await assert.rejects(captureScreenshot(page, {}), (error) => error === failure)
})
