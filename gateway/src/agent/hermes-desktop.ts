import { spawn } from 'node:child_process'
import { WebSocket } from 'ws'
import { encodeWav, type SttAdapter } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import type { AgentBackend } from './agent-backend.ts'

/** Desktop's supported loopback handshake; credentials never leave this host. */
export function createHermesDesktopClient(origin: string) {
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username ||
    url.password ||
    url.search ||
    url.pathname !== '/'
  )
    throw new Error('Hermes Desktop must use http://127.0.0.1:PORT/')
  async function token(signal?: AbortSignal) {
    const response = await fetch(url, { signal: signal ?? null, redirect: 'error' })
    if (!response.ok) throw new Error(`Hermes handshake HTTP ${response.status}`)
    const match = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("[^"\r\n]+")/.exec(await response.text())
    if (!match) throw new Error('Hermes local desktop handshake unavailable')
    return JSON.parse(match[1] ?? 'null') as string
  }
  return {
    async rpc(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
      const credential = await token(signal)
      signal.throwIfAborted()
      const endpoint = new URL('/api/ws', url)
      endpoint.protocol = 'ws:'
      endpoint.searchParams.set('token', credential)
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(endpoint, { handshakeTimeout: 10_000, maxPayload: 2 ** 20 })
        let settled = false
        const finish = (error?: Error, result?: Record<string, unknown>) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          socket.terminate()
          if (error) reject(error)
          else resolve(result ?? {})
        }
        const abort = () => finish(new Error('Hermes request cancelled'))
        const timer = setTimeout(() => finish(new Error('Hermes request timed out')), 120_000)
        signal.addEventListener('abort', abort, { once: true })
        socket.on('error', () => finish(new Error('Hermes WebSocket connection failed')))
        socket.on('close', () => finish(new Error('Hermes WebSocket closed before reply')))
        socket.on('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })))
        socket.on('message', (data) => {
          try {
            for (const line of data.toString().split('\n').filter(Boolean)) {
              const frame = JSON.parse(line)
              if (frame.id !== 1) continue
              if (frame.error) finish(new Error(`Hermes RPC failed (${frame.error.code ?? 'unknown'})`))
              else finish(undefined, frame.result)
            }
          } catch {
            finish(new Error('Invalid Hermes RPC response'))
          }
        })
        if (signal.aborted) abort()
      })
    },
    async post(path: string, body: unknown, signal: AbortSignal) {
      const credential = await token(signal)
      const response = await fetch(new URL(path, url), {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'Content-Type': 'application/json', 'X-Hermes-Session-Token': credential },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(`Hermes audio HTTP ${response.status}`)
      return (await response.json()) as Record<string, unknown>
    },
  }
}

type DesktopClient = ReturnType<typeof createHermesDesktopClient>

/** Tool-free turns: never invokes the desktop's agent, shell, MCP or delegation. */
export function createHermesDesktopBackend(client: Pick<DesktopClient, 'rpc'>): AgentBackend {
  return {
    name: 'hermes-desktop',
    producesAudio: false,
    async createSession(options) {
      let history: Array<{ role: string; content: string }> = []
      let active: AbortController | undefined
      let closed = false
      return {
        async inputText(text) {
          if (closed || options.signal?.aborted) return
          active?.abort()
          const turn = new AbortController()
          active = turn
          const signal = options.signal ? AbortSignal.any([turn.signal, options.signal]) : turn.signal
          try {
            const result = await client.rpc(
              'llm.oneshot',
              {
                instructions:
                  options.instructions ?? 'あなたは小さな卓上ロボットです。日本語で短く親しみやすく答えてください。',
                input: JSON.stringify([...history, { role: 'user', content: text.slice(0, 8000) }]),
                max_tokens: 512,
              },
              signal,
            )
            if (closed || signal.aborted || active !== turn) return
            if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('Hermes returned no text')
            history = [
              ...history,
              { role: 'user', content: text.slice(0, 8000) },
              { role: 'assistant', content: result.text.slice(0, 8000) },
            ].slice(-12)
            options.onEvent({ type: 'text', text: result.text, final: true })
            options.onEvent({ type: 'turn.done' })
          } catch {
            if (!closed && !signal.aborted && active === turn) {
              options.onEvent({
                type: 'error',
                code: 'agentUnavailable',
                message: 'Hermes Desktop request failed; check its connection and provider.',
                fatal: false,
              })
              options.onEvent({ type: 'turn.done' })
            }
          }
        },
        async inputAudio() {},
        async toolResult() {},
        async cancel() {
          active?.abort()
        },
        async close() {
          closed = true
          active?.abort()
          history = []
        },
      }
    },
  }
}

export function createHermesDesktopStt(client: Pick<DesktopClient, 'post'>): SttAdapter {
  return {
    name: 'hermes-desktop',
    async transcribe(audio, sampleRate, signal) {
      const result = await client.post(
        '/api/audio/transcribe',
        {
          data_url: `data:audio/wav;base64,${Buffer.from(encodeWav(audio, sampleRate)).toString('base64')}`,
          mime_type: 'audio/wav',
        },
        signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      )
      if (typeof result.transcript !== 'string') throw new Error('Hermes returned no transcript')
      return { text: result.transcript, final: true }
    },
  }
}

export function createHermesDesktopTts(client: Pick<DesktopClient, 'post'>, ffmpeg = 'ffmpeg'): TtsAdapter {
  return {
    name: 'hermes-desktop',
    sampleRate: 16_000,
    async *synthesize(text, signal) {
      const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
      const result = await client.post('/api/audio/speak', { text }, bounded)
      if (typeof result.data_url !== 'string' || !/^data:audio\/[\w.+-]+;base64,/.test(result.data_url))
        throw new Error('Hermes returned no audio')
      const encoded = result.data_url.slice(result.data_url.indexOf(',') + 1)
      if (encoded.length > 16 * 1024 * 1024) throw new Error('Hermes audio too large')
      const pcm = await new Promise<Buffer>((resolve, reject) => {
        const child = spawn(
          ffmpeg,
          ['-v', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1'],
          { windowsHide: true, signal: bounded, stdio: ['pipe', 'pipe', 'ignore'] },
        )
        const chunks: Buffer[] = []
        let size = 0
        child.stdout.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 8 * 1024 * 1024) child.kill()
          else chunks.push(chunk)
        })
        child.on('error', () => reject(new Error('Audio conversion failed')))
        child.stdin.on('error', () => reject(new Error('Audio conversion input failed')))
        child.on('close', (code) =>
          code === 0 && size <= 8 * 1024 * 1024
            ? resolve(Buffer.concat(chunks))
            : reject(new Error('Audio conversion failed')),
        )
        child.stdin.end(Buffer.from(encoded, 'base64'))
      })
      for (let offset = 0; offset + 1 < pcm.length; offset += 640) {
        bounded.throwIfAborted()
        const end = Math.min(offset + 640, pcm.length - (pcm.length % 2))
        const audio = new Int16Array((end - offset) / 2)
        for (let i = 0; i < audio.length; i++) audio[i] = pcm.readInt16LE(offset + i * 2)
        yield { audio, sampleRate: 16_000 }
      }
    },
  }
}
