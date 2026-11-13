import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { firmwareCapacity, renderSizeReport, resourceSizes } from './firmware-size-report.mjs'

test('capacity report measures compiled resources and rejects overflowing images', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stackchan-size-'))
  try {
    const table = Buffer.alloc(32)
    table.writeUInt16LE(0x50aa)
    table.writeUInt32LE(512, 8)
    writeFileSync(path.join(directory, 'partition-table.bin'), table)
    writeFileSync(path.join(directory, 'xs_esp32.bin'), Buffer.alloc(300))
    writeFileSync(path.join(directory, 'hand.bm4'), Buffer.alloc(22))
    writeFileSync(path.join(directory, 'font.bf4'), Buffer.alloc(40))
    const sizes = resourceSizes('{"hand.bm4", _0, sizeof(_0)}, {"font.bf4", _1, sizeof(_1)}', directory)
    assert.deepEqual(
      sizes.map((item) => item.bytes),
      [40, 22],
    )
    const capacity = firmwareCapacity(directory)
    assert.equal(capacity.free, 212)
    assert.match(renderSizeReport('m5stack', capacity, sizes), /300 \| 512 \| 212/)
    writeFileSync(path.join(directory, 'xs_esp32.bin'), Buffer.alloc(513))
    assert.throws(() => firmwareCapacity(directory), /exceeds/)
    table.writeUInt16LE(0)
    writeFileSync(path.join(directory, 'partition-table.bin'), table)
    assert.throws(() => firmwareCapacity(directory), /missing/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('XS key capacity reads the linked image and reports the remaining budget', async () => {
  const { xsKeyCapacity } = await import('./firmware-size-report.mjs')
  assert.deepEqual(xsKeyCapacity('/* generated */\r\n#define mxKeysCount 7800\r\n'), {
    used: 7800,
    capacity: 8192,
    free: 392,
    minimumFree: 256,
  })
})

test('XS key reserve rejects the previous near-limit image and permits the budget boundary', async () => {
  const { xsKeyCapacity, assertXsKeyReserve } = await import('./firmware-size-report.mjs')
  assert.throws(() => assertXsKeyReserve(xsKeyCapacity('#define mxKeysCount 8087\n')), /105 free/)
  assert.doesNotThrow(() => assertXsKeyReserve(xsKeyCapacity('#define mxKeysCount 7936\n')))
  assert.throws(() => assertXsKeyReserve(xsKeyCapacity('#define mxKeysCount 7937\n')), /reserve below/)
})

test('XS key reporting fails closed on missing, ambiguous, or out-of-range linker metadata', async () => {
  const { xsKeyCapacity } = await import('./firmware-size-report.mjs')
  for (const source of [
    '',
    '#define mxKeysCount nope',
    '#define mxKeysCount 7800\n#define mxKeysCount 7900\n',
    '#define mxKeysCount 0\n',
    '#define mxKeysCount 8193\n',
  ]) {
    assert.throws(() => xsKeyCapacity(source))
  }
})
