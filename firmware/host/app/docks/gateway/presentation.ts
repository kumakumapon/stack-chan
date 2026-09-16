import type { GatewayAudioFormat } from 'stackchan-gateway-protocol'

/**
 * The slice of `StackchanContext` the presentation actually touches. Naming it
 * structurally keeps this file testable against a small fake and documents the
 * capabilities a replacement presentation has to provide.
 */
export type GatewayPresentationContext = {
  showBalloon?(text: string): void
  hideBalloon?(): void
  audio: { say(text: string, volume?: number): Promise<unknown> }
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
  onOutputTranscript(text: string, final: boolean): void
  onAudioStarted(format: GatewayAudioFormat): void
  onAudioChunk(payload: string): void
  onAudioCompleted(): void
  onAgentError(message: string, fatal: boolean): void
  close(): void
}

export type GatewayPresentationOptions = {
  /**
   * True when the Gateway said it will not stream assistant audio
   * (`session.ready.features.audioOutput === false`), so the robot speaks the
   * final output transcript with its own TTS instead. This is the Phase 0 path.
   */
  speakLocally: boolean
  /** Accumulated base64 PCM frames are played through this when the turn ends. */
  playAudio?(frames: string[], format: GatewayAudioFormat): void
}

export function createGatewayPresentation(
  context: GatewayPresentationContext,
  options: GatewayPresentationOptions,
): GatewayPresentation {
  let frames: string[] = []
  let format: GatewayAudioFormat | undefined
  let closed = false
  let speakLocally = options.speakLocally

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
    onOutputTranscript(text, final) {
      if (!final) return
      showBalloon(text)
      if (!speakLocally || closed) return
      try {
        void context.audio.say(text)
      } catch (error) {
        log(`[gateway-dock] local TTS failed: ${errorMessage(error)}\n`)
      }
    },
    onAudioStarted(nextFormat) {
      frames = []
      format = nextFormat
    },
    onAudioChunk(payload) {
      // The turn is buffered rather than streamed: Piu has no PCM sink that can
      // be fed frame by frame, and playAudio() wants one contiguous buffer.
      // Latency is one assistant turn; streaming needs an audio worker.
      frames.push(payload)
    },
    onAudioCompleted() {
      const pending = frames
      const pendingFormat = format
      frames = []
      format = undefined
      if (closed || pending.length === 0 || !pendingFormat || !options.playAudio) return
      try {
        options.playAudio(pending, pendingFormat)
      } catch (error) {
        log(`[gateway-dock] audio playback failed: ${errorMessage(error)}\n`)
      }
    },
    onAgentError(message, fatal) {
      showBalloon(fatal ? `Agent stopped: ${message}` : message)
    },
    close() {
      closed = true
      frames = []
      format = undefined
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
