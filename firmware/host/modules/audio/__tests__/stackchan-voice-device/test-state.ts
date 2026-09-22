export type StackchanVoiceTestState = {
  audio: {
    bitsPerSample?: number
    channels?: number
    closed: number
    sampleRate?: number
    started: number
    stopped: number
    volume?: number
    writes: number[][]
    writesAreUint8Arrays: boolean[]
  }
  constructors: Array<{ preset: number; resourceName: string }>
  koes: Array<{ koe: string; speed: number }>
  says: Array<{ speed: number; text: string }>
  // Queues consumed one entry per say()/koe() call: `true` makes that call throw
  // (simulating native error 105), `false`/exhausted lets it succeed normally.
  // Every attempt (failing or not) is still recorded into `says`/`koes` above.
  sayFailQueue: boolean[]
  koeFailQueue: boolean[]
}

export const state: StackchanVoiceTestState = {
  audio: {
    closed: 0,
    started: 0,
    stopped: 0,
    writes: [],
    writesAreUint8Arrays: [],
  },
  constructors: [],
  koes: [],
  says: [],
  sayFailQueue: [],
  koeFailQueue: [],
}

export function resetState(): void {
  state.audio = {
    closed: 0,
    started: 0,
    stopped: 0,
    writes: [],
    writesAreUint8Arrays: [],
  }
  state.constructors.length = 0
  state.koes.length = 0
  state.says.length = 0
  state.sayFailQueue.length = 0
  state.koeFailQueue.length = 0
}
