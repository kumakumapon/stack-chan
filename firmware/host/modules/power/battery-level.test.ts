import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAxp2101BatteryLevel } from './battery-level.js'

type RegisterValues = readonly (readonly [number, number])[]

function registerReader(registers: RegisterValues) {
  const values = new Map(registers)
  return (register: number): number => {
    const value = values.get(register)
    if (value === undefined) throw new Error(`missing register 0x${register.toString(16)}`)
    return value
  }
}

test('AXP2101 reads the hardware state-of-charge only when a battery is present', () => {
  assert.equal(
    readAxp2101BatteryLevel(
      registerReader([
        [0x00, 0x08],
        [0xa4, 67],
      ]),
    ),
    67,
  )
  assert.equal(readAxp2101BatteryLevel(registerReader([[0x00, 0x00]])), undefined)
  assert.equal(
    readAxp2101BatteryLevel(
      registerReader([
        [0x00, 0x08],
        [0xa4, 101],
      ]),
    ),
    undefined,
  )
})
