/**
 * PCM16 helpers shared by the media plane, VAD and the STT/TTS adapters.
 *
 * Everything here is pure and synchronous: no I/O, no clocks. `stackchan.gateway.v1`
 * fixes the wire format to signed 16-bit little-endian mono, base64 per frame
 * (see `GatewayAudioFormat`), so encode/decode round-trip exactly that.
 */

/** Encodes a PCM16 frame to base64, little-endian, matching the gateway wire format. */
export function encodePcm16Base64(frame: Int16Array): string {
  const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
  return buffer.toString('base64')
}

/** Decodes a base64 PCM16 payload back into samples. Empty input yields an empty frame. */
export function decodePcm16Base64(payload: string): Int16Array {
  const buffer = Buffer.from(payload, 'base64')
  // Copy into a fresh, aligned ArrayBuffer: `buffer.buffer` may be a shared pool slice
  // whose byteOffset is odd relative to Int16Array's 2-byte alignment requirement.
  const aligned = new Uint8Array(buffer.length)
  aligned.set(buffer)
  return new Int16Array(aligned.buffer, 0, Math.floor(aligned.length / 2))
}

/** Concatenates PCM16 frames in order into one contiguous frame. */
export function concatPcm16(frames: Int16Array[]): Int16Array {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0)
  const out = new Int16Array(total)
  let offset = 0
  for (const frame of frames) {
    out.set(frame, offset)
    offset += frame.length
  }
  return out
}

/**
 * Linear-interpolation resampler. Identity (a copy) when the rates match, which keeps
 * callers from having to special-case the common case where no resampling is needed.
 */
export function resamplePcm16(frame: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate <= 0 || toRate <= 0) throw new Error(`resamplePcm16: invalid rate ${fromRate} -> ${toRate}`)
  if (fromRate === toRate) return frame.slice()
  if (frame.length === 0) return new Int16Array(0)

  const ratio = fromRate / toRate
  const outLength = Math.max(1, Math.round(frame.length / ratio))
  const out = new Int16Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio
    const srcIndex = Math.floor(srcPos)
    const frac = srcPos - srcIndex
    const a = frame[Math.min(srcIndex, frame.length - 1)] ?? 0
    const b = frame[Math.min(srcIndex + 1, frame.length - 1)] ?? a
    out[i] = Math.round(a + (b - a) * frac)
  }
  return out
}

/** Root-mean-square level of a frame, normalized to 0..1 against the int16 full scale. */
export function rmsLevel(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sumSquares = 0
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i] ?? 0
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / frame.length)
  return rms / 32768
}
