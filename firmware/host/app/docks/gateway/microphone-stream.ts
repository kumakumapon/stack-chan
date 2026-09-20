import AudioIn from 'audio-in'
import { Label, Skin, Style } from 'piu/MC'
import { encodePCM, PCMFramer } from 'stackchan-gateway-pcm'
import Time from 'time'
import Timer from 'timer'
export default function createMicrophone(onFrame: (payload: string) => void, onError: (message: string) => void) {
  let input: AudioIn | undefined
  let diagnosticTimer: ReturnType<typeof Timer.repeat> | undefined
  let diagnosticLabels: Label[] = []
  const clearDiagnostic = () => {
    if (diagnosticTimer !== undefined) Timer.clear(diagnosticTimer)
    diagnosticTimer = undefined
    for (const label of diagnosticLabels) label.container?.remove(label)
    diagnosticLabels = []
  }
  return {
    start() {
      if (input) return
      try {
        let framer: PCMFramer | undefined
        let callbacks = 0
        let frames = 0
        let maxProcessingMs = 0
        let maxReadMs = 0
        let maxFrameMs = 0
        let maxEncodeMs = 0
        let maxSendMs = 0
        let encodeMs = 0
        let sendMs = 0
        const startedAt = Time.ticks
        const next = new AudioIn({
          onReadable(size: number) {
            if (!input) return
            callbacks++
            const begin = Time.ticks
            const chunk = this.read(size)
            const readEnd = Time.ticks
            encodeMs = 0
            sendMs = 0
            if (chunk) framer?.push(new Uint8Array(chunk))
            const end = Time.ticks
            maxReadMs = Math.max(maxReadMs, readEnd - begin)
            maxFrameMs = Math.max(maxFrameMs, Math.max(0, end - readEnd - encodeMs - sendMs))
            maxEncodeMs = Math.max(maxEncodeMs, encodeMs)
            maxSendMs = Math.max(maxSendMs, sendMs)
            maxProcessingMs = Math.max(maxProcessingMs, end - begin)
          },
        })
        if (next.sampleRate !== 16000 || next.bitsPerSample !== 16) {
          next.close()
          throw new Error('Expected 16kHz PCM16 microphone')
        }
        input = next
        framer = new PCMFramer(next.channels, (bytes) => {
          frames++
          const begin = Time.ticks
          const payload = encodePCM(bytes)
          const encodedAt = Time.ticks
          onFrame(payload)
          const sentAt = Time.ticks
          encodeMs += encodedAt - begin
          sendMs += sentAt - encodedAt
        })
        // Temporary physical-device diagnostics: counters only, no audio content.
        // Maxima are per readable callback, not necessarily the same callback.
        // FRAME excludes nested base64 encoding and synchronous send time.
        const application = (globalThis as unknown as { application?: { add(label: Label): void } }).application
        if (application) {
          const style = new Style({ font: 'k8x12-24', color: 'black', horizontal: 'left' })
          const skin = new Skin({ fill: 'white' })
          for (let row = 0; row < 6; row++) {
            const label = new Label(null, {
              left: 4,
              right: 4,
              top: 58 + row * 28,
              height: 28,
              style,
              skin,
              string: row === 0 ? 'Mic starting' : '',
            })
            diagnosticLabels.push(label)
            application.add(label)
          }
          diagnosticTimer = Timer.repeat(() => {
            const lines = [
              `${Math.floor((Time.ticks - startedAt) / 1000)}s C${callbacks} F${frames}`,
              `READ   ${maxReadMs}ms`,
              `FRAME  ${maxFrameMs}ms`,
              `BASE64 ${maxEncodeMs}ms`,
              `SEND   ${maxSendMs}ms`,
              `TOTAL  ${maxProcessingMs}ms`,
            ]
            for (let row = 0; row < diagnosticLabels.length; row++) diagnosticLabels[row].string = lines[row]
          }, 1000)
        }
        next.start()
      } catch (error) {
        clearDiagnostic()
        input?.close()
        input = undefined
        onError(String(error))
      }
    },
    stop() {
      clearDiagnostic()
      const previous = input
      input = undefined
      previous?.close()
    },
  }
}
