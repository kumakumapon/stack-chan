/**
 * Text-to-speech adapters.
 *
 * `createNullTts` is the choice when the device speaks the assistant's text
 * through its own local TTS (the Phase 0 text MVP and any embodiment that
 * prefers on-device voice); the Gateway still wires a `TtsAdapter` in either
 * case so the media pipeline doesn't need an optional branch.
 */

export type TtsChunk = { audio: Int16Array; sampleRate: number }

export type TtsAdapter = {
  readonly name: string
  readonly sampleRate: number
  synthesize(text: string, signal?: AbortSignal): AsyncIterable<TtsChunk>
}

export function createNullTts(sampleRate = 16_000): TtsAdapter {
  return {
    name: 'null',
    sampleRate,
    synthesize(): AsyncIterable<TtsChunk> {
      return emptyAsyncIterable()
    },
  }
}

/** No chunks, ever -- used when the device speaks text through its own local TTS. */
function emptyAsyncIterable(): AsyncIterable<TtsChunk> {
  return {
    [Symbol.asyncIterator]() {
      return { next: () => Promise.resolve<IteratorResult<TtsChunk>>({ done: true, value: undefined }) }
    },
  }
}

const OPENAI_TTS_DEFAULT_MODEL = 'gpt-4o-mini-tts'
const OPENAI_TTS_DEFAULT_VOICE = 'alloy'
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/** OpenAI's `response_format: 'pcm'` is always 24 kHz signed 16-bit little-endian mono. */
const OPENAI_PCM_SAMPLE_RATE = 24_000

export function createOpenAiTts(options: {
  apiKey: string
  model?: string
  voice?: string
  baseUrl?: string
  sampleRate?: number
  fetchImpl?: typeof fetch
}): TtsAdapter {
  const model = options.model ?? OPENAI_TTS_DEFAULT_MODEL
  const voice = options.voice ?? OPENAI_TTS_DEFAULT_VOICE
  const baseUrl = options.baseUrl ?? OPENAI_DEFAULT_BASE_URL
  const sampleRate = options.sampleRate ?? OPENAI_PCM_SAMPLE_RATE
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    name: 'openai',
    sampleRate,
    async *synthesize(text: string, signal?: AbortSignal): AsyncIterable<TtsChunk> {
      const response = await fetchImpl(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice, input: text, response_format: 'pcm' }),
        ...(signal ? { signal } : {}),
      })

      if (!response.ok) {
        throw new Error(`openai tts: ${response.status} ${response.statusText}: ${await safeText(response)}`)
      }
      if (!response.body) throw new Error('openai tts: response has no body')

      // The stream can split mid-sample; carry an odd trailing byte to the next chunk.
      let carry: Uint8Array | undefined
      for await (const raw of iterateBody(response.body)) {
        const bytes = carry ? concatBytes(carry, raw) : raw
        const usable = bytes.length - (bytes.length % 2)
        carry = usable < bytes.length ? bytes.slice(usable) : undefined
        if (usable === 0) continue
        const aligned = new Uint8Array(usable)
        aligned.set(bytes.subarray(0, usable))
        yield { audio: new Int16Array(aligned.buffer), sampleRate }
      }
    },
  }
}

async function* iterateBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<no body>'
  }
}
