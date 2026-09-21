import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { TtsAdapter } from './tts.ts'

/**
 * The complete Windows synthesis is already available before it is yielded.
 * Larger packets keep the CoreS3 from spending most of its time parsing and
 * base64-decoding fifty tiny WebSocket messages per second.
 */
const OUTPUT_PACKET_BYTES = 4096

/** Offline Japanese TTS. Text travels via stdin, never shell interpolation. */
export function createWindowsTts(): TtsAdapter {
  return {
    name: 'windows',
    sampleRate: 16000,
    async *synthesize(text, signal) {
      const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
      const pcm = await new Promise<Buffer>((resolve, reject) => {
        const script = fileURLToPath(new URL('../../scripts/windows-speech.ps1', import.meta.url))
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], {
          windowsHide: true,
          signal: bounded,
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        const chunks: Buffer[] = []
        let size = 0
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 12 * 1024 * 1024) child.kill()
          else chunks.push(chunk)
        })
        child.on('error', () => reject(new Error('Windows speech failed')))
        child.stdin.on('error', () => reject(new Error('Windows speech input failed')))
        child.on('close', (code) =>
          code === 0 && size <= 12 * 1024 * 1024
            ? resolve(Buffer.from(Buffer.concat(chunks).toString('ascii'), 'base64'))
            : reject(new Error('Windows speech failed')),
        )
        child.stdin.end(text)
      })
      for (let offset = 0; offset + 1 < pcm.length; offset += OUTPUT_PACKET_BYTES) {
        bounded.throwIfAborted()
        const audio = new Int16Array(Math.min(OUTPUT_PACKET_BYTES, pcm.length - (pcm.length % 2) - offset) / 2)
        for (let i = 0; i < audio.length; i++) audio[i] = pcm.readInt16LE(offset + i * 2)
        yield { audio, sampleRate: 16000 }
      }
    },
  }
}
