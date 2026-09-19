import AudioIn from 'audio-in'
import { encodePCM, PCMFramer } from 'stackchan-gateway-pcm'
export default function createMicrophone(onFrame: (payload: string) => void, onError: (message: string) => void) {
  let input: AudioIn | undefined
  return {
    start() {
      if (input) return
      try {
        let framer: PCMFramer | undefined
        const next = new AudioIn({
          onReadable(size: number) {
            if (!input) return
            const chunk = this.read(size)
            if (chunk) framer?.push(new Uint8Array(chunk))
          },
        })
        if (next.sampleRate !== 16000 || next.bitsPerSample !== 16) {
          next.close()
          throw new Error('Expected 16kHz PCM16 microphone')
        }
        input = next
        framer = new PCMFramer(next.channels, (bytes) => onFrame(encodePCM(bytes)))
        next.start()
      } catch (error) {
        input?.close()
        input = undefined
        onError(String(error))
      }
    },
    stop() {
      const previous = input
      input = undefined
      previous?.close()
    },
  }
}
