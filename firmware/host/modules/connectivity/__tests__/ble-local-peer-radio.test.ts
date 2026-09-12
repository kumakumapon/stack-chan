import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function installBareSpecifierPackages(): void {
  writeAliasPackage(modulesRoot, 'timer', resolve(modulesRoot, 'testing/fakes/timer.js'), { hasDefaultExport: true })
  writeAliasPackage(modulesRoot, 'ble-local-peer-record', resolve(modulesRoot, 'connectivity/ble/local-peer-record.js'))
  writeAliasPackage(modulesRoot, 'crypt', resolve(modulesRoot, 'connectivity/__tests__/fakes/crypt.js'))
  writeAliasPackage(modulesRoot, 'local-peer-auth', resolve(modulesRoot, 'connectivity/local-peer-auth.js'))
  writeAliasPackage(modulesRoot, 'local-peer-codec', resolve(modulesRoot, 'connectivity/local-peer-codec.js'))
  writeAliasPackage(modulesRoot, 'local-peer-frame', resolve(modulesRoot, 'connectivity/local-peer-frame.js'))
  writeAliasPackage(modulesRoot, 'uartserver', resolve(modulesRoot, 'connectivity/__tests__/fakes/uartserver.js'))
}

test('closing a BLE local-peer radio prevents a late disconnect from restarting advertising', async () => {
  installBareSpecifierPackages()
  const [{ default: createRadio }, uartserver] = await Promise.all([
    import('../ble/local-peer-radio.js'),
    import('./fakes/uartserver.js'),
  ])
  const radio = createRadio({
    id: '001122334455',
    offlineChannel: 0,
    onReceive() {},
  })
  const server = uartserver.lastUARTServer
  assert.ok(server)

  ;(server as typeof server & { onDisconnected(): void }).onDisconnected()
  assert.equal(server.advertisingStarts.length, 1)

  radio.close()
  ;(server as typeof server & { onDisconnected(): void }).onDisconnected()
  assert.equal(server.closed, true)
  assert.equal(server.advertisingStarts.length, 1)
})

test('BLE notifications are paced, contiguous, and cancelled on disconnect', async () => {
  installBareSpecifierPackages()
  const [{ default: createRadio }, uartserver, { default: timer }, codec] = await Promise.all([
    import('../ble/local-peer-radio.js'),
    import('./fakes/uartserver.js'),
    import('../../testing/fakes/timer.js'),
    import('../ble/local-peer-record.js'),
  ])
  timer.reset()
  const radio = createRadio({ id: '001122334455', offlineChannel: 0, onReceive() {} })
  const server = uartserver.lastUARTServer as typeof uartserver.lastUARTServer & {
    onCharacteristicNotifyEnabled(characteristic: unknown): void
    onRX(data: ArrayBuffer): void
    onDisconnected(): void
  }
  assert.ok(server)
  const settle = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  }
  const step = async () => {
    timer.advance(20)
    await settle()
  }
  server.onCharacteristicNotifyEnabled({ name: 'tx' })
  await settle()
  assert.equal(server.notifications.length, 1)
  await step()
  await step()
  server.onRX(
    codec.encodeBLELocalPeerRecord({
      kind: 1,
      authenticated: false,
      sourceId: 'AABBCCDDEEFF',
      destinationId: 'FFFFFFFFFFFF',
      payload: new Uint8Array(0),
    }),
  )
  server.notifications.length = 0
  const one = radio.send('AABBCCDDEEFF', new Uint8Array(60).fill(1).buffer)
  const two = radio.send('AABBCCDDEEFF', new Uint8Array(60).fill(2).buffer)
  await settle()
  assert.equal(server.notifications.length, 1, 'only one chunk may be submitted before yielding')
  for (let i = 0; i < 12; i++) await step()
  await Promise.all([one, two])
  const decoder = new codec.BLELocalPeerRecordDecoder()
  const records = server.notifications.flatMap(({ value }) => decoder.push(value))
  assert.deepEqual(
    records.map((r) => Array.from(r.payload)),
    [Array(60).fill(1), Array(60).fill(2)],
  )
  const pending = radio.send('AABBCCDDEEFF', new Uint8Array(60).buffer)
  const rejected = assert.rejects(pending, /connection changed/)
  await settle()
  const before = server.notifications.length
  server.onDisconnected()
  await step()
  await rejected
  assert.equal(server.notifications.length, before, 'no old chunks may reach a new connection')
  radio.close()
  timer.reset()
})
