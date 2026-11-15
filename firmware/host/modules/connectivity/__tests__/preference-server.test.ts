import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DOMAIN, PREF_KEYS } from '../../preferences/consts.js'
import { writeAliasPackage } from '../../testing/node-alias-package.js'

type FakePreference = {
  resetPreference(values?: Record<string, unknown>): void
  default: {
    get(domain: string, name: string): unknown
  }
}

type TestPreferenceServer = {
  advertisingStarts: unknown[]
  notifications: { value: ArrayBuffer }[]
  onReady(): void
  onCharacteristicNotifyEnabled(characteristic: { name: string }): void
  receiveAndSetPreference(domain: string, key: string, value: string): void
}

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  writeAliasPackage(modulesRoot, 'consts', resolve(modulesRoot, 'preferences/consts.js'))
  writeAliasPackage(modulesRoot, 'preference', resolve(modulesRoot, 'testing/fakes/preference.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), {
    hasDefaultExport: true,
  })
  writeAliasPackage(modulesRoot, 'uartserver', resolve(modulesRoot, 'connectivity/__tests__/fakes/uartserver.js'))
}

async function setup() {
  installBareSpecifierPackages()
  const arrayBufferConstructor = ArrayBuffer as typeof ArrayBuffer & {
    fromString(value: string): ArrayBuffer
  }
  arrayBufferConstructor.fromString = (value) => new TextEncoder().encode(value).buffer as ArrayBuffer
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = () => {}

  const [preference, preferenceServer] = await Promise.all([
    import('../../testing/fakes/preference.js') as Promise<FakePreference>,
    import('../preference-server.js'),
  ])
  preference.resetPreference()
  return { PreferenceServer: preferenceServer.PreferenceServer, preference }
}

function notificationPayload(server: TestPreferenceServer, index = 0): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(server.notifications[index]?.value))
}

test('preference writes persist credentials without copying their contents to the serial trace', async () => {
  const { PreferenceServer, preference } = await setup()
  const traces: string[] = []
  ;(globalThis as typeof globalThis & { trace: (...messages: unknown[]) => void }).trace = (...messages) => {
    traces.push(messages.map(String).join(''))
  }
  const server = new PreferenceServer({ keys: PREF_KEYS }) as TestPreferenceServer
  server.receiveAndSetPreference(DOMAIN.gateway, 'token', 'private-test-token')
  server.receiveAndSetPreference(DOMAIN.wifi, 'password', 'private-test-password')
  assert.equal(preference.default.get(DOMAIN.gateway, 'token'), 'private-test-token')
  assert.equal(preference.default.get(DOMAIN.wifi, 'password'), 'private-test-password')
  assert.match(traces.join(''), /gateway\.token/)
  assert.equal(traces.join('').includes('private-test-token'), false)
  assert.equal(traces.join('').includes('private-test-password'), false)
})

test('starts connectable BLE advertising when ready', async () => {
  const { PreferenceServer } = await setup()
  const server = new PreferenceServer({}) as TestPreferenceServer

  server.onReady()

  assert.deepEqual(server.advertisingStarts, [
    {
      advertisingData: {
        flags: 6,
        completeName: 'STK',
        completeUUID128List: ['test-service'],
      },
    },
  ])
})
test('read-only driver type publishes the platform value and rejects BLE overrides', async () => {
  const { PreferenceServer, preference } = await setup()
  preference.resetPreference({ 'driver.type': 'scservo' })
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    effectiveValues: { 'driver.type': 'm5stackchan' },
    readOnlyKeys: ['driver.type'],
  }) as TestPreferenceServer

  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  assert.deepEqual(notificationPayload(server), {
    prop: 'driver.type',
    value: 'm5stackchan',
    readOnly: true,
  })

  server.receiveAndSetPreference(DOMAIN.driver, 'type', 'dynamixel')
  assert.equal(preference.default.get(DOMAIN.driver, 'type'), 'scservo')
  assert.deepEqual(notificationPayload(server, 1), {
    prop: 'driver.type',
    value: 'm5stackchan',
    readOnly: true,
  })
})

test('unlocked driver type remains writable for other platforms', async () => {
  const { PreferenceServer, preference } = await setup()
  const server = new PreferenceServer({
    keys: PREF_KEYS,
    effectiveValues: { 'driver.type': 'm5stackchan' },
  }) as TestPreferenceServer

  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  server.receiveAndSetPreference(DOMAIN.driver, 'type', 'scservo')

  assert.equal(preference.default.get(DOMAIN.driver, 'type'), 'scservo')
  assert.deepEqual(notificationPayload(server, 1), { prop: 'driver.type', value: 'scservo' })
})
