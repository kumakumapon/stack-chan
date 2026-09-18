import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { writeAliasPackage } from '../testing/node-alias-package.js'

const modulesRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
writeAliasPackage(modulesRoot, 'performance-types', resolve(modulesRoot, 'performance/performance-types.js'))
writeAliasPackage(modulesRoot, 'motion-catalog', resolve(modulesRoot, 'performance/motion-catalog.js'))
writeAliasPackage(modulesRoot, 'reaction-types', resolve(modulesRoot, 'reaction/reaction-types.js'))

const { PERFORMANCE_NAMES, PERFORMANCE_LIMITS } = await import('./performance-types.js')
const { MOTION_CATALOG } = await import('./motion-catalog.js')
const { REACTION_NAMES } = await import('../reaction/reaction-types.js')
const { PERFORMANCE_CATALOG, performanceTimeline } = await import('./performance-catalog.js')

const MIN_SPEECH_GAP_MS = 3000
const MIN_SONG_GAP_MS = 15000

function cueLengthMs(cue: (typeof PERFORMANCE_CATALOG)[keyof typeof PERFORMANCE_CATALOG]['cues'][number]): number {
  if (cue.motion) return MOTION_CATALOG[cue.motion].durationMs
  if (cue.light?.durationMs) return cue.light.durationMs
  return 0
}

test('every PERFORMANCE_NAMES entry has a catalog timeline whose name matches', () => {
  for (const name of PERFORMANCE_NAMES) {
    const entry = PERFORMANCE_CATALOG[name]
    assert.ok(entry, `missing catalog entry for ${name}`)
    assert.equal(entry.name, name)
    assert.equal(performanceTimeline(name), entry)
  }
})

test('cues are sorted by at and within the cue count limit', () => {
  for (const name of PERFORMANCE_NAMES) {
    const { cues } = PERFORMANCE_CATALOG[name]
    assert.ok(cues.length <= PERFORMANCE_LIMITS.maxCues, `${name} exceeds the cue limit`)
    let previousAt = -Infinity
    for (const cue of cues) {
      assert.ok(cue.at >= previousAt, `${name} cues must be sorted by at`)
      previousAt = cue.at
    }
  }
})

test('durationMs is within the limit and covers the last cue', () => {
  for (const name of PERFORMANCE_NAMES) {
    const { cues, durationMs } = PERFORMANCE_CATALOG[name]
    assert.ok(durationMs <= PERFORMANCE_LIMITS.maxDurationMs, `${name} exceeds the duration limit`)
    const last = cues[cues.length - 1]
    assert.ok(durationMs >= last.at + cueLengthMs(last), `${name} durationMs is shorter than its last cue`)
  }
})

test('motion/head cues are spaced at least 150 ms apart, and a motion cue waits for the previous motion', () => {
  for (const name of PERFORMANCE_NAMES) {
    const moving = PERFORMANCE_CATALOG[name].cues.filter((cue) => cue.motion !== undefined || cue.head !== undefined)
    for (let index = 1; index < moving.length; index++) {
      const previous = moving[index - 1]
      const current = moving[index]
      const gap = current.at - previous.at
      assert.ok(gap >= PERFORMANCE_LIMITS.minHeadCueSpacingMs, `${name} has motion/head cues too close together`)
      if (previous.motion) {
        assert.ok(
          gap >= MOTION_CATALOG[previous.motion].durationMs,
          `${name} starts a motion before the last one finished`,
        )
      }
    }
  }
})

test('speech and song cues do not overlap the next speech/song cue', () => {
  for (const name of PERFORMANCE_NAMES) {
    const spoken = PERFORMANCE_CATALOG[name].cues.filter((cue) => cue.speech !== undefined || cue.song !== undefined)
    for (let index = 1; index < spoken.length; index++) {
      const previous = spoken[index - 1]
      const current = spoken[index]
      const minGap = previous.song !== undefined ? MIN_SONG_GAP_MS : MIN_SPEECH_GAP_MS
      assert.ok(current.at - previous.at >= minGap, `${name} speech/song cues overlap`)
    }
  }
})

test('every reaction cue names a REACTION_NAMES entry', () => {
  for (const name of PERFORMANCE_NAMES) {
    for (const cue of PERFORMANCE_CATALOG[name].cues) {
      if (cue.reaction === undefined) continue
      assert.ok(
        (REACTION_NAMES as readonly string[]).includes(cue.reaction),
        `${name} references unknown reaction ${cue.reaction}`,
      )
    }
  }
})

test('every motion cue names a MOTION_NAMES entry', () => {
  for (const name of PERFORMANCE_NAMES) {
    for (const cue of PERFORMANCE_CATALOG[name].cues) {
      if (cue.motion === undefined) continue
      assert.ok(cue.motion in MOTION_CATALOG, `${name} references unknown motion ${cue.motion}`)
    }
  }
})
