export type SCServoFrame = { id: number; status: number; payload: Uint8Array }

// Bounded streaming decoder. Search one byte at a time so noise cannot consume
// the first FF of a valid header. Discard invalid frames before delivering callbacks.
export class SCServoDecoder {
  #buffer = new Uint8Array(64)
  #length = 0
  constructor(private readonly onFrame: (frame: SCServoFrame) => void) {}

  push(byte: number): void {
    if (this.#length === this.#buffer.length) this.#discard(1)
    this.#buffer[this.#length++] = byte
    while (this.#length >= 2) {
      const b = this.#buffer
      if (b[0] !== 0xff || b[1] !== 0xff) {
        this.#discard(1)
        continue
      }
      if (this.#length < 4) return
      const size = b[3] + 4
      if (b[2] >= 0xfe || size < 6 || size > b.length) {
        this.#discard(1)
        continue
      }
      if (this.#length < size) return
      let sum = 0
      for (let i = 2; i < size; i++) sum += b[i]
      if ((sum & 0xff) !== 0xff) {
        this.#discard(1)
        continue
      }
      const frame = { id: b[2], status: b[4], payload: b.slice(5, size - 1) }
      this.#discard(size)
      this.onFrame(frame)
    }
  }

  #discard(count: number): void {
    this.#length -= count
    for (let i = 0; i < this.#length; i++) this.#buffer[i] = this.#buffer[i + count]
  }
}
