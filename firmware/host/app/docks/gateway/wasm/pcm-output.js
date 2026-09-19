import exchange from 'stackchan-gateway-browser'
import { encodePCM } from 'stackchan-gateway-pcm'
import { createPCMStream } from 'stackchan-gateway-pcm-stream'
import Timer from 'timer'

export default function createOutput(format) {
  return createPCMStream(format, (played) => {
    const id = exchange({ action: 'pcm-open', sampleRate: format.sampleRate })
    const timer = Timer.repeat(() => {
      const count = exchange({ action: 'pcm-played', id })
      for (let i = 0; i < count; i++) played()
    }, 10)
    return {
      write(bytes) {
        exchange({ action: 'pcm-write', id, payload: encodePCM(bytes) })
      },
      close() {
        Timer.clear(timer)
        exchange({ action: 'pcm-close', id })
      },
    }
  })
}
