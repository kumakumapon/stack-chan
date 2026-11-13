import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { restoreRuntime, suiteEntry, suites } from './ci-web-suites.mjs'

test('the matrix includes every independently discovered browser integration suite once', () => {
  const webRoot = new URL('../../web/', import.meta.url)
  const discovered = [
    ...readdirSync(webRoot).filter((file) => file.endsWith('-visual-test.mjs') || file === 'visual-pages-test.mjs'),
    ...readdirSync(new URL('simulator/', webRoot))
      .filter((file) => file.endsWith('-test.mjs'))
      .map((file) => `simulator/${file}`),
  ]
  assert.deepEqual(Object.values(suites).sort(), discovered.sort())
  const matrix = spawnSync(process.execPath, [new URL('./ci-web-suites.mjs', import.meta.url).pathname, 'matrix'], {
    encoding: 'utf8',
  })
  assert.equal(matrix.status, 0)
  assert.deepEqual(JSON.parse(matrix.stdout).suite.sort(), Object.keys(suites).sort())
})

test('suite selection rejects arbitrary scripts and inherited properties', () => {
  for (const name of Object.keys(suites)) assert.equal(suiteEntry(name), suites[name])
  for (const name of [undefined, '', '../arbitrary.mjs', '__proto__', 'constructor']) {
    assert.throws(() => suiteEntry(name), /Unknown web suite/)
  }
})

test('runtime restoration uses the shared artifact and replaces stale generated source files', () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-web-runtime-'))
  const files = [
    'index.html',
    'simulator/mc.js',
    'simulator/mc.wasm',
    'mod-gallery/samples/stackchan-pet/stackchan-pet.xsa',
  ]
  try {
    for (const file of files) {
      const path = join(root, 'dist', file)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, `artifact ${file}`)
    }
    mkdirSync(join(root, 'simulator'), { recursive: true })
    writeFileSync(join(root, 'simulator/mc.js'), 'stale runtime')
    restoreRuntime(root)
    for (const file of files.slice(1)) {
      assert.deepEqual(readFileSync(join(root, file)), readFileSync(join(root, 'dist', file)))
    }
    rmSync(join(root, 'dist/simulator/mc.wasm'))
    assert.throws(() => restoreRuntime(root))
    writeFileSync(join(root, 'dist/simulator/mc.wasm'), '')
    assert.throws(() => restoreRuntime(root), /Missing web runtime/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
