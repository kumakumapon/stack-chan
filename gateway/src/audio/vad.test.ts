import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createEnergyVad } from './vad.ts'

const SAMPLE_RATE = 1_000 // 1 sample == 1ms, convenient for duration assertions

function tone(amplitude: number, samples: number): Int16Array {
  return new Int16Array(samples).fill(amplitude)
}

const LOUD = 20_000 // rms level ~0.61, above the 0.5 activation threshold used below
const MID = 12_000 // rms level ~0.37, between the 0.3 release and 0.5 activation thresholds
const SILENT = 0

function makeVad(overrides: Partial<Parameters<typeof createEnergyVad>[0]> = {}) {
  return createEnergyVad({
    sampleRate: SAMPLE_RATE,
    activationLevel: 0.5,
    releaseLevel: 0.3,
    hangoverMs: 50,
    minUtteranceMs: 100,
    ...overrides,
  })
}

test('silence never starts speech', () => {
  const vad = makeVad()
  for (let i = 0; i < 20; i++) assert.deepEqual(vad.push(tone(SILENT, 10)), [])
  assert.equal(vad.speaking, false)
})

test('crossing activationLevel starts speech immediately', () => {
  const vad = makeVad()
  assert.deepEqual(vad.push(tone(LOUD, 10)), [{ type: 'speech.start' }])
  assert.equal(vad.speaking, true)
})

test('a long utterance ends with speech.end once silence outlasts hangoverMs', () => {
  const vad = makeVad()
  assert.deepEqual(vad.push(tone(LOUD, 100)), [{ type: 'speech.start' }]) // 100ms voiced
  assert.equal(vad.speaking, true)

  // hangoverMs is 50; four 10ms silent frames (40ms) must not release yet.
  for (let i = 0; i < 4; i++) assert.deepEqual(vad.push(tone(SILENT, 10)), [])
  assert.equal(vad.speaking, true)

  // The fifth silent frame crosses 50ms of continuous silence -> release.
  const events = vad.push(tone(SILENT, 10))
  assert.equal(events.length, 1)
  assert.equal(events[0]?.type, 'speech.end')
  assert.equal(events[0]?.type === 'speech.end' ? events[0].durationMs : undefined, 100)
  assert.equal(vad.speaking, false)
})

test('a brief blip below minUtteranceMs gets speech.start but no speech.end', () => {
  const vad = makeVad()
  assert.deepEqual(vad.push(tone(LOUD, 10)), [{ type: 'speech.start' }]) // only 10ms voiced

  // 50ms of trailing silence releases the utterance, but 10ms < minUtteranceMs(100).
  for (let i = 0; i < 4; i++) assert.deepEqual(vad.push(tone(SILENT, 10)), [])
  const events = vad.push(tone(SILENT, 10))
  assert.deepEqual(events, [])
  assert.equal(vad.speaking, false)
})

test('a mid-level frame (above release, below activation) resets the hangover run without ending speech', () => {
  const vad = makeVad()
  vad.push(tone(LOUD, 100)) // 100ms voiced, satisfies minUtteranceMs already

  // 40ms of silence, then a mid-level frame that is still above releaseLevel...
  for (let i = 0; i < 4; i++) vad.push(tone(SILENT, 10))
  assert.deepEqual(vad.push(tone(MID, 10)), []) // resets the below-release run
  assert.equal(vad.speaking, true)

  // ...so another 40ms of silence still isn't enough to release.
  for (let i = 0; i < 4; i++) assert.deepEqual(vad.push(tone(SILENT, 10)), [])
  assert.equal(vad.speaking, true)

  // The 5th frame after the reset finally crosses hangoverMs again.
  const events = vad.push(tone(SILENT, 10))
  assert.equal(events[0]?.type, 'speech.end')
})

test('reset() clears in-progress speech without emitting an event', () => {
  const vad = makeVad()
  vad.push(tone(LOUD, 100))
  assert.equal(vad.speaking, true)
  vad.reset()
  assert.equal(vad.speaking, false)
  // A fresh loud frame starts a brand new utterance, proving state was cleared.
  assert.deepEqual(vad.push(tone(LOUD, 10)), [{ type: 'speech.start' }])
})

test('an empty frame is a no-op', () => {
  const vad = makeVad()
  assert.deepEqual(vad.push(new Int16Array(0)), [])
  assert.equal(vad.speaking, false)
})
