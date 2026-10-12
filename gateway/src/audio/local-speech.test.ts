import assert from 'node:assert/strict'
import test from 'node:test'
import { createLocalWhisperStt, createVoicevoxTts, decodeWav } from './local-speech.ts'
import { encodeWav } from './stt.ts'

test('local recognition sends a bounded PCM WAV and passes cancellation to the local request', async () => {
  const controller = new AbortController()
  const adapter = createLocalWhisperStt(() => 'http://127.0.0.1:8767', (async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8767/transcribe')
    assert.deepEqual([...decodeWav(options?.body as Uint8Array).audio], [10, -10])
    assert.equal(options?.redirect, 'error')
    assert.equal(options?.signal?.aborted, false)
    return new Response(JSON.stringify({ text: 'こんにちは' }))
  }) as typeof fetch)
  assert.deepEqual(await adapter.transcribe(new Int16Array([10, -10]), 16000, controller.signal), {
    text: 'こんにちは',
    final: true,
  })
})

test('VOICEVOX query and synthesis produce actual PCM for the existing playback pipeline', async () => {
  const samples = new Int16Array([200, -200, 100])
  const calls: string[] = []
  const adapter = createVoicevoxTts(() => ({ endpoint: 'http://127.0.0.1:50021', speakerId: 3 }), (async (
    url,
    options,
  ) => {
    calls.push(String(url))
    if (String(url).includes('audio_query')) return new Response(JSON.stringify({ speedScale: 1 }))
    const query = JSON.parse(String(options?.body))
    assert.equal(query.outputStereo, false)
    return new Response(encodeWav(samples, query.outputSamplingRate))
  }) as typeof fetch)
  const output: number[] = []
  for await (const chunk of adapter.synthesize('こんにちは。')) {
    assert.equal(chunk.sampleRate, 24000)
    output.push(...chunk.audio)
  }
  assert.deepEqual(output, [...samples])
  assert.equal(calls.length, 2)
})

test('WAV decoder accepts metadata chunks and rejects unsupported or truncated audio', () => {
  const wav = encodeWav(new Int16Array([100, -100]), 16000)
  const extended = new Uint8Array(wav.length + 10)
  extended.set(wav.subarray(0, 12))
  extended.set([74, 85, 78, 75, 1, 0, 0, 0, 0, 0], 12)
  extended.set(wav.subarray(12), 22)
  assert.deepEqual([...decodeWav(extended).audio], [100, -100])
  assert.throws(() => decodeWav(wav.subarray(0, wav.length - 1)), /切れ/)
  assert.throws(() => decodeWav(new Uint8Array(20)))
})
