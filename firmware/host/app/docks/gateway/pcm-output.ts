import AudioOut from 'pins/audioout'
import type { GatewayAudioFormat } from 'stackchan-gateway-protocol'
import { createPCMStream } from './pcm-stream.js'

export default function createOutput(format: GatewayAudioFormat) {
  return createPCMStream(format, (played) => {
    const audio = new AudioOut({ streams: 1, sampleRate: format.sampleRate, numChannels: 1, bitsPerSample: 16 })
    const retained: SharedArrayBuffer[] = []
    audio.callback = () => {
      retained.shift()
      played()
    }
    audio.enqueue(0, AudioOut.Volume, 128)
    audio.start()
    return {
      write(bytes) {
        const buffer = new SharedArrayBuffer(bytes.length)
        new Uint8Array(buffer).set(bytes)
        retained.push(buffer)
        audio.enqueue(0, AudioOut.RawSamples, buffer as unknown as HostBuffer)
        audio.enqueue(0, AudioOut.Callback, 0)
      },
      close() {
        audio.close()
        retained.length = 0
      },
    }
  })
}
