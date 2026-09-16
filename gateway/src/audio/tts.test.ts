import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNullTts, createOpenAiTts } from './tts.ts'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

test('createNullTts yields no chunks', async () => {
  const tts = createNullTts()
  assert.equal(tts.name, 'null')
  assert.equal(tts.sampleRate, 16_000)
  const chunks = await collect(tts.synthesize('hello'))
  assert.deepEqual(chunks, [])
})

test('createNullTts accepts a custom sample rate', () => {
  assert.equal(createNullTts(8_000).sampleRate, 8_000)
})

test('createOpenAiTts requests pcm and defaults to 24kHz, decoding the body into Int16Array chunks', async () => {
  const samples = new Int16Array([1, -1, 1000, -1000, 32000])
  const bytes = new Uint8Array(samples.buffer)
  let capturedUrl: string | undefined
  let capturedBody: string | undefined
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedUrl = String(url)
    capturedBody = init?.body as string
    // Split into two chunks with an odd byte boundary in the middle to exercise carry-over.
    return new Response(streamOf([bytes.slice(0, 3), bytes.slice(3)]), { status: 200 })
  }

  const tts = createOpenAiTts({ apiKey: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch })
  assert.equal(tts.sampleRate, 24_000)

  const chunks = await collect(tts.synthesize('hi there'))
  assert.equal(capturedUrl, 'https://api.openai.com/v1/audio/speech')
  const requestBody = JSON.parse(capturedBody ?? '{}')
  assert.equal(requestBody.response_format, 'pcm')
  assert.equal(requestBody.input, 'hi there')

  const allSamples = chunks.flatMap((chunk) => {
    assert.equal(chunk.sampleRate, 24_000)
    return Array.from(chunk.audio)
  })
  assert.deepEqual(allSamples, Array.from(samples))
})

test('createOpenAiTts throws a readable Error on non-2xx', async () => {
  const fetchImpl = async (): Promise<Response> => new Response('nope', { status: 500, statusText: 'Server Error' })
  const tts = createOpenAiTts({ apiKey: 'sk-test', fetchImpl: fetchImpl as unknown as typeof fetch })

  await assert.rejects(
    () => collect(tts.synthesize('hi')),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /500/)
      return true
    },
  )
})
