import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { verifyResults } from './ci-results.mjs'

const webNeeds = () => ({ 'web-build': { result: 'success' }, 'web-browser': { result: 'success' } })
const testNeeds = (firmware = 'true') => ({
  changes: { result: 'success', outputs: { firmware } },
  'test-fast': { result: 'success' },
  'web-visual': { result: 'success' },
  biome: { result: 'success' },
  'test-moddable': { result: 'success' },
  'test-smoke': { result: 'success' },
})

test('successful browser and firmware dependencies pass', () => {
  assert.doesNotThrow(() => verifyResults('web', webNeeds()))
  for (const event of ['push', 'pull_request', 'workflow_dispatch']) {
    assert.doesNotThrow(() => verifyResults('test', testNeeds(), event))
  }
})

test('every required dependency rejects failure, cancellation, skip and missing result', () => {
  for (const [mode, create] of [
    ['web', webNeeds],
    ['test', testNeeds],
  ]) {
    for (const job of Object.keys(create())) {
      for (const result of ['failure', 'cancelled', 'skipped', undefined, 'unknown']) {
        const needs = create()
        needs[job].result = result
        assert.throws(() => verifyResults(mode, needs, 'push'), /did not pass/)
      }
    }
  }
})

test('only firmware jobs may skip when the change detector explicitly reports false', () => {
  const needs = testNeeds('false')
  for (const job of ['biome', 'test-moddable', 'test-smoke']) needs[job].result = 'skipped'
  for (const event of ['push', 'pull_request']) {
    assert.doesNotThrow(() => verifyResults('test', needs, event))
  }
  for (const job of Object.keys(needs)) {
    for (const result of ['failure', 'cancelled']) {
      const failed = structuredClone(needs)
      failed[job].result = result
      assert.throws(() => verifyResults('test', failed, 'push'), /did not pass/)
    }
  }
  for (const job of ['changes', 'test-fast', 'web-visual']) {
    const skipped = structuredClone(needs)
    skipped[job].result = 'skipped'
    assert.throws(() => verifyResults('test', skipped, 'push'), /did not pass/)
  }
})

test('manual runs require firmware jobs even without change-filter output', () => {
  const needs = testNeeds(undefined)
  delete needs.changes.outputs
  assert.doesNotThrow(() => verifyResults('test', needs, 'workflow_dispatch'))
  needs['test-smoke'].result = 'skipped'
  assert.throws(() => verifyResults('test', needs, 'workflow_dispatch'), /test-smoke/)
})

test('invalid change detection, dependency sets, groups and events fail closed', () => {
  for (const value of ['', undefined, true, 'yes']) {
    const needs = testNeeds()
    needs.changes.outputs.firmware = value
    assert.throws(() => verifyResults('test', needs, 'push'), /change detection/)
  }
  for (const mode of ['web', 'test']) {
    for (const needs of [null, [], {}, { unexpected: { result: 'success' } }]) {
      assert.throws(() => verifyResults(mode, needs, 'push'))
    }
  }
  assert.throws(() => verifyResults('unknown', webNeeds()), /Unknown/)
  assert.throws(() => verifyResults('test', testNeeds(), 'schedule'), /Unsupported/)
})

test('a browser failure propagates through both aggregate checks', () => {
  const browser = webNeeds()
  browser['web-browser'].result = 'failure'
  assert.throws(() => verifyResults('web', browser), /web-browser/)
  const all = testNeeds()
  all['web-visual'].result = 'failure'
  assert.throws(() => verifyResults('test', all, 'push'), /web-visual/)
})

test('CLI exits nonzero for failed dependencies and malformed input', () => {
  const run = (needs) =>
    spawnSync(process.execPath, [new URL('./ci-results.mjs', import.meta.url).pathname, 'web'], {
      encoding: 'utf8',
      env: { ...process.env, CI_NEEDS: needs },
    })
  assert.equal(run(JSON.stringify(webNeeds())).status, 0)
  const needs = webNeeds()
  needs['web-browser'].result = 'cancelled'
  assert.equal(run(JSON.stringify(needs)).status, 1)
  assert.equal(run('{invalid').status, 1)
})
