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
