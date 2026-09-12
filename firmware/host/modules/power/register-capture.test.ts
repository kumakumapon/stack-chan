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
