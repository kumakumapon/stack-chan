import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  copyFaceState,
  copyFaceStateForDistribution,
  createFaceState,
  Emotion,
  EmotionNames,
  emotionFromName,
  faceStatesEqual,
  quantizeBreathForPixels,
  setColorRGB,
  toColorString,
  toEmotionName,
  toPiuColorNumber,
  toPiuColorString,
} from './face-state.js'

test('FaceState uses plain mutable objects with numeric emotion and ColorRGB theme state', () => {
  const face = createFaceState()

  assert.equal(typeof face, 'object')
  assert.equal(face.mouth.open, 0)
  assert.equal(face.emotion, Emotion.NEUTRAL)
  assert.equal('pad0' in face, false)
  assert.equal('pad' in face.theme.primary, false)
  assert.equal(toEmotionName(Emotion.HAPPY), 'HAPPY')
  assert.equal(emotionFromName('happy'), Emotion.HAPPY)

  setColorRGB(face.theme.primary, 0x12, 0x34, 0x56)
  setColorRGB(face.theme.secondary, 0xab, 0xcd, 0xef)
  assert.equal(toPiuColorNumber(face.theme.primary), 0x123456)
  assert.equal(toPiuColorString(toPiuColorNumber(face.theme.primary)), '#123456')
  assert.equal(toColorString(face.theme.secondary), '#abcdef')

  const copied = createFaceState()
  copyFaceState(face, copied)
  assert.equal(copied.emotion, face.emotion)
  assert.equal(toPiuColorNumber(copied.theme.primary), 0x123456)
  assert.equal(toPiuColorNumber(copied.theme.secondary), 0xabcdef)
})

test('FaceState distribution quantizes breath to rendered pixels', () => {
  const previous = createFaceState()
  const next = createFaceState()
  const previousDistributed = createFaceState()
  const nextDistributed = createFaceState()

  previous.breath = 0
  next.breath = 0.08
  copyFaceStateForDistribution(previous, previousDistributed, 6)
  copyFaceStateForDistribution(next, nextDistributed, 6)
  assert.equal(quantizeBreathForPixels(next.breath, 6), 0)
  assert.equal(faceStatesEqual(previousDistributed, nextDistributed), true)

  next.breath = 0.09
  copyFaceStateForDistribution(next, nextDistributed, 6)
  assert.equal(quantizeBreathForPixels(next.breath, 6), 1 / 6)
  assert.equal(faceStatesEqual(previousDistributed, nextDistributed), false)
})

test('every emotion round-trips by name and survives state copies', () => {
  for (const name of EmotionNames) {
    const emotion = emotionFromName(name.toLowerCase())
    assert.notEqual(emotion, undefined)
    assert.equal(emotion, Emotion[name])
    assert.equal(toEmotionName(Emotion[name]), name)
    const src = createFaceState()
    src.emotion = Emotion[name]
    const dst = createFaceState()
    copyFaceState(src, dst)
    assert.equal(dst.emotion, emotion)
    assert.equal(faceStatesEqual(src, dst), true)
  }
})

test('every selectable emotion has a device menu label in each supported language', () => {
  for (const locale of ['ja', 'en']) {
    const catalog = JSON.parse(readFileSync(`host/app/strings/${locale}.json`, 'utf8')) as Record<string, unknown>
    for (const name of EmotionNames) {
      const label = catalog[`drawer.emotion.${name.toLowerCase()}`]
      assert.equal(typeof label, 'string', `${locale}/${name} should have a translated label`)
      assert.ok((label as string).trim().length > 0)
    }
  }
})
