import assert from 'node:assert/strict'
import test from 'node:test'
import { encodePcm16Base64 } from '../audio/pcm.ts'
import type { SttAdapter } from '../audio/stt.ts'
import { createAudioSession } from './audio-session.ts'

const FORMAT = { codec: 'pcm16' as const, sampleRate: 16_000, channels: 1 }

function tone(samples: number, amplitude: number): string {
  const frame = new Int16Array(samples)
  for (let index = 0; index < samples; index += 1) frame[index] = index % 2 === 0 ? amplitude : -amplitude
  return encodePcm16Base64(frame)
}

function recordingStt(text: string, seen: number[] = []): SttAdapter {
  return {
    name: 'recording',
    async transcribe(audio) {
      seen.push(audio.length)
      return { text, final: true }
    },
  }
}

test('speech followed by silence produces one transcribed utterance', async () => {
  const utterances: string[] = []
  const session = createAudioSession({
    stt: recordingStt('hello there'),
    inputFormat: FORMAT,
    onUtterance: (text) => {
      utterances.push(text)
    },
    onError: () => assert.fail('the STT must not have failed'),
  })
  for (let index = 0; index < 10; index += 1) await session.pushFrame(tone(1_600, 12_000))
  for (let index = 0; index < 20; index += 1) await session.pushFrame(tone(1_600, 0))
  assert.deepEqual(utterances, ['hello there'])
})

test('flush transcribes whatever is buffered without waiting for silence', async () => {
  const utterances: string[] = []
  const session = createAudioSession({
    stt: recordingStt('partial'),
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: (text) => {
      utterances.push(text)
    },
    onError: () => assert.fail('the STT must not have failed'),
  })
  await session.pushFrame(tone(3_200, 9_000))
  await session.flush()
  assert.deepEqual(utterances, ['partial'])
})

test('a microphone signal that never releases is transcribed at the safety bound', async () => {
  const utterances: string[] = []
  const seen: number[] = []
  const session = createAudioSession({
    stt: recordingStt('bounded', seen),
    maxUtteranceSeconds: 3,
    inputFormat: FORMAT,
    onUtterance: (text) => {
      utterances.push(text)
    },
    onError: () => assert.fail('the STT must not have failed'),
  })
  // This test selects a three-second safety bound. The following frame triggers
  // transcription instead of being dropped forever when VAD sees no silence.
  for (let index = 0; index < 3; index += 1) await session.pushFrame(tone(16_000, 12_000))
  await session.pushFrame(tone(1_600, 12_000))
  assert.deepEqual(utterances, ['bounded'])
  assert.deepEqual(seen, [48_000])
})

test('an empty buffer produces no utterance and no STT call', async () => {
  const seen: number[] = []
  const utterances: string[] = []
  const session = createAudioSession({
    stt: recordingStt('never', seen),
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: (text) => {
      utterances.push(text)
    },
    onError: () => assert.fail('the STT must not have failed'),
  })
  await session.flush()
  assert.deepEqual(seen, [])
  assert.deepEqual(utterances, [])
})

test('an STT failure is reported once and does not reject the caller', async () => {
  const errors: string[] = []
  const session = createAudioSession({
    stt: {
      name: 'failing',
      async transcribe() {
        throw new Error('transcription refused')
      },
    },
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: () => assert.fail('no utterance is expected'),
    onError: (message) => errors.push(message),
  })
  await session.pushFrame(tone(1_600, 9_000))
  await session.flush()
  assert.deepEqual(errors, ['transcription refused'])
})

test('an undecodable frame is dropped instead of ending the utterance', async () => {
  const utterances: string[] = []
  const session = createAudioSession({
    stt: recordingStt('survived'),
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: (text) => {
      utterances.push(text)
    },
    onError: () => assert.fail('the STT must not have failed'),
    logger: () => {},
  })
  await session.pushFrame('%%%not base64%%%')
  await session.pushFrame(tone(1_600, 9_000))
  await session.flush()
  assert.deepEqual(utterances, ['survived'])
})

