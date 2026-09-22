import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../../testing/node-alias-package.js'
import type { StackchanVoiceRenderer } from '../wasm/stackchan-voice-wav.js'

// stackchan-voice-wav.ts imports the shared text-normalization module ('stackchan-voice-text')
// as a bare specifier, resolved by the real module system at build time. Under plain Node
// module resolution that bare specifier has no target, so it is aliased into a throwaway
// node_modules package before the module under test is (dynamically) loaded, mirroring the
// pattern used by microphone.test.ts / tts-playback-lifecycle.test.ts.
type StackchanVoiceWavModule = typeof import('../wasm/stackchan-voice-wav.js')

function installBareSpecifierPackages(): void {
  const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  writeAliasPackage(modulesRoot, 'stackchan-voice-text', resolve(modulesRoot, 'audio/stackchan-voice/text.js'))
}

async function loadStackchanVoiceWav(): Promise<StackchanVoiceWavModule> {
  installBareSpecifierPackages()
  return import('../wasm/stackchan-voice-wav.js')
}

test('cancelled scheduled synthesis cannot read or reset the next voice', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const tasks: Array<() => void> = []
  let cancelled = false,
    reads = 0,
    starts = 0
  const pending = renderStackchanVoiceWav(
    {
      say() {
        starts++
      },
      koe() {},
      read24() {
        reads++
        return 1
      },
    },
    'old',
    { schedule: (task) => tasks.push(task), isCancelled: () => cancelled },
  )
  const rejection = assert.rejects(pending, /cancelled/)
  tasks.shift()?.()
  cancelled = true
  tasks.shift()?.()
  await rejection
  assert.equal(starts, 1)
  assert.equal(reads, 1)
})

class FakeStackchanVoice implements StackchanVoiceRenderer {
  readonly koeCalls: Array<{ koe: string; speed?: number }> = []
  readonly sayCalls: Array<{ text: string; speed?: number }> = []
  #offset = 0

  constructor(readonly samples: Int16Array) {}

  say(text: string, speed?: number): void {
    this.sayCalls.push({ text, speed })
    this.#offset = 0
  }

  koe(koe: string, speed?: number): void {
    this.koeCalls.push({ koe, speed })
    this.#offset = 0
  }

