import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkStorage } from './chunk-storage.js'

test('interrupted multi-entry writes preserve the prior bank and keep NVS strings bounded', () => {
  const data = new Map<string, string>()
  let writes = Infinity
  const preference = {
    get: (_domain: string, key: string) => data.get(key),
    set: (_domain: string, key: string, value: string) => {
      if (--writes < 0) throw Error('power loss')
      assert.ok(Buffer.byteLength(value) < 4000)
      data.set(key, value)
    },
  }
  const storage = chunkStorage(preference, 'sc_deck')
  storage.set('あ'.repeat(12000))
  writes = 3
  assert.throws(() => storage.set('い'.repeat(18000)))
  assert.equal(chunkStorage(preference, 'sc_deck').get(), 'あ'.repeat(12000))
  writes = Infinity
  storage.set('う'.repeat(18000))
  assert.equal(storage.get(), 'う'.repeat(18000))
})

test('UTF-8 storage round trips astral characters at chunk boundaries', () => {
  const data = new Map<string, string>()
  const storage = chunkStorage(
    {
      get: (_, key) => data.get(key),
      set: (_, key, value) => data.set(key, Buffer.from(value).toString()),
    },
    'deck',
  )
  const value = 'a'.repeat(899) + '🐻'.repeat(9000)
  storage.set(value)
  assert.equal(storage.get(), value)
})
