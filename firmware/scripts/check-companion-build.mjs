import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Inspect the linker's generated script table, not production source text.
const root = 'dist/tmp/esp32/m5stackchan_cores3/release'
function findTables(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? findTables(path) : entry.name === 'mc.xs.c' ? [path] : []
  })
}
const tables = findTables(root)
assert.equal(tables.length, 1, 'expected one freshly built CoreS3 host linker table')
const source = readFileSync(tables[0], 'utf8')
const table = source.match(/static const txScript gxScripts\[mxScriptsCount\] = \{([\s\S]*?)\n\};/)
assert.ok(table, 'the release must retain the generated XS module table')
const modules = new Set([...table[1].matchAll(/"([^"\n]+)"/g)].map((match) => match[1].replace(/\.xsb?$/, '')))
for (const name of [
  'app-default-behavior/companion',
  'stackchan-dock',
  'stackchan-gateway-dock',
  'stackchan-usb-dock',
  'stackchan-gateway-microphone',
  'stackchan-gateway-dock-runtime',
  'stackchan-gateway-pcm',
  'stackchan-gateway-pcm-stream',
  'stackchan-gateway-pcm-output',
]) {
  assert.ok(modules.has(name), `CoreS3 release is missing ${name}`)
}
console.log('CoreS3 release contains Companion, router, Gateway, USB, and microphone modules')
