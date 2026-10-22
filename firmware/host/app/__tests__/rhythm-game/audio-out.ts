// Native Speaker's output boundary; no real audio device is required by the XS test.
export default class AudioOut {
  static Flush = 1
  static Volume = 2
  static Tone = 3
  static Callback = 4
  static RawSamples = 5
  static latest: AudioOut
  sampleRate: number
  closed = 0
  callback: (() => void) | undefined
  constructor(options: { sampleRate: number; streams: number; bitsPerSample?: number; numChannels?: number }) {
    this.sampleRate = options.sampleRate
    AudioOut.latest = this
  }
  enqueue(..._args: unknown[]) {}
  start() {}
  close() {
    this.closed++
  }
}
