import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// Execute the pure TS contracts with Node, including the firmware's XS-specific
// Object.freeze overload, without pulling its platform typings into the web app.
async function moduleUrl(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'))
  source = source.replace(/\bfrom\s*(['"])([^'"]+)\1/g, (statement, quote, name) =>
    imports[name] ? `from ${quote}${imports[name]}${quote}` : statement
  )
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

test('web settings cover the firmware preference contract without obsolete or missing keys', async () => {
  const zone = await moduleUrl('../firmware/host/modules/preferences/timezone-model.ts')
  const [firmwareUrl, webUrl] = await Promise.all([
    moduleUrl('../firmware/host/modules/preferences/consts.ts'),
    moduleUrl('./src/features/preferences/preference-model.ts', { 'timezone-model': zone }),
  ])
  const [{ PREF_KEYS }, { PREFERENCE_KEYS, DEFAULT_PREFERENCES }] = await Promise.all([
    import(firmwareUrl),
    import(webUrl),
  ])
  const advertised = PREF_KEYS.map(([domain, key]) => `${domain}.${key}`).sort()
  assert.deepEqual([...PREFERENCE_KEYS].sort(), advertised)
  assert.deepEqual(Object.keys(DEFAULT_PREFERENCES).sort(), advertised)
  assert.equal(new Set(PREFERENCE_KEYS).size, PREFERENCE_KEYS.length)
  for (const value of Object.values(DEFAULT_PREFERENCES)) assert.equal(typeof value, 'string')
})

test('every shared firmware time-zone label is translated in each web locale', async () => {
  const { TIMEZONE_PRESETS } = await import(await moduleUrl('../firmware/host/modules/preferences/timezone-model.ts'))
  for (const locale of ['ja', 'en']) {
    const catalog = JSON.parse(await readFile(new URL(`./locales/${locale}.json`, import.meta.url), 'utf8'))
    for (const preset of TIMEZONE_PRESETS) {
      assert.equal(typeof catalog[preset.labelKey], 'string', `Missing ${locale} label for ${preset.id}`)
      assert.notEqual(catalog[preset.labelKey], preset.labelKey)
    }
  }
})
