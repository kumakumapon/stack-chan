import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import * as fontkit from 'fontkit'

const locales = ['ja', 'en'] as const
const firmwareRoot = process.cwd()
const catalogs = Object.fromEntries(
  locales.map((locale) => [
    locale,
    JSON.parse(readFileSync(join(firmwareRoot, 'host', 'app', 'strings', `${locale}.json`), 'utf8')) as Record<
      string,
      string
    >,
  ]),
) as Record<(typeof locales)[number], Record<string, string>>

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]).sort()
}

// Firmware resources use stable semantic keys, so placeholder names are an
// explicit contract rather than being embedded in the key text.
const placeholderContracts: Record<string, string[]> = {
  'mods.confirm': ['name'],
  'settings.volumeValue': ['percent'],
  'settings.wifiStatus': ['status'],
  'splash.connecting': ['attempt', 'maxAttempts'],
}

test('firmware localization catalogs have matching keys and placeholders', () => {
  const japaneseKeys = Object.keys(catalogs.ja).sort()
  for (const locale of locales.slice(1)) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), japaneseKeys, `${locale} keys`)
  }
  for (const key of japaneseKeys) {
    for (const locale of locales) {
      assert.deepEqual(placeholders(catalogs[locale][key]), placeholderContracts[key] ?? [], `${locale}: ${key}`)
    }
  }
})

test('the Japanese UI font covers the host Mini App catalogs on embedded targets', () => {
  const font = fontkit.openSync(join(firmwareRoot, 'host', 'modules', 'ui', 'assets', 'fonts', 'k8x12.ttf'))
  const supported = new Set(font.characterSet)
  const messages = Object.entries(catalogs.ja)
    .filter(([key]) =>
      ['focus.', 'memory.', 'quest.', 'quiz.', 'daily.', 'workshop.', 'story.'].some((prefix) =>
        key.startsWith(prefix),
      ),
    )
    .map(([, value]) => value)
  const required = new Set(
    messages
      .join('')
      .split('')
      .filter((character) => !/\s/u.test(character)),
  )
  assert.deepEqual(
    [...required].filter((character) => !supported.has(character.codePointAt(0) as number)),
    [],
  )
})
