import exchange from 'stackchan-gateway-browser'
import Timer from 'timer'
export default function createMicrophone(onFrame, onError) {
  let timer
  return {
    start() {
      if (timer) return
      exchange({ action: 'mic-start' })
      timer = Timer.repeat(() => {
        try {
          for (let i = 0; i < 8; i++) {
            const result = exchange({ action: 'mic' })
            if (!result?.payload) break
            onFrame(result.payload)
          }
        } catch (error) {
          onError(String(error))
        }
      }, 20)
    },
    stop() {
      if (timer) Timer.clear(timer)
      timer = undefined
      exchange({ action: 'mic-stop' })
    },
  }
}
