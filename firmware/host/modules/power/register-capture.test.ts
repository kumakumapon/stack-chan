import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installRegisterCapture } from './register-capture.js'

for (const [readName, writeName] of [
  ['readByte', 'writeByte'],
  ['readUint8', 'writeUint8'],
]) {
  test(`captures board-created PMIC through ${readName} and preserves register IO`, () => {
    class Power {
      values = new Map<number, number>();
      [readName](register: number) {
        return this.values.get(register) ?? 0
      }
      [writeName](register: number, value: number) {
        this.values.set(register, value)
      }
    }
    const getPower = installRegisterCapture(Power.prototype)
    assert.equal(getPower(), undefined)
    const first = new Power() as unknown as Record<string, (...args: number[]) => unknown>
    first[writeName](0x90, 7)
    const captured = getPower()
    assert.ok(captured)
    assert.equal(captured.readByte(0x90), 7)
    captured.writeByte(0x90, 23)
    assert.equal(first[readName](0x90), 23)
    const second = new Power() as unknown as Record<string, (...args: number[]) => unknown>
    second[writeName](0x90, 99)
    assert.equal(getPower(), captured)
    assert.equal(captured.readByte(0x90), 23)
    assert.equal(second[readName](0x90), 99)
  })
}

test('an SDK exposing both register APIs is captured through one adapter', () => {
  // CoreS3 board setup differs by SDK generation: some builds expose SMBus byte
  // methods, some ECMA-419 uint8 methods, and some both. All three must reach the
  // instance the board already created instead of opening I2C a second time.
  class Power {
    values = new Map<number, number>()
    readByte(register: number) {
      return this.values.get(register) ?? 0
    }
    writeByte(register: number, value: number) {
      this.values.set(register, value)
    }
    readUint8(register: number) {
      return this.readByte(register)
    }
    writeUint8(register: number, value: number) {
      this.writeByte(register, value)
    }
  }
  const getPower = installRegisterCapture(Power.prototype)
  const power = new Power()
  power.writeByte(0x90, 5)
  const captured = getPower()
  assert.ok(captured)
  assert.equal(captured.readByte(0x90), 5)
  captured.writeByte(0x90, 11)
  assert.equal(power.readUint8(0x90), 11)
  // A later call through the other API pair must not replace the capture.
  power.writeUint8(0x91, 3)
  assert.equal(getPower(), captured)
})

test('register capture preserves the receiver and propagates IO errors', () => {
  class Power {
    #value = 0
    readUint8(_register: number) {
      return this.#value
    }
    writeUint8(_register: number, value: number) {
      if (value < 0) throw new Error('write failed')
      this.#value = value
    }
  }
  const getPower = installRegisterCapture(Power.prototype)
  const power = new Power()
  assert.equal(power.readUint8(1), 0)
  const captured = getPower()
  assert.ok(captured)
  captured.writeByte(1, 8)
  assert.equal(power.readUint8(1), 8)
  assert.throws(() => captured.writeByte(1, -1), /write failed/)
  assert.equal(captured.readByte(1), 8)
})
