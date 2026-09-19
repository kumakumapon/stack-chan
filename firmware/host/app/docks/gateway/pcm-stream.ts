import { decodePCM } from 'stackchan-gateway-pcm'
import type { GatewayAudioFormat } from 'stackchan-gateway-protocol'

export type PCMOutput = {
  write(bytes: Uint8Array): void
  close(): void
}
export type PCMStream = {
  push(payload: string): void
  finish(): Promise<void>
  stop(): void
}

/** Piu-independent bounded queue. Completion means the output consumed every frame. */
export function createPCMStream(format: GatewayAudioFormat, open: (played: () => void) => PCMOutput): PCMStream {
  if (format.codec !== 'pcm16' || format.sampleRate !== 16000 || format.channels !== 1)
    throw new Error('Unsupported Gateway audio format')
  const queue: Uint8Array[] = []
  let queuedBytes = 0,
    inFlight = 0,
    ended = false,
    stopped = false
  let resolveDone: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  let output: PCMOutput | undefined
  const stop = () => {
    if (stopped) return
    stopped = true
    queue.length = 0
    queuedBytes = 0
    try {
      output?.close()
    } finally {
      resolveDone?.()
    }
  }
  const pump = () => {
    if (stopped) return
    // Three raw-buffer/callback pairs fit the native eight-entry audio queue.
    while (inFlight < 3 && inFlight < queue.length) {
      const bytes = queue[inFlight++]
      output?.write(bytes)
    }
    if (ended && queue.length === 0) stop()
  }
  output = open(() => {
    if (stopped) return
    const bytes = queue.shift()
    if (!bytes) return
    queuedBytes -= bytes.byteLength
    inFlight--
    pump()
  })
  return {
    push(payload) {
      if (stopped || ended) return
      try {
        // Reject before allocating a decoded copy.
        if (payload.length > 87384) throw new Error('Gateway audio queue overflow')
        const bytes = decodePCM(payload)
        if (bytes.length % 2) throw new Error('Incomplete PCM16 sample')
        if (queuedBytes + bytes.length > 65536) throw new Error('Gateway audio queue overflow')
        for (let offset = 0; offset < bytes.length; offset += 2048) queue.push(bytes.slice(offset, offset + 2048))
        queuedBytes += bytes.length
        pump()
      } catch (error) {
        stop()
        throw error
      }
    },
    finish() {
      ended = true
      pump()
      return done
    },
    stop,
  }
}
