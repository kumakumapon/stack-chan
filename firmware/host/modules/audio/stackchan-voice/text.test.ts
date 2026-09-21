import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareStackchanVoiceText, stripStackchanVoiceSymbols } from './text.js'

test('reported calendar phrase retains words and reads the day rather than individual digits', () => {
  assert.equal(prepareStackchanVoiceText('「明日は１４日に行ってください」'), ' 明日はじゅうよっかに行ってください ')
  assert.equal(prepareStackchanVoiceText('明日は14日に行ってください'), '明日はじゅうよっかに行ってください')
})
test('numbers, dates and times remain spoken rather than discarded', () => {
  assert.equal(prepareStackchanVoiceText('10時に出発します'), 'じゅうじに出発します')
  assert.equal(prepareStackchanVoiceText('4月20日、9時'), 'しがつはつか、くじ')
  assert.equal(prepareStackchanVoiceText('1日間、24日'), 'いちにち間、にじゅうよっか')
  assert.equal(
    prepareStackchanVoiceText('3,680円と12.05と007'),
    'さんぜんろっぴゃくはちじゅう円とじゅうにてんぜろごとぜろぜろなな',
  )
  assert.equal(prepareStackchanVoiceText('10001'), 'いちまんいち')
})
test('keeps kanji and long text, replacing only symbols that cannot be read', () => {
  // An emoji anywhere in a sentence that contains kanji makes the vendored
  // converter fail the whole sentence with error 105, which leaves the
  // conversation blocked. Turning it into a space is not the same as dropping
  // a word: every word and number survives.
  const text = '明日は雨です。😊'.repeat(10)
  assert.equal(prepareStackchanVoiceText(text), '明日は雨です。 '.repeat(10))
})
test('normalizes symbols known to trigger error 105 into safe characters', () => {
  assert.equal(prepareStackchanVoiceText('今日は晴れです…'), '今日は晴れです、')
  assert.equal(prepareStackchanVoiceText('明日（雨）です'), '明日 雨 です')
  assert.equal(prepareStackchanVoiceText('晴れ：明日'), '晴れ、明日')
  assert.equal(prepareStackchanVoiceText('晴れ　明日'), '晴れ 明日')
  assert.equal(prepareStackchanVoiceText('明日は晴れ😊です'), '明日は晴れ です')
  assert.equal(prepareStackchanVoiceText('晴れ♪明日'), '晴れ 明日')
  assert.equal(prepareStackchanVoiceText('晴れ※明日'), '晴れ 明日')
  assert.equal(prepareStackchanVoiceText('晴れ—明日'), '晴れ 明日')
  // long-vowel mark and word-final tilde stay untouched (they never trigger error 105)
  assert.equal(prepareStackchanVoiceText('ラーメン'), 'ラーメン')
  assert.equal(prepareStackchanVoiceText('やったね〜'), 'やったね〜')
})
test('reads currency, percent and a digit-sandwiched tilde as spoken words', () => {
  assert.equal(prepareStackchanVoiceText('￥100'), 'ひゃく円')
  assert.equal(prepareStackchanVoiceText('50%'), 'ごじゅうぱーせんと')
  assert.equal(prepareStackchanVoiceText('5〜6人'), 'ごからろくにん')
})
test('reads common counters with correct onbin rather than the bare digit reading', () => {
  assert.equal(prepareStackchanVoiceText('1つ'), 'ひとつ')
  assert.equal(prepareStackchanVoiceText('1人'), 'ひとり')
  assert.equal(prepareStackchanVoiceText('4人'), 'よにん')
  assert.equal(prepareStackchanVoiceText('14人'), 'じゅうよにん')
  assert.equal(prepareStackchanVoiceText('3分'), 'さんぷん')
  assert.equal(prepareStackchanVoiceText('30分'), 'さんじゅっぷん')
  assert.equal(prepareStackchanVoiceText('15分'), 'じゅうごふん')
  assert.equal(prepareStackchanVoiceText('3分の1'), 'さんぶんのいち')
  assert.equal(prepareStackchanVoiceText('1本'), 'いっぽん')
  assert.equal(prepareStackchanVoiceText('20歳'), 'はたち')
  assert.equal(prepareStackchanVoiceText('2時間'), 'にじかん')
  assert.equal(prepareStackchanVoiceText('4時間'), 'よじかん')
  assert.equal(prepareStackchanVoiceText('10個'), 'じゅっこ')
})
test('stripStackchanVoiceSymbols removes only symbols, keeping words and digits', () => {
  const stripped = stripStackchanVoiceSymbols('明日は晴れ😊100%だよ♪')
  assert.equal(stripped.text, '明日は晴れ 100%だよ ')
  assert.equal(stripped.removed, '😊♪')
  const clean = stripStackchanVoiceSymbols('明日は晴れです、100%だよ')
  assert.equal(clean.text, '明日は晴れです、100%だよ')
  assert.equal(clean.removed, '')
})
test('neutralizes the four dictionary-escape characters that silently drop kanji instead of erroring', () => {
  // Measured against the vendored C converter: a raw apostrophe disables dictionary lookup for the rest
  // of the sentence and silently discards the kanji that precede it, rather than raising error 105.
  const result = prepareStackchanVoiceText("今日は晴れです'そうですね")
  assert.equal(result, '今日は晴れです そうですね')
  assert.ok(result.includes('今日は'), '漢字が保持されたまま')
  for (const dangerous of ["'", '/', ';', '<']) {
    assert.ok(!prepareStackchanVoiceText(`明日は晴れ${dangerous}明後日は雨`).includes(dangerous))
  }
  assert.equal(prepareStackchanVoiceText('明日は晴れ/曇りです'), '明日は晴れ 曇りです')
  assert.equal(prepareStackchanVoiceText('待って;すぐ行く'), '待って、すぐ行く')
  assert.equal(prepareStackchanVoiceText('明日は晴れ<明後日は雨'), '明日は晴れ 明後日は雨')
})
test('whitelist sweep clears unlisted symbols while keeping surrounding words and digits', () => {
  assert.equal(prepareStackchanVoiceText('今日❤天気'), '今日 天気')
  assert.equal(prepareStackchanVoiceText('明日▲晴れ'), '明日 晴れ')
  assert.equal(prepareStackchanVoiceText('午後⇒夜10時'), '午後 夜じゅうじ')
  assert.equal(prepareStackchanVoiceText('晴れ　明日は10時'), '晴れ 明日はじゅうじ')
  // a bare half-width dakuten mark, unattached to any half-width kana, has no full-width form and must
  // not silently delete the surrounding word
  assert.equal(prepareStackchanVoiceText('晴れﾞ明日'), '晴れ 明日')
})
test('converts half-width katakana to full-width, composing dakuten and handakuten', () => {
  assert.equal(prepareStackchanVoiceText('ｺﾝﾋﾟｭｰﾀ'), 'コンピュータ')
  assert.equal(prepareStackchanVoiceText('ｶﾞｯｺｳ'), 'ガッコウ')
  assert.equal(prepareStackchanVoiceText('ﾊﾟﾝ'), 'パン')
  assert.equal(prepareStackchanVoiceText('ｺｰﾋｰが好き'), 'コーヒーが好き')
  // ｱ has no voiced form, so the composition fails: keep the base character and turn the
  // uncomposable ﾞ into a trailing space rather than losing the mora.
  assert.equal(prepareStackchanVoiceText('ｱﾞ'), 'ア ')
})
