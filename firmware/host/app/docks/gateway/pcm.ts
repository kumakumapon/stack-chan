const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function encodePCM(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0
    out +=
      alphabet[a >> 2] +
      alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=')
  }
  return out
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
  #pending: number[] = []
  #frame = new Uint8Array(640)
  #offset = 0
  constructor(
    readonly channels: number,
    readonly send: (frame: Uint8Array) => void,
  ) {
    if (channels !== 1 && channels !== 2) throw new Error('Expected mono or stereo PCM16')
  }
  push(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.#pending.push(byte)
      if (this.#pending.length < this.channels * 2) continue
      let sum = 0
      for (let channel = 0; channel < this.channels; channel++) {
        const bits = this.#pending[channel * 2] | (this.#pending[channel * 2 + 1] << 8)
        sum += bits >= 32768 ? bits - 65536 : bits
      }
      const sample = Math.round(sum / this.channels)
      this.#pending.length = 0
      this.#frame[this.#offset++] = sample & 255
      this.#frame[this.#offset++] = (sample >> 8) & 255
      if (this.#offset === this.#frame.length) {
        this.send(this.#frame.slice())
        this.#offset = 0
      }
    }
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
