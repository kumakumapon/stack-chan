import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isXsArchive, xsArchiveVersion } from '../editor/mod-builder.mjs'
import { profileFor } from '../editor/capabilities.mjs'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const firmwareRoot = resolve(webRoot, '../firmware')
const sourceRoot = join(firmwareRoot, 'mods/examples/stackchan_pet')
const targetRoot = join(webRoot, 'mod-gallery/samples/stackchan-pet')
const archiveRoot = join(firmwareRoot, 'dist/bin/lin')

if (!existsSync(archiveRoot)) throw new Error('Build the simulator Pet MOD before staging the Gallery package')
const archives = readdirSync(archiveRoot, { recursive: true })
  .filter((name) => name.endsWith('.xsa'))
  .map((name) => join(archiveRoot, name))
if (archives.length !== 1) throw new Error(`Expected one simulator Pet archive, found ${archives.length}`)

const archive = archives[0]
const bytes = readFileSync(archive)
if (!isXsArchive(bytes)) throw new Error(`${archive} is not an XS archive`)
const expectedVersion = profileFor('simulator').xsArchiveVersion
if (JSON.stringify(xsArchiveVersion(bytes)) !== JSON.stringify(expectedVersion)) {
  throw new Error(`Pet archive XS version does not match the simulator profile: ${archive}`)
}

for (const name of ['mod.js', 'pet-state.js', 'pet-storage.js', 'pet-status.js']) {
  const target = join(targetRoot, 'mod', name)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(sourceRoot, name), target)
}
cpSync(join(sourceRoot, 'manifest_wasm.json'), join(targetRoot, 'mod/manifest.json'))
cpSync(archive, join(targetRoot, 'stackchan-pet.xsa'))
console.log(`Staged Virtual Pet Gallery package from ${archive}`)
