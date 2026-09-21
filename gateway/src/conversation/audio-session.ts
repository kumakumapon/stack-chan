/**
 * Media plane for one conversation: microphone frames in, utterances out.
 *
 * Turn detection lives here rather than in the Agent backend so that a
 * text-only LLM and a native-audio Agent see the same conversation shape.
 * Backends that do their own endpointing are served by passing a null STT and
 * forwarding frames directly.
 */

import { decodePcm16Base64 } from '../audio/pcm.ts'
import type { SttAdapter } from '../audio/stt.ts'
import { createEnergyVad } from '../audio/vad.ts'
import type { GatewayAudioFormat } from '../protocol/stackchan-gateway-v1.ts'

/**
 * Bounds an utterance when the microphone noise floor prevents VAD from
 * observing a release. Rather than silently dropping every subsequent frame,
 * submit the bounded recording to STT and begin a fresh turn.
 */
const MAX_UTTERANCE_SECONDS = 3

export type AudioSessionOptions = {
  stt: SttAdapter
  inputFormat: GatewayAudioFormat
  onUtterance(text: string): Promise<void> | void
  onError(message: string): void
  /** Disables energy-based endpointing; `flush()` then delimits utterances. */
  manualTurns?: boolean
  logger?(message: string): void
}

export type AudioSession = {
  pushFrame(payload: string): Promise<void>
  /** Ends the current utterance, transcribing whatever is buffered. */
  flush(): Promise<void>
  reset(): void
}

export function createAudioSession(options: AudioSessionOptions): AudioSession {
  const logger = options.logger ?? (() => {})
  const sampleRate = options.inputFormat.sampleRate
  const maxSamples = MAX_UTTERANCE_SECONDS * sampleRate
  const vad = options.manualTurns ? undefined : createEnergyVad({ sampleRate })
  let generation = 0
  let controller = new AbortController()
  let buffered: Int16Array[] = []
  let bufferedSamples = 0
  let capturing = options.manualTurns === true

  const append = (frame: Int16Array) => {
    buffered.push(frame)
    bufferedSamples += frame.length
  }

  const take = (): Int16Array => {
    const merged = new Int16Array(bufferedSamples)
    let offset = 0
    for (const frame of buffered) {
      merged.set(frame, offset)
      offset += frame.length
    }
    buffered = []
    bufferedSamples = 0
    return merged
  }

  const transcribe = async () => {
    if (bufferedSamples === 0) return
    const utterance = take()
    const current = generation
    let text: string
    try {
      const result = await options.stt.transcribe(utterance, sampleRate, controller.signal)
      text = result.text.trim()
    } catch (error) {
      if (current !== generation) return
      options.onError(error instanceof Error ? error.message : String(error))
      return
    }
    if (!text || current !== generation) return
    await options.onUtterance(text)
  }

  return {
    async pushFrame(payload) {
      let frame: Int16Array
      try {
        frame = decodePcm16Base64(payload)
      } catch (error) {
        logger(`[gateway] dropped an undecodable microphone frame: ${error instanceof Error ? error.message : error}`)
        return
      }
      if (frame.length === 0) return
      // A single oversized frame must not bypass the utterance storage bound.
      if (frame.length > maxSamples) {
        logger('[gateway] dropped a microphone frame larger than the utterance limit')
        return
      }
      if (!vad) {
        if (bufferedSamples + frame.length > maxSamples) {
          const current = generation
          await transcribe()
          if (current !== generation) return
        }
        append(frame)
        return
      }
      const events = vad.push(frame)
      for (const event of events) {
        if (event.type === 'speech.start') capturing = true
      }
      // VAD releases short noise without emitting speech.end. Do not keep
      // capturing silence or carry that noise into the next real utterance.
      if (capturing && !vad.speaking && !events.some((event) => event.type === 'speech.end')) {
        capturing = false
        buffered = []
        bufferedSamples = 0
        return
      }
      if (capturing) {
        if (bufferedSamples + frame.length > maxSamples) {
          logger('[gateway] VAD did not release; transcribing the bounded microphone utterance')
          vad.reset()
          capturing = false
          await transcribe()
          return
        }
        append(frame)
      }
      for (const event of events) {
        if (event.type !== 'speech.end') continue
        capturing = false
        await transcribe()
      }
    },
    async flush() {
      capturing = options.manualTurns === true
      vad?.reset()
      await transcribe()
    },
    reset() {
      generation++
      controller.abort()
      controller = new AbortController()
      buffered = []
      bufferedSamples = 0
      capturing = options.manualTurns === true
      vad?.reset()
    },
  }
}
