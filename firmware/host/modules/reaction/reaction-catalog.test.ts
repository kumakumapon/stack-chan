import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'reaction-types', resolve(modulesRoot, 'reaction/reaction-types.js'))
writeAliasPackage(modulesRoot, 'reaction-limits', resolve(modulesRoot, 'reaction/reaction-limits.js'))

const { REACTION_NAMES } = await import('./reaction-types.js')
const { REACTION_LIMITS, validateTimeline } = await import('./reaction-limits.js')
const { REACTION_CATALOG, reactionTimeline } = await import('./reaction-catalog.js')

const HAND_ANIMATION_NAMES = ['none', 'rock-paper-scissors', 'clap', 'thinking', 'wave', 'cheer'] as const
const { EmotionNames: EMOTION_NAMES } = await import('../ui/state/face-state.js')
const EMOTICON_KEYS = ['heart', 'angry', 'sweat', 'tear', 'sleepy'] as const

test('every REACTION_NAMES entry has a catalog timeline whose name matches', () => {
  for (const name of REACTION_NAMES) {
    const entry = REACTION_CATALOG[name]
    assert.ok(entry, `missing catalog entry for ${name}`)
    assert.equal(entry.name, name)
    assert.equal(reactionTimeline(name), entry)
  }
})

test('every catalog timeline satisfies validateTimeline', () => {
  for (const name of REACTION_NAMES) {
    assert.equal(validateTimeline(REACTION_CATALOG[name]), undefined, `${name} should be a valid timeline`)
  }
})

test('every catalog timeline restores by default', () => {
  for (const name of REACTION_NAMES) {
    assert.equal(REACTION_CATALOG[name].restore, undefined, `${name} should not override restore`)
  }
})

test('every referenced hand is a known hand animation name', () => {
  for (const name of REACTION_NAMES) {
    for (const frame of REACTION_CATALOG[name].frames) {
      if (frame.hand === undefined) continue
      assert.ok(
        (HAND_ANIMATION_NAMES as readonly string[]).includes(frame.hand),
        `${name} references unknown hand ${frame.hand}`,
      )
    }
  }
})

test('every referenced emotion is a known emotion name', () => {
  for (const name of REACTION_NAMES) {
    for (const frame of REACTION_CATALOG[name].frames) {
      if (frame.emotion === undefined) continue
      assert.ok(
        (EMOTION_NAMES as readonly string[]).includes(frame.emotion),
        `${name} references unknown emotion ${frame.emotion}`,
      )
    }
  }
})

test('every referenced effect is a known emoticon key or null', () => {
  for (const name of REACTION_NAMES) {
    for (const frame of REACTION_CATALOG[name].frames) {
      if (frame.effect === undefined) continue
      assert.ok(
        frame.effect === null || (EMOTICON_KEYS as readonly string[]).includes(frame.effect),
        `${name} references unknown effect ${frame.effect}`,
      )
    }
  }
})

test('a frame at time 0 sets the emotion', () => {
  for (const name of REACTION_NAMES) {
    const first = REACTION_CATALOG[name].frames[0]
    assert.equal(first.at, 0)
    assert.ok(first.emotion, `${name} should set an emotion at time 0`)
  }
})

test('no frame is scheduled after the timeline ends', () => {
  for (const name of REACTION_NAMES) {
    const { frames, durationMs } = REACTION_CATALOG[name]
    for (const frame of frames) assert.ok(frame.at <= durationMs, `${name} has a frame after its duration`)
  }
})

test('catalog head moves stay within limits and finish before the next head move or restore', () => {
  for (const entry of Object.values(REACTION_CATALOG)) {
    const moving = entry.frames.filter((frame) => frame.head)
    for (let index = 0; index < moving.length; index++) {
      const frame = moving[index]
      const head = frame.head
      assert.ok(head)
      if (head.yaw !== undefined) assert.ok(Math.abs(head.yaw) <= REACTION_LIMITS.yawRad, entry.name)
      if (head.pitch !== undefined) assert.ok(Math.abs(head.pitch) <= REACTION_LIMITS.pitchRad, entry.name)
      const duration = head.durationMs ?? REACTION_LIMITS.defaultHeadDurationMs
      assert.ok(duration >= REACTION_LIMITS.minHeadDurationMs && duration <= REACTION_LIMITS.maxHeadDurationMs)
      assert.ok((moving[index + 1]?.at ?? entry.durationMs) >= frame.at + duration, entry.name)
    }
  }
})
