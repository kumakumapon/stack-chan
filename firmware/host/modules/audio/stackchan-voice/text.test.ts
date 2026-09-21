import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareStackchanVoiceText } from './text.js'

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
test('does not remove kanji, unsupported symbols, or long text', () => {
  const text = '明日は雨です。😊'.repeat(10)
  assert.equal(prepareStackchanVoiceText(text), text)
})
