import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNullStt, createOpenAiStt, encodeWav } from './stt.ts'

test('encodeWav writes a valid 44-byte RIFF/WAVE PCM16 header', () => {
  const audio = new Int16Array([1, -1, 1000, -1000])
  const wav = encodeWav(audio, 16_000)
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...Array.from(wav.slice(offset, offset + length)))

  assert.equal(wav.length, 44 + audio.length * 2)
  assert.equal(ascii(0, 4), 'RIFF')
  assert.equal(view.getUint32(4, true), 36 + audio.length * 2)
  assert.equal(ascii(8, 4), 'WAVE')
  assert.equal(ascii(12, 4), 'fmt ')
  assert.equal(view.getUint32(16, true), 16)
  assert.equal(view.getUint16(20, true), 1) // PCM
  assert.equal(view.getUint16(22, true), 1) // mono
  assert.equal(view.getUint32(24, true), 16_000)
  assert.equal(view.getUint32(28, true), 16_000 * 1 * 2) // byte rate
  assert.equal(view.getUint16(32, true), 2) // block align
  assert.equal(view.getUint16(34, true), 16) // bits per sample
  assert.equal(ascii(36, 4), 'data')
  assert.equal(view.getUint32(40, true), audio.length * 2)

  // Sample data follows immediately after the header, little-endian.
  assert.equal(view.getInt16(44, true), 1)
  assert.equal(view.getInt16(46, true), -1)
})

test('encodeWav handles an empty frame', () => {
  const wav = encodeWav(new Int16Array(0), 8_000)
  assert.equal(wav.length, 44)
})

test('createNullStt always returns empty final text', async () => {
  const stt = createNullStt()
  assert.equal(stt.name, 'null')
  const result = await stt.transcribe(new Int16Array([1, 2, 3]), 16_000)
  assert.deepEqual(result, { text: '', final: true })
})

test('createOpenAiStt posts multipart form data and returns the transcript', async () => {
  let capturedUrl: string | undefined
  let capturedInit: RequestInit | undefined
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url)
    capturedInit = init
    return new Response(JSON.stringify({ text: 'hello world' }), { status: 200 })
  }

  const stt = createOpenAiStt({ apiKey: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch })
  const result = await stt.transcribe(new Int16Array([1, 2, 3, 4]), 16_000)

  assert.equal(result.text, 'hello world')
  assert.equal(result.final, true)
  assert.equal(capturedUrl, 'https://api.openai.com/v1/audio/transcriptions')
  assert.equal(capturedInit?.method, 'POST')
  assert.ok(capturedInit?.body instanceof FormData)
  const form = capturedInit?.body as FormData
  assert.equal(form.get('model'), 'whisper-1')
  const file = form.get('file')
  assert.ok(file instanceof Blob)
  const headers = capturedInit?.headers as Record<string, string> | undefined
  assert.equal(headers?.Authorization, 'Bearer sk-test')
})

test('createOpenAiStt includes language in the form only when it is configured', async () => {
  const capture = () => {
    let form: FormData | undefined
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      form = init?.body as FormData
      return new Response(JSON.stringify({ text: 'hi' }), { status: 200 })
    }
    return { fetchImpl: fetchImpl as unknown as typeof fetch, forms: () => form }
  }

  const withLanguage = capture()
  const sttWithLanguage = createOpenAiStt({ apiKey: 'sk-test', language: 'ja', fetchImpl: withLanguage.fetchImpl })
  await sttWithLanguage.transcribe(new Int16Array([1, 2]), 16_000)
  assert.equal(withLanguage.forms()?.get('language'), 'ja')

  const withoutLanguage = capture()
  const sttWithoutLanguage = createOpenAiStt({ apiKey: 'sk-test', fetchImpl: withoutLanguage.fetchImpl })
  await sttWithoutLanguage.transcribe(new Int16Array([1, 2]), 16_000)
  assert.equal(withoutLanguage.forms()?.get('language'), null)
})

test('createOpenAiStt throws a readable Error (never a raw Response) on non-2xx', async () => {
  const fetchImpl = async (): Promise<Response> => new Response('bad key', { status: 401, statusText: 'Unauthorized' })
  const stt = createOpenAiStt({ apiKey: 'sk-bad', fetchImpl: fetchImpl as unknown as typeof fetch })

  await assert.rejects(
    () => stt.transcribe(new Int16Array([1, 2]), 16_000),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /401/)
      assert.match(error.message, /bad key/)
      return true
    },
  )
})
