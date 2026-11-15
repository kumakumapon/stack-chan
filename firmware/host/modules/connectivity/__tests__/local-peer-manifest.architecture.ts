import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const connectivityManifest = JSON.parse(readFileSync('host/modules/connectivity/manifest.json', 'utf8')) as {
  platforms: Record<string, { include?: string[]; modules?: Record<string, string | string[]> }>
}
test('ESP32 transport binding removes the simulator fallback before adding hardware transports', () => {
  const modules = connectivityManifest.platforms.esp32?.modules
  const exclusions = modules?.['~']
  assert.ok(Array.isArray(exclusions), 'ESP32 must declare its simulator module exclusions')
  assert.ok(exclusions.includes('./sim/local-peer-transports'), 'ESP32 must exclude the simulator transport')
  assert.equal(modules?.['local-peer-transports'], './esp32/local-peer-transports')
})
