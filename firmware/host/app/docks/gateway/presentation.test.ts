import assert from 'node:assert/strict'
import test from 'node:test'
import { createGatewayPresentation } from './presentation.js'

test('local speech preserves full text, numbers and kanji for the selected engine', async () => {
  const spoken: string[] = [],
    balloons: string[] = []
  const p = createGatewayPresentation(
    {
      audio: {
        say: async (text) => {
          spoken.push(text)
        },
      },
      showBalloon: (text) => {
        balloons.push(text)
      },
    },
    { speakLocally: true },
  )
  const replies = ['明日は雨です。10時に出発します。', 'Hello 123', '長い回答です。'.repeat(12)]
  for (const reply of replies) await p.onOutputTranscript(reply, true)
  assert.deepEqual(spoken, replies)
  assert.deepEqual(balloons, replies)
})

test('local conversion failures surface and a later reply can still be spoken', async () => {
  let fail = true
  const spoken: string[] = []
  const p = createGatewayPresentation(
    {
      audio: {
        say: async (text) => {
          spoken.push(text)
          return fail ? { success: false, reason: 'conversion failed (105)' } : { success: true }
        },
      },
    },
    { speakLocally: true },
  )
  await assert.rejects(() => Promise.resolve(p.onOutputTranscript('未知の文字', true)), /105/)
  fail = false
  await p.onOutputTranscript('こんにちは', true)
  assert.deepEqual(spoken, ['未知の文字', 'こんにちは'])
})

test('local transcript completion waits for speech and stopped presentations ignore late speech', async () => {
  let finish!: () => void,
    calls = 0
  const p = createGatewayPresentation(
    {
      audio: {
        say: () => {
          calls++
          return new Promise<void>((resolve) => {
            finish = resolve
          })
        },
      },
    },
    { speakLocally: true },
  )
  let complete = false
  const pending = Promise.resolve(p.onOutputTranscript('こんにちは', true)).then(() => {
    complete = true
  })
  await Promise.resolve()
  assert.equal(complete, false)
  finish()
  await pending
  assert.equal(complete, true)
  p.close()
  await p.onOutputTranscript('late', true)
  assert.equal(calls, 1)
})
test('Gateway completion waits for PCM playback and never duplicates local TTS', async () => {
  let finish!: () => void,
    played: string[] = []
  const p = createGatewayPresentation(
    {
      audio: {
        say: async () => {
          assert.fail('duplicate TTS')
        },
      },
    },
    {
      speakLocally: false,
      createAudio: () => ({
        push: (frame) => {
          played.push(frame)
        },
        finish: () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
        stop() {},
      }),
    },
  )
  await p.onOutputTranscript('hello', true)
  p.onAudioStarted({ codec: 'pcm16', sampleRate: 16000, channels: 1 })
  p.onAudioChunk('AAAA')
  let complete = false
  const pending = Promise.resolve(p.onAudioCompleted()).then(() => {
    complete = true
  })
  await Promise.resolve()
  assert.equal(complete, false)
  assert.deepEqual(played, ['AAAA'])
  finish()
  await pending
  assert.equal(complete, true)
})
test('interrupt stops streaming audio and cancels local speech', () => {
  let stopped = 0,
    cancelled = 0
  const p = createGatewayPresentation(
    {
      audio: {
        say: async () => {},
        tts: {
          cancel: () => {
            cancelled++
          },
        },
      },
    },
    {
      speakLocally: false,
      createAudio: () => ({
        push() {},
        finish: async () => {},
        stop: () => {
          stopped++
        },
      }),
    },
  )
  p.onAudioStarted({ codec: 'pcm16', sampleRate: 16000, channels: 1 })
  p.interrupt?.()
  p.onAudioChunk('AAAA')
  assert.equal(stopped, 1)
  assert.equal(cancelled, 1)
})
