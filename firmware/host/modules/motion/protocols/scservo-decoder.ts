export type SCServoFrame = { id: number; status: number; payload: Uint8Array }

/**
 * Bus-wide receive counters. The values are cumulative since boot and are the
 * only evidence of a noisy or half-broken servo bus that survives to the
 * application, so they are reported through `SCServo.getBusDiagnostics()`.
 */
export type SCServoDecoderStats = {
  /** Frames that passed header, length and checksum validation. */
  framesDecoded: number
  /** Bytes dropped while searching for a header or an acceptable length. */
  discardedBytes: number
  /** Frames rejected because the trailing checksum did not match. */
  checksumErrors: number
  /** Frames rejected because the declared length was impossible. */
  lengthErrors: number
  /** Bytes dropped because the bounded buffer was already full. */
  overflowBytes: number
}

// Bounded streaming decoder. Search one byte at a time so noise cannot consume
// the first FF of a valid header. Discard invalid frames before delivering callbacks.
export class SCServoDecoder {
  #buffer = new Uint8Array(64)
  #length = 0
  // Reused snapshot: diagnostics must not allocate on the receive path.
  #stats: SCServoDecoderStats = {
    framesDecoded: 0,
    discardedBytes: 0,
    checksumErrors: 0,
    lengthErrors: 0,
    overflowBytes: 0,
  }
  constructor(private readonly onFrame: (frame: SCServoFrame) => void) {}

  /** Receive counters. The same instance is reused between calls. */
  getStats(): Readonly<SCServoDecoderStats> {
    return this.#stats
  }

  push(byte: number): void {
    if (this.#length === this.#buffer.length) {
      this.#stats.overflowBytes++
      this.#discard(1)
    }
    this.#buffer[this.#length++] = byte
    while (this.#length >= 2) {
      const b = this.#buffer
      if (b[0] !== 0xff || b[1] !== 0xff) {
        this.#stats.discardedBytes++
        this.#discard(1)
        continue
      }
      if (this.#length < 4) return
      const size = b[3] + 4
      if (b[2] >= 0xfe || size < 6 || size > b.length) {
        this.#stats.lengthErrors++
        this.#stats.discardedBytes++
        this.#discard(1)
        continue
      }
      if (this.#length < size) return
      let sum = 0
      for (let i = 2; i < size; i++) sum += b[i]
      if ((sum & 0xff) !== 0xff) {
        this.#stats.checksumErrors++
        this.#stats.discardedBytes++
        this.#discard(1)
        continue
      }
      const frame = { id: b[2], status: b[4], payload: b.slice(5, size - 1) }
      this.#discard(size)
      this.#stats.framesDecoded++
      this.onFrame(frame)
    }
  }

  #discard(count: number): void {
    this.#length -= count
    for (let i = 0; i < this.#length; i++) this.#buffer[i] = this.#buffer[i + count]
  }
}
