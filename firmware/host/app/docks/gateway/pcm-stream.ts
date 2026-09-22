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

// One queue entry is at most 2048 bytes = 1024 PCM16 samples = 64ms at 16kHz mono.
// Waiting for three of them (~192ms) before the first output.write() gives the
// sender's own jitter somewhere to land without the first reply being heard as
// choppy. It only guards the very start of playback; see `started` below.
const PREBUFFER_CHUNKS = 3
// Total bytes the queue may hold across in-flight and not-yet-sent chunks
// (~2.05s at 16kHz mono PCM16). Kept small so a stalled response cannot grow
// memory usage without bound.
const QUEUE_CAPACITY_BYTES = 65536

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}

/** Piu-independent bounded queue. Completion means the output consumed every frame. */
export function createPCMStream(format: GatewayAudioFormat, open: (played: () => void) => PCMOutput): PCMStream {
  if (format.codec !== 'pcm16' || format.sampleRate !== 16000 || format.channels !== 1)
    throw new Error('Unsupported Gateway audio format')
  const queue: Uint8Array[] = []
  let queuedBytes = 0,
    inFlight = 0,
    ended = false,
    stopped = false,
    started = false
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
    if (!started) {
      // Keep buffering until the prebuffer threshold is reached, unless the
      // reply is already fully queued (finish() was called): a short reply
      // must never be stuck waiting for chunks that will never arrive.
      if (queue.length < PREBUFFER_CHUNKS && !ended) return
      started = true
    }
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
  // Drops the oldest not-yet-sent chunks (index inFlight onward; the first
  // `inFlight` entries are already handed to output.write() and must never be
  // touched) until `needed` more bytes fit under the cap, or nothing is left
  // to evict. `inFlight` itself never changes here.
  const makeRoom = (needed: number): boolean => {
    let dropped = 0
    while (queuedBytes + needed > QUEUE_CAPACITY_BYTES && queue.length > inFlight) {
      const evicted = queue.splice(inFlight, 1)[0]
      queuedBytes -= evicted.byteLength
      dropped++
    }
    if (dropped > 0) log('[pcm-stream] dropped stale queued audio to stay under the queue byte cap\n')
    return queuedBytes + needed <= QUEUE_CAPACITY_BYTES
  }
  return {
    push(payload) {
      if (stopped || ended) return
      try {
        // Reject before allocating a decoded copy.
        if (payload.length > 87384) throw new Error('Gateway audio queue overflow')
        const bytes = decodePCM(payload)
        if (bytes.length % 2) throw new Error('Incomplete PCM16 sample')
        if (!makeRoom(bytes.length)) throw new Error('Gateway audio queue overflow')
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
