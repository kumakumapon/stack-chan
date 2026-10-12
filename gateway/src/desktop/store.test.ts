import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defaultSettings, parseSettings } from './settings.ts'
import { openDesktopStore } from './store.ts'

test('history and settings survive restart, concurrent appends, switching, and deletion', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await openDesktopStore(directory)
  const token = store.settings().deviceToken
  await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      store.append('stackchan-01', {
        at: new Date().toISOString(),
        provider: 'codex',
        user: `質問${index}`,
        assistant: `返答${index}`,
      }),
    ),
  )
  const settings = store.settings()
  settings.provider = 'lmstudio'
  settings.name = 'まめ'
  await store.update(settings)
  const restored = await openDesktopStore(directory)
  assert.equal(restored.settings().deviceToken, token)
  assert.equal(restored.settings().name, 'まめ')
  assert.equal(restored.settings().provider, 'lmstudio')
  assert.equal(restored.history('stackchan-01').length, 5)
  await restored.clear('stackchan-01')
  assert.deepEqual((await openDesktopStore(directory)).history('stackchan-01'), [])
  assert.equal((await readFile(join(directory, 'desktop.json'), 'utf8')).includes('質問'), false)
})

test('settings reject cloud speech endpoints, URL credentials, and unsafe device ids before writing', async () => {
  for (const endpoint of [
    'https://example.com',
    'http://example.com',
    'http://user:password@127.0.0.1:8000',
    'http://127.0.0.1:8000/?token=secret',
  ]) {
    const settings = defaultSettings()
    settings.speech.sttEndpoint = endpoint
    assert.throws(() => parseSettings(settings))
  }
  const settings = defaultSettings()
  settings.deviceId = '../device'
  assert.throws(() => parseSettings(settings))
})

test('corrupt saved data is reported without replacing the file or generating a new token', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-corrupt-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'desktop.json')
  await writeFile(path, '{broken')
  await assert.rejects(openDesktopStore(directory))
  assert.equal(await readFile(path, 'utf8'), '{broken')
})
