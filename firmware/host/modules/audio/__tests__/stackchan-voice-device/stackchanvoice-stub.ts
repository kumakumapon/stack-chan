import { state } from 'stackchan-voice-test-state'

export default class StackchanVoice {
  static readonly Cute = 1
  static readonly Normal = 0

  #finished = false

  constructor(preset: number, resource: { name: string }) {
    state.constructors.push({ preset, resourceName: resource.name })
  }

  say(text: string, speed: number): void {
    // Record every attempt, including ones about to fail, so tests can see exactly
    // what text each retry was called with.
    const index = state.says.length
    state.says.push({ speed, text })
    if (state.sayFailQueue.shift()) throw new Error(`stub say failure #${index}`)
    this.#finished = false
  }

  koe(koe: string, speed: number): void {
    const index = state.koes.length
    state.koes.push({ koe, speed })
    if (state.koeFailQueue.shift()) throw new Error(`stub koe failure #${index}`)
    this.#finished = false
  }

  read24(buffer: ArrayBuffer): number {
    if (this.#finished) return 0
    const samples = new Int16Array(buffer)
    samples[0] = 1000
    samples[1] = -1000
    this.#finished = true
    return 2
  }
}
