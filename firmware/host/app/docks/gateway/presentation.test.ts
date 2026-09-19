import assert from 'node:assert/strict'
import test from 'node:test'
import { createGatewayPresentation } from './presentation.js'

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
  const pending = Promise.resolve(p.onOutputTranscript('hello', true)).then(() => {
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
