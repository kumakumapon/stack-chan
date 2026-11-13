export type BatteryRegisterReader = (register: number) => number

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff
}

export function readAxp2101BatteryLevel(readRegister: BatteryRegisterReader): number | undefined {
  const status = readRegister(0x00)
  if (!isByte(status) || (status & 0x08) === 0) return undefined

  const level = readRegister(0xa4)
  return isByte(level) && level <= 100 ? level : undefined
}
