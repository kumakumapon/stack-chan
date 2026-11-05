import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as fontkit from 'fontkit'
import { formatPlayText, PLAY_PACK_STRINGS } from './play-pack-strings.js'

const firmwareRoot = process.cwd()

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()
}

test('play pack messages have matching locale keys and placeholders', () => {
  const japanese = Object.keys(PLAY_PACK_STRINGS.ja).sort()
  assert.deepEqual(Object.keys(PLAY_PACK_STRINGS.en).sort(), japanese)
  for (const key of japanese) {
    assert.deepEqual(placeholders(PLAY_PACK_STRINGS.en[key]), placeholders(PLAY_PACK_STRINGS.ja[key]), key)
    assert.ok(PLAY_PACK_STRINGS.ja[key].trim().length > 0, `${key} is not empty`)
  }
})

test('play pack keys stay out of the shared host catalogs that every target ships', () => {
  for (const locale of ['ja', 'en']) {
    const catalog = JSON.parse(readFileSync(join(firmwareRoot, 'host', 'app', 'strings', `${locale}.json`), 'utf8'))
    assert.deepEqual(
      Object.keys(catalog).filter((key) => key in PLAY_PACK_STRINGS.ja),
      [],
      `${locale} catalog duplicates play pack keys`,
    )
  }
})

test('the Japanese UI font covers every play pack message on embedded targets', () => {
  const font = fontkit.openSync(join(firmwareRoot, 'host', 'modules', 'ui', 'assets', 'fonts', 'k8x12.ttf'))
  const supported = new Set(font.characterSet)
  const required = new Set(
    Object.values(PLAY_PACK_STRINGS.ja)
      .concat(Object.values(PLAY_PACK_STRINGS.en))
      .join('')
      .split('')
      .filter((character) => !/\s/u.test(character)),
  )
  assert.deepEqual(
    [...required].filter((character) => !supported.has(character.codePointAt(0) as number)),
    [],
  )
})

test('play pack messages resolve placeholders and fall back visibly', () => {
  const key = Object.keys(PLAY_PACK_STRINGS.ja).find((name) => placeholders(PLAY_PACK_STRINGS.ja[name]).length > 0)
  assert.ok(key, 'at least one message takes a value')
  const [name] = placeholders(PLAY_PACK_STRINGS.ja[key])
  assert.ok(formatPlayText('ja', key, { [name]: 7 }).includes('7'))
  assert.ok(!formatPlayText('en', key, { [name]: 7 }).includes(`{${name}}`))
  assert.equal(formatPlayText('fr', key), PLAY_PACK_STRINGS.ja[key], 'unknown locales use Japanese')
  assert.equal(formatPlayText('ja', 'missing.key'), 'missing.key', 'unknown keys stay visible')
})

test('targets that drop the play pack drop its host and every game UI module together', () => {
  type Manifest = {
    modules?: Record<string, unknown>
    platforms?: Record<string, { modules?: Record<string, unknown> }>
  }
  const manifest = JSON.parse(readFileSync(join(firmwareRoot, 'host', 'app', 'manifest.json'), 'utf8')) as Manifest
  const hostModules = (manifest.modules?.['*'] as string[] | undefined) ?? []
  const playPack = hostModules.filter((path) => /\/(janken|quick-tap|fortune|play-pack)[^/]*$/.test(path))
  assert.ok(playPack.includes('./play-pack-host'), 'the play pack is part of the standard host')
  for (const [platform, config] of Object.entries(manifest.platforms ?? {})) {
    const removed = new Set((config.modules?.['~'] as string[] | undefined) ?? [])
    const dropped = playPack.filter((path) => removed.has(path))
    if (dropped.length === 0) continue
    // The Drawer probes the game UI modules by name, so a partial removal would leave dead entries.
    assert.deepEqual(dropped.sort(), [...playPack].sort(), `${platform} removes the whole play pack`)
    assert.equal(config.modules?.['play-pack-host'], './play-pack-unsupported', `${platform} keeps a no-op host`)
  }
})
