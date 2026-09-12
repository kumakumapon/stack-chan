export type RegisterIO = {
  readByte(register: number): number
  writeByte(register: number, value: number): void
}

// SDK generations expose either SMBus byte methods or ECMA-419 uint8 methods.
// Keep one adapter to the instance constructed by board setup; never open I2C twice.
export function installRegisterCapture(prototype: object): () => RegisterIO | undefined {
  const methods = prototype as Record<string, (...args: number[]) => unknown>
  const read = methods.readUint8 ?? methods.readByte
  const write = methods.writeUint8 ?? methods.writeByte
  if (typeof read !== 'function' || typeof write !== 'function') throw new Error('unsupported power register API')
  let captured: RegisterIO | undefined
  for (const name of ['readUint8', 'writeUint8', 'readByte', 'writeByte']) {
    const original = methods[name]
    if (typeof original !== 'function') continue
    methods[name] = function (...args: number[]) {
      captured ??= {
        readByte: (register) => read.call(this, register) as number,
        writeByte: (register, value) => {
          write.call(this, register, value)
        },
      }
      return original.apply(this, args)
    }
  }
  return () => captured
}
