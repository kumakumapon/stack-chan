import { encodeWav, type SttAdapter } from './stt.ts'
import type { TtsAdapter, TtsChunk } from './tts.ts'

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(60000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export function createLocalWhisperStt(endpoint: () => string, fetchImpl: typeof fetch = fetch): SttAdapter {
  return {
    name: 'local-whisper',
    async transcribe(audio, sampleRate, signal) {
      const response = await fetchImpl(`${endpoint()}/transcribe`, {
        method: 'POST',
        redirect: 'error',
        signal: requestSignal(signal),
        headers: { 'content-type': 'audio/wav' },
        body: new Uint8Array(encodeWav(audio, sampleRate)),
      })
      if (!response.ok)
        throw new Error(`ローカル音声認識に失敗しました (${response.status})。音声セットアップを確認してください`)
      const data = (await response.json()) as { text?: unknown }
      if (typeof data.text !== 'string' || data.text.length > 4000) throw new Error('音声認識の返答形式が不正です')
      return { text: data.text, final: true }
    },
  }
}

/** RIFF chunks may contain padding, metadata, or an extended fmt header. */
export function decodeWav(bytes: Uint8Array): TtsChunk {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
  if (bytes.length < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE')
    throw new Error('音声がWAV形式ではありません')
  let sampleRate = 0
  let channels = 0
  let pcm: Uint8Array | undefined
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const id = ascii(offset, 4)
    const size = data.getUint32(offset + 4, true)
    const start = offset + 8
    if (start + size > bytes.length) throw new Error('WAV音声が途中で切れています')
    if (id === 'fmt ') {
      if (size < 16 || data.getUint16(start, true) !== 1 || data.getUint16(start + 14, true) !== 16)
        throw new Error('音声はPCM16形式である必要があります')
      channels = data.getUint16(start + 2, true)
      sampleRate = data.getUint32(start + 4, true)
    } else if (id === 'data') pcm = bytes.subarray(start, start + size)
    offset = start + size + (size % 2)
  }
  if (!pcm || ![1, 2].includes(channels) || sampleRate < 8000 || sampleRate > 96000 || pcm.length % (channels * 2))
    throw new Error('WAV音声の形式が不正です')
  const samples = new Int16Array(pcm.length / (channels * 2))
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  for (let index = 0; index < samples.length; index++) {
    let sum = 0
    for (let channel = 0; channel < channels; channel++) sum += view.getInt16((index * channels + channel) * 2, true)
    samples[index] = Math.round(sum / channels)
  }
  return { audio: samples, sampleRate }
}

export function createVoicevoxTts(
  settings: () => { endpoint: string; speakerId: number },
  fetchImpl: typeof fetch = fetch,
): TtsAdapter {
  return {
    name: 'voicevox',
    sampleRate: 24000,
    async *synthesize(text, signal) {
      const { endpoint, speakerId } = settings()
      const bounded = requestSignal(signal)
      const query = await fetchImpl(
        `${endpoint}/audio_query?${new URLSearchParams({ text, speaker: String(speakerId) })}`,
        { method: 'POST', signal: bounded, redirect: 'error' },
      )
      if (!query.ok) throw new Error(`VOICEVOXに接続できません (${query.status})。エンジンと話者を確認してください`)
      const parameters = (await query.json()) as Record<string, unknown>
      parameters.outputSamplingRate = 24000
      parameters.outputStereo = false
      const response = await fetchImpl(`${endpoint}/synthesis?speaker=${speakerId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parameters),
        signal: bounded,
        redirect: 'error',
      })
      if (!response.ok) throw new Error(`VOICEVOXの音声合成に失敗しました (${response.status})`)
      if (Number(response.headers.get('content-length')) > 16 * 1024 * 1024)
        throw new Error('合成音声が上限を超えました')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 16 * 1024 * 1024) throw new Error('合成音声が上限を超えました')
      const chunk = decodeWav(bytes)
      for (let offset = 0; offset < chunk.audio.length; offset += chunk.sampleRate / 5) {
        signal?.throwIfAborted()
        yield { audio: chunk.audio.slice(offset, offset + chunk.sampleRate / 5), sampleRate: chunk.sampleRate }
      }
    },
  }
}
