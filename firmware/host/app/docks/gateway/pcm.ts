const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function encodePCM(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64
  if (typeof native === 'function') return native.call(bytes)
  // Compatibility path for engines without the native encoder. Join once
  // instead of repeatedly copying an ever-growing string.
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0
    out.push(
      alphabet[a >> 2] +
        alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
        (i + 2 < bytes.length ? alphabet[c & 63] : '='),
    )
  }
  return out.join('')
}
export function decodePCM(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error('Invalid PCM base64')
  const length = (value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0)
  const bytes = new Uint8Array(length)
  let at = 0
  for (let i = 0; i < value.length; i += 4) {
    const bits =
      (alphabet.indexOf(value[i]) << 18) |
      (alphabet.indexOf(value[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(value[i + 2])) << 6) |
      Math.max(0, alphabet.indexOf(value[i + 3]))
    if (at < length) bytes[at++] = bits >> 16
    if (at < length) bytes[at++] = bits >> 8
    if (at < length) bytes[at++] = bits
  }
  return bytes
}
/** Keeps only one 20ms mono frame and an incomplete native sample. */
export class PCMFramer {
  #pending = new Uint8Array(4)
  #pendingLength = 0
  #frame = new Uint8Array(640)
  #offset = 0
  constructor(
    readonly channels: number,
    readonly send: (frame: Uint8Array) => void,
  ) {
    if (channels !== 1 && channels !== 2) throw new Error('Expected mono or stereo PCM16')
  }
  push(bytes: Uint8Array): void {
    let at = 0
    if (this.channels === 1) {
      // Mono needs no per-sample conversion; preserve even odd-byte splits.
      while (at < bytes.length) {
        const count = Math.min(this.#frame.length - this.#offset, bytes.length - at)
        this.#frame.set(bytes.subarray(at, at + count), this.#offset)
        this.#offset += count
        at += count
        if (this.#offset === this.#frame.length) this.#emit()
      }
      return
    }
    if (this.#pendingLength) {
      while (at < bytes.length && this.#pendingLength < 4) this.#pending[this.#pendingLength++] = bytes[at++]
      if (this.#pendingLength < 4) return
      this.#stereoSample(this.#pending, 0)
      this.#pendingLength = 0
    }
    for (; at + 4 <= bytes.length; at += 4) this.#stereoSample(bytes, at)
    while (at < bytes.length) this.#pending[this.#pendingLength++] = bytes[at++]
  }
  #stereoSample(bytes: Uint8Array, at: number): void {
    const left = ((bytes[at] | (bytes[at + 1] << 8)) << 16) >> 16
    const right = ((bytes[at + 2] | (bytes[at + 3] << 8)) << 16) >> 16
    const sample = Math.round((left + right) / 2)
    this.#frame[this.#offset++] = sample & 255
    this.#frame[this.#offset++] = (sample >> 8) & 255
    if (this.#offset === this.#frame.length) this.#emit()
  }
  #emit(): void {
    const frame = this.#frame
    // Transfer the filled frame instead of allocating and copying it.
    this.#frame = new Uint8Array(640)
    this.#offset = 0
    this.send(frame)
  }
}
export function pcmWave(frames: string[], sampleRate: number, channels: number): ArrayBuffer {
  if (sampleRate !== 16000 || channels !== 1) throw new Error('Unsupported Gateway audio format')
  const chunks = frames.map(decodePCM)
  const length = chunks.reduce((size, chunk) => size + chunk.length, 0)
  if (length % 2) throw new Error('Incomplete PCM16 sample')
  const result = new ArrayBuffer(44 + length)
  const bytes = new Uint8Array(result)
  const view = new DataView(result)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  text(8, 'WAVE')
  text(12, 'fmt ')
  text(36, 'data')
  view.setUint32(4, length + 36, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(40, length, true)
  let offset = 44
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