  read24(buffer: ArrayBuffer): number {
    if (this.#offset >= this.samples.length) return 0
    const output = new Int16Array(buffer)
    const count = Math.min(output.length, this.samples.length - this.#offset)
    output.set(this.samples.subarray(this.#offset, this.#offset + count))
    this.#offset += count
    return count
  }
}

function ascii(buffer: ArrayBuffer, offset: number, length: number): string {
  return String.fromCharCode(...new Uint8Array(buffer, offset, length))
}

test('renderStackchanVoiceWav renders 24 kHz mono PCM with volume and a valid WAV header', async () => {
  const { renderStackchanVoiceWav, STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE } = await loadStackchanVoiceWav()
  const voice = new FakeStackchanVoice(new Int16Array([1000, -1000, 2000]))

  const rendered = await renderStackchanVoiceWav(voice, 'こんにちは', {
    chunkSamples: 2,
    schedule: queueMicrotask,
    speed: 120,
    volume: 0.5,
  })

  const header = new DataView(rendered.buffer)
  const pcm = new Int16Array(rendered.buffer, 44)
  assert.deepEqual(voice.sayCalls, [{ text: 'こんにちは', speed: 120 }])
  assert.equal(ascii(rendered.buffer, 0, 4), 'RIFF')
  assert.equal(ascii(rendered.buffer, 8, 4), 'WAVE')
  assert.equal(ascii(rendered.buffer, 12, 4), 'fmt ')
  assert.equal(ascii(rendered.buffer, 36, 4), 'data')
  assert.equal(header.getUint16(20, true), 1)
  assert.equal(header.getUint16(22, true), 1)
  assert.equal(header.getUint32(24, true), STACKCHAN_VOICE_OUTPUT_SAMPLE_RATE)
  assert.equal(header.getUint16(34, true), 16)
  assert.equal(header.getUint32(40, true), 6)
  assert.deepEqual([...pcm], [500, -500, 1000])
  assert.equal(rendered.samples, 3)
  assert.equal(rendered.power, Math.sqrt((500 ** 2 + 500 ** 2 + 1000 ** 2) / 3))
})

test('renderStackchanVoiceWav applies the shared text normalization before synthesis', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const voice = new FakeStackchanVoice(new Int16Array([1]))

  await renderStackchanVoiceWav(voice, '「１４日」', {
    chunkSamples: 2,
    schedule: queueMicrotask,
  })

  assert.deepEqual(voice.sayCalls, [{ text: ' じゅうよっか ', speed: 100 }])
})

test('renderStackchanVoiceWav grows its PCM buffer and clamps volume', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const samples = Int16Array.from({ length: 6000 }, (_, index) => (index % 2 === 0 ? 20000 : -20000))
  const voice = new FakeStackchanVoice(samples)

  const rendered = await renderStackchanVoiceWav(voice, '長い文章', {
    chunkSamples: 257,
    schedule: queueMicrotask,
    volume: 2,
  })

  assert.equal(rendered.samples, samples.length)
  assert.equal(rendered.buffer.byteLength, 44 + samples.byteLength)
  assert.deepEqual([...new Int16Array(rendered.buffer, 44, 4)], [20000, -20000, 20000, -20000])
})

test('renderStackchanVoiceKoeWav starts the renderer with singing koe notation, bypassing text normalization', async () => {
  const { renderStackchanVoiceKoeWav } = await loadStackchanVoiceWav()
  const voice = new FakeStackchanVoice(new Int16Array([500, -500]))

  const rendered = await renderStackchanVoiceKoeWav(voice, '#C4,500ki#D4,500ra', {
    chunkSamples: 2,
    schedule: queueMicrotask,
    speed: 90,
  })

  assert.deepEqual(voice.koeCalls, [{ koe: '#C4,500ki#D4,500ra', speed: 90 }])
  assert.deepEqual(voice.sayCalls, [])
  assert.equal(rendered.samples, 2)
})

test('renderStackchanVoiceWav emits an empty but valid WAV for an empty utterance', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const rendered = await renderStackchanVoiceWav(new FakeStackchanVoice(new Int16Array()), '', {
    schedule: queueMicrotask,
    volume: -1,
  })

  assert.equal(rendered.samples, 0)
  assert.equal(rendered.power, 0)
  assert.equal(rendered.buffer.byteLength, 44)
  assert.equal(new DataView(rendered.buffer).getUint32(40, true), 0)
})

test('renderStackchanVoiceWav yields before and between native chunks', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const voice = new FakeStackchanVoice(new Int16Array([1, 2, 3]))
  const tasks: Array<() => void> = []
  const renderedPromise = renderStackchanVoiceWav(voice, 'scheduled', {
    chunkSamples: 2,
    schedule: (task) => tasks.push(task),
  })

  assert.equal(voice.sayCalls.length, 0)
  assert.equal(tasks.length, 1)
  while (tasks.length > 0) tasks.shift()?.()

  const rendered = await renderedPromise
  assert.equal(rendered.samples, 3)
  assert.deepEqual(voice.sayCalls, [{ text: 'scheduled', speed: 100 }])
})

test('renderStackchanVoiceWav rejects a renderer that exceeds the sample bound', async () => {
  const { renderStackchanVoiceWav } = await loadStackchanVoiceWav()
  const endlessVoice: StackchanVoiceRenderer = {
    koe: () => {},
    say: () => {},
    read24: (buffer) => {
      new Int16Array(buffer).fill(1)
      return new Int16Array(buffer).length
    },
  }

  await assert.rejects(
    renderStackchanVoiceWav(endlessVoice, 'endless', {
      chunkSamples: 4,
      maxSamples: 5,
      schedule: queueMicrotask,
    }),
    /maximum of 5 samples/,
  )
})
