/**
 * Speech-to-text adapters.
 *
 * `SttAdapter` is intentionally tiny: the Gateway owns VAD and buffering, an
 * adapter just turns a finished utterance into text. `createNullStt` is the
 * choice when the Agent backend transcribes on its own (e.g. a realtime
 * OpenAI Agent session); the Gateway still needs an adapter object to wire
 * into the pipeline, so this avoids optionality spreading everywhere else.
 */

export type SttResult = { text: string; final: boolean }

export type SttAdapter = {
  readonly name: string
  transcribe(audio: Int16Array, sampleRate: number, signal?: AbortSignal): Promise<SttResult>
}

export function createNullStt(): SttAdapter {
  return {
    name: 'null',
    async transcribe(): Promise<SttResult> {
      return { text: '', final: true }
    },
  }
}

const OPENAI_STT_DEFAULT_MODEL = 'whisper-1'
const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export function createOpenAiStt(options: {
  apiKey: string
  model?: string
  baseUrl?: string
  language?: string
  fetchImpl?: typeof fetch
}): SttAdapter {
  const model = options.model ?? OPENAI_STT_DEFAULT_MODEL
  const baseUrl = options.baseUrl ?? OPENAI_DEFAULT_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    name: 'openai',
    async transcribe(audio: Int16Array, sampleRate: number, signal?: AbortSignal): Promise<SttResult> {
      const wav = encodeWav(audio, sampleRate)
      const form = new FormData()
      form.set('model', model)
      if (options.language) form.set('language', options.language)
      form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'utterance.wav')

      const response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
        ...(signal ? { signal } : {}),
      })

      if (!response.ok) {
        throw new Error(`openai stt: ${response.status} ${response.statusText}: ${await safeText(response)}`)
      }

      const body = (await response.json()) as { text?: unknown }
      if (typeof body.text !== 'string') throw new Error('openai stt: response missing "text"')
      return { text: body.text, final: true }
    },
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<no body>'
  }
}

const WAV_HEADER_BYTES = 44
const BITS_PER_SAMPLE = 16
const CHANNELS = 1

/** Wraps raw PCM16 mono samples in a minimal 44-byte-header WAV/RIFF container. */
export function encodeWav(audio: Int16Array, sampleRate: number): Uint8Array {
  const dataSize = audio.length * 2
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, CHANNELS, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8), true) // byte rate
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true) // block align
  view.setUint16(34, BITS_PER_SAMPLE, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < audio.length; i++) {
    view.setInt16(WAV_HEADER_BYTES + i * 2, audio[i] ?? 0, true)
  }

  return new Uint8Array(buffer)
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}
