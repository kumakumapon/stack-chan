import type { GatewayAudioFormat } from 'stackchan-gateway-protocol'
import type { PCMStream } from './pcm-stream.js'

/**
 * Marks a reply the local speech engine could not pronounce. The Gateway link,
 * the microphone and the session are all unaffected, so the Dock runtime
 * reports it and keeps listening rather than ending the conversation.
 */
export const LOCAL_SPEECH_ERROR_NAME = 'LocalSpeechError'

export function isLocalSpeechError(error: unknown): boolean {
  return error instanceof Error && error.name === LOCAL_SPEECH_ERROR_NAME
}

/**
 * The slice of `StackchanContext` the presentation actually touches. Naming it
 * structurally keeps this file testable against a small fake and documents the
 * capabilities a replacement presentation has to provide.
 */
export type GatewayPresentationContext = {
  showBalloon?(text: string): void
  hideBalloon?(): void
  audio: { say(text: string, volume?: number): Promise<unknown>; tts?: { cancel?(): void } }
}

/**
 * How the robot shows a Gateway conversation.
 *
 * Kept behind an interface so the Dock runtime can be tested without Piu, and
 * so a MOD can replace the presentation without touching transport code.
 */
export type GatewayPresentation = {
  /** Toggles local TTS once `session.ready` says whether the Gateway streams audio. */
  setSpeakLocally(enabled: boolean): void
  onInputTranscript(text: string, final: boolean): void
  onOutputTranscript(text: string, final: boolean): void | Promise<void>
  onAudioStarted(format: GatewayAudioFormat): void
  onAudioChunk(payload: string): void
  onAudioCompleted(): void | Promise<void>
  onAgentError(message: string, fatal: boolean): void
  interrupt?(): void
  close(): void
}

export type GatewayPresentationOptions = {
  /**
   * True when the Gateway said it will not stream assistant audio
   * (`session.ready.features.audioOutput === false`), so the robot speaks the
   * final output transcript with its own TTS instead. This is the Phase 0 path.
   */
  speakLocally: boolean
  createAudio?(format: GatewayAudioFormat): PCMStream
}

export function createGatewayPresentation(
  context: GatewayPresentationContext,
  options: GatewayPresentationOptions,
): GatewayPresentation {
  let stream: PCMStream | undefined
  let generation = 0
  let closed = false
  let speakLocally = options.speakLocally
  const interrupt = () => {
    generation++
    stream?.stop()
    stream = undefined
    context.audio.tts?.cancel?.()
  }

  const showBalloon = (text: string) => {
    if (closed || !text) return
    try {
      context.showBalloon?.(text)
    } catch (error) {
      log(`[gateway-dock] balloon failed: ${errorMessage(error)}\n`)
    }
  }

  return {
    setSpeakLocally(enabled) {
      speakLocally = enabled
    },
    onInputTranscript(text, final) {
      if (final) showBalloon(text)
    },
    async onOutputTranscript(text, final) {
      if (!final) return
      showBalloon(text)
      if (!speakLocally || closed) return
      if (!text.trim()) return
      const current = generation
      // Pronunciation belongs to the selected TTS engine. Never silently remove
      // words or numbers to hide a conversion error.
      const result = await context.audio.say(text)
      if (current !== generation) return
      if (result && typeof result === 'object' && 'success' in result && result.success === false) {
        const failure = new Error('reason' in result ? String(result.reason) : 'Local speech failed')
        failure.name = LOCAL_SPEECH_ERROR_NAME
        throw failure
      }
    },
    onAudioStarted(nextFormat) {
      if (closed) return
      stream?.stop()
      stream = options.createAudio?.(nextFormat)
    },
    onAudioChunk(payload) {
      if (!closed) stream?.push(payload)
    },
    async onAudioCompleted() {
      const pending = stream
      if (closed || !pending) return
      await pending.finish()
      if (stream === pending) stream = undefined
    },
    onAgentError(message, fatal) {
      interrupt()
      showBalloon(fatal ? `Agent stopped: ${message}` : message)
    },
    interrupt,
    close() {
      closed = true
      interrupt()
      try {
        context.hideBalloon?.()
      } catch {
        // The UI may already be torn down.
      }
    },
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
