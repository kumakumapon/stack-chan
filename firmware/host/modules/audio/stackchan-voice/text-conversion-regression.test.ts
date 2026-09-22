import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { prepareStackchanVoiceText } from './text.js'

/**
 * Regression coverage for the manual reproduction workflow documented in
 * `host/modules/audio/__tests__/stackchan-voice-device/README.md`.
 *
 * `prepareStackchanVoiceText`'s job is to keep the vendored C converter
 * (`vendor/stackchan-voice/src/aqk2r_compat.c`) from ever seeing text it
 * fails on. That converter and its bundled dictionary are the only source of
 * truth for error 105 and for the four characters that silently drop kanji
 * (see `text.ts`); nothing in `text.test.ts` proves the *converter* actually
 * accepts the normalized output, only that the normalization runs. This test
 * compiles the real converter with the real dictionary and feeds it
 * `prepareStackchanVoiceText`'s output directly, so a change that reopens
 * error 105 for common reply shapes fails CI instead of shipping again.
 *
 * Skips (rather than fails) when no C compiler is available, since that is
 * a property of the machine, not of this change. CI always has one.
 */

// `import.meta.dirname` resolves under the compiled `dist-tests/` output, not
// the source tree the C probe and vendored converter live in. `test:unit`
// always runs with `firmware/` as the working directory (see package.json).
const FIRMWARE_ROOT = process.cwd()
const PROBE_SOURCE = path.join(
  FIRMWARE_ROOT,
  'host/modules/audio/__tests__/stackchan-voice-device/text-conversion-probe-stdin.c',
)
const CONVERTER_SOURCE = path.join(FIRMWARE_ROOT, 'vendor/stackchan-voice/src/aqk2r_compat.c')
const CONVERTER_INCLUDE = path.join(FIRMWARE_ROOT, 'vendor/stackchan-voice/include')
const DICTIONARY = path.join(FIRMWARE_ROOT, 'vendor/stackchan-voice/data/stackchan-ja.aqd')

function findCompiler(): string | undefined {
  for (const candidate of ['cc', 'gcc', 'clang']) {
    if (spawnSync(candidate, ['--version']).status === 0) return candidate
  }
  return undefined
}

function compileProbe(compiler: string, outputDirectory: string): string {
  const binary = path.join(outputDirectory, 'text-conversion-probe-stdin')
  const result = spawnSync(compiler, ['-I', CONVERTER_INCLUDE, PROBE_SOURCE, CONVERTER_SOURCE, '-o', binary])
  assert.equal(result.status, 0, `probe build failed: ${result.stderr?.toString() ?? result.error}`)
  return binary
}

/**
 * Sentences shaped like real replies: kanji or katakana (which puts the
 * converter into dictionary-required mode, see `text.ts`) mixed with the
 * symbol classes that were previously observed to fail -- ellipses, full-
 * width brackets and punctuation, decorative marks, emoji, currency,
 * percent, a digit-sandwiched tilde, half-width katakana, and the four
 * dictionary-escape ASCII characters -- plus the counters and calendar
 * readings this module rewrites the digits for.
 */
const REPLY_SHAPES = [
  'こんにちは、元気ですか',
  '今日はいい天気ですね…',
  '明日は（会議）があります',
  '晴れ：明日は10時に出発します',
  'コンピュータの調子はどうですか',
  'スケジュールを確認しますね♪',
  'うれしいです😊',
  '価格は￥100です',
  '気温は50%くらいです',
  '5〜6人います',
  'ｺﾝﾋﾟｭｰﾀが好きです',
  "今日は晴れです'そうですね",
  '待って;すぐ行く',
  '明日は晴れ/曇りです',
  '明日は晴れ<明後日は雨',
  '明日は１４日に行ってください',
  '4月20日、9時に集合です',
  '1人で3分待って、1つください',
  '20歳の誕生日、2時間かかります',
]

test('prepareStackchanVoiceText output converts cleanly against the real dictionary', (t) => {
  const compiler = findCompiler()
  if (!compiler) {
    t.skip('no C compiler available on this machine')
    return
  }
  const workspace = mkdtempSync(path.join(tmpdir(), 'stackchan-voice-probe-'))
  try {
    const binary = compileProbe(compiler, workspace)
    const prepared = REPLY_SHAPES.map((text) => prepareStackchanVoiceText(text))
    const result = spawnSync(binary, [DICTIONARY], { input: `${prepared.join('\n')}\n`, encoding: 'utf8' })
    assert.equal(result.status, 0, `probe run failed: ${result.stderr}`)
    const lines = result.stdout.trim().split('\n')
    assert.equal(lines.length, REPLY_SHAPES.length)
    for (let i = 0; i < REPLY_SHAPES.length; i++) {
      assert.match(
        lines[i],
        /^err=0\t/,
        `expected clean conversion for ${JSON.stringify(REPLY_SHAPES[i])}, got ${JSON.stringify(lines[i])}`,
      )
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('the vendored converter still fails unprepared text the same way (documents the bug this module works around)', (t) => {
  const compiler = findCompiler()
  if (!compiler) {
    t.skip('no C compiler available on this machine')
    return
  }
  const workspace = mkdtempSync(path.join(tmpdir(), 'stackchan-voice-probe-'))
  try {
    const binary = compileProbe(compiler, workspace)
    // Raw, unprepared text: a kanji sentence with an emoji still fails with
    // error 105, and a raw apostrophe still silently drops the kanji before
    // it (no error, and the reading has no trace of "今日") rather than
    // erroring. If either assertion ever fails, the vendored converter's
    // behavior changed and `text.ts`'s workarounds should be re-evaluated,
    // not deleted as dead code.
    const cases = ['明日は１４日に行ってください😊', "今日は晴れです'そうですね"]
    const result = spawnSync(binary, [DICTIONARY], { input: `${cases.join('\n')}\n`, encoding: 'utf8' })
    assert.equal(result.status, 0, `probe run failed: ${result.stderr}`)
    const lines = result.stdout.trim().split('\n')
    assert.match(lines[0], /^err=105\t/)
    assert.match(lines[1], /^err=0\treading=/)
    const [, secondReading] = lines[1].split('reading=')
    assert.doesNotMatch(secondReading, /kyo/i, 'raw apostrophe should still silently drop the preceding kanji')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
