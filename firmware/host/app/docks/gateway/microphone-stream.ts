import AudioIn from 'audio-in'
import { readMicrophone } from 'stackchan-gateway-microphone-read'
import { encodePCM, PCMFramer } from 'stackchan-gateway-pcm'
export default function createMicrophone(onFrame: (payload: string) => void, onError: (message: string) => void) {
  let input: AudioIn | undefined
  // AudioIn accepts a writable buffer and returns the number of bytes read.
  // Keep storage across turns instead of allocating an ArrayBuffer per read.
  const readBuffer = new Uint8Array(640)
  return {
    start() {
      if (input) return
      try {
        let framer: PCMFramer | undefined
        const next = new AudioIn({
          channels: 1,
          onReadable(size: number) {
            if (input !== this) return
            let stage = 'read'
            try {
              // Bound each read and stop immediately if backpressure closes us.
              let remaining = size & ~1
              while (remaining > 0 && input === this) {
                stage = 'read'
                const bytes = readMicrophone(
                  this as unknown as { read(buffer: Uint8Array): number | undefined },
                  readBuffer,
                  remaining,
                )
                if (!bytes) break
                remaining -= bytes.byteLength
                stage = 'frame/send'
                framer?.push(bytes)
              }
            } catch (error) {
              const previous = input
              input = undefined
              try {
                previous?.close()
              } finally {
                onError(`Mic ${stage}: ${String(error)}`)
              }
            }
          },
        })
        if (next.sampleRate !== 16000 || next.bitsPerSample !== 16 || next.channels !== 1) {
          next.close()
          throw new Error('Expected 16kHz mono PCM16 microphone')
        }
        input = next
        // 40 ms frames halve WebSocket message churn without changing PCM16 audio.
        framer = new PCMFramer(
          next.channels,
          (bytes) => {
            onFrame(encodePCM(bytes))
          },
          1280,
        )
        next.start()
      } catch (error) {
        input?.close()
        input = undefined
        onError(`Mic start: ${String(error)}`)
      }
    },
    stop() {
      const previous = input
      input = undefined
      previous?.close()
    },
  }
}
