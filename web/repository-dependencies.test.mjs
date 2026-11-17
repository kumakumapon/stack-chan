import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

const root = new URL('../', import.meta.url)
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'))

test('direct application dependencies are exact and agree with the lockfile', () => {
  for (const directory of ['firmware', 'web', 'gateway']) {
    const manifest = readJson(`${directory}/package.json`)
    const lock = readJson(`${directory}/package-lock.json`)
    for (const section of ['dependencies', 'devDependencies']) {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        assert.match(version, /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/, `${directory}: ${name} must be exact`)
        assert.equal(lock.packages[''][section][name], version, `${directory}: lock spec for ${name}`)
        assert.equal(lock.packages[`node_modules/${name}`].version, version, `${directory}: resolved ${name}`)
      }
    }
  }
})

test('external Actions are digest-pinned and shared Actions use the same revision', () => {
  const workflows = readdirSync(new URL('.github/workflows/', root))
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => `.github/workflows/${file}`)
  const composites = readdirSync(new URL('.github/actions/', root), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `.github/actions/${entry.name}/action.yml`)
  const revisions = new Map()
  const inspect = (value, path) => {
    if (!value || typeof value !== 'object') return
    if (typeof value.uses === 'string' && !value.uses.startsWith('./')) {
      const match = /^([^@]+)@([a-f0-9]{40})$/.exec(value.uses)
      assert.ok(match, `${path}: Action must use a full commit SHA: ${value.uses}`)
      const repository = match[1].split('/').slice(0, 2).join('/').toLowerCase()
      if (revisions.has(repository)) {
        assert.equal(match[2], revisions.get(repository), `${path}: inconsistent revision for ${repository}`)
      }
      revisions.set(repository, match[2])
    }
    for (const child of Object.values(value)) inspect(child, path)
  }
  for (const path of [...workflows, ...composites]) {
    inspect(parse(readFileSync(new URL(path, root), 'utf8')), path)
  }
  assert.ok(revisions.size > 0)
})