test('reset discards the buffered utterance', async () => {
  const seen: number[] = []
  const session = createAudioSession({
    stt: recordingStt('dropped', seen),
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: () => assert.fail('no utterance is expected'),
    onError: () => assert.fail('the STT must not have failed'),
  })
  await session.pushFrame(tone(1_600, 9_000))
  session.reset()
  await session.flush()
  assert.deepEqual(seen, [])
})

test('short noise is discarded and does not contaminate the next utterance', async () => {
  const seen: number[] = []
  const session = createAudioSession({
    stt: recordingStt('speech', seen),
    inputFormat: FORMAT,
    onUtterance: () => {},
    onError: () => assert.fail('unexpected STT error'),
  })
  await session.pushFrame(tone(800, 12_000))
  for (let index = 0; index < 40; index++) await session.pushFrame(tone(1_600, 0))
  assert.deepEqual(seen, [])
  await session.pushFrame(tone(8_000, 12_000))
  for (let index = 0; index < 3; index++) await session.pushFrame(tone(1_600, 0))
  assert.deepEqual(seen, [12_800])
})

test('a single oversized frame cannot exceed storage limits or discard existing audio', async () => {
  for (const manualTurns of [true, false]) {
    const seen: number[] = []
    const session = createAudioSession({
      stt: recordingStt('speech', seen),
      maxUtteranceSeconds: 3,
      inputFormat: FORMAT,
      manualTurns,
      onUtterance: () => {},
      onError: () => assert.fail('unexpected STT error'),
    })
    await session.pushFrame(tone(3_200, 12_000))
    await session.pushFrame(tone(160_000, 12_000))
    await session.flush()
    assert.deepEqual(seen, [3_200])
  }
})

test('reset during a manual overflow transcription cannot append stale audio', async () => {
  let complete!: (value: { text: string; final: boolean }) => void
  let calls = 0
  const session = createAudioSession({
    stt: {
      name: 'deferred',
      transcribe: () => {
        calls++
        return new Promise((resolve) => {
          complete = resolve
        })
      },
    },
    inputFormat: FORMAT,
    manualTurns: true,
    onUtterance: () => assert.fail('stale text must be discarded'),
    maxUtteranceSeconds: 3,
    onError: () => assert.fail('unexpected STT error'),
  })
  await session.pushFrame(tone(48_000, 12_000))
  const pending = session.pushFrame(tone(320, 12_000))
  session.reset()
  complete({ text: 'stale', final: true })
  await pending
  await session.flush()
  assert.equal(calls, 1)
})

test('speech longer than three seconds remains one utterance until silence', async () => {
  const seen: number[] = []
  const session = createAudioSession({
    stt: recordingStt('long speech', seen),
    inputFormat: FORMAT,
    onUtterance: () => {},
    onError: () => assert.fail('unexpected error'),
  })
  for (let index = 0; index < 40; index++) await session.pushFrame(tone(1_600, 12_000))
  assert.deepEqual(seen, [])
  for (let index = 0; index < 3; index++) await session.pushFrame(tone(1_600, 0))
  assert.deepEqual(seen, [68_800])
})

test('safety segmentation preserves every sample in order across frame boundaries', async () => {
  for (const manualTurns of [true, false]) {
    const segments: number[][] = []
    const session = createAudioSession({
      stt: {
        name: 'samples',
        async transcribe(audio) {
          segments.push(Array.from(audio))
          return { text: 'segment', final: true }
        },
      },
      inputFormat: FORMAT,
      maxUtteranceSeconds: 0.35,
      manualTurns,
      onUtterance: () => {},
      onError: () => assert.fail('unexpected error'),
    })
    const source = Int16Array.from({ length: 12_800 }, (_, index) => 10_000 + (index % 10_000))
    for (let offset = 0; offset < source.length; offset += 3_200)
      await session.pushFrame(encodePcm16Base64(source.subarray(offset, offset + 3_200)))
    await session.flush()
    assert.deepEqual(segments.flat(), Array.from(source))
    assert.ok(segments.length > 1)
    assert.ok(segments.every((segment) => segment.length <= 5_600))
  }
})
