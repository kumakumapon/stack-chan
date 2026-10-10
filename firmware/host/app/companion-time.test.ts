import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayPeriod, isClockSynced, isQuietHours, localMinutesOfDay, normalizeQuietMinute } from './companion-time.js'

const JST = 9 * 60
const SYNCED_BASE = Date.UTC(2026, 9, 11, 0, 0, 0) // 2026-10-11T00:00Z
const at = (utcHour: number, utcMinute = 0) => SYNCED_BASE + (utcHour * 60 + utcMinute) * 60000
const quiet = (epochMs: number, startMinute = 22 * 60, endMinute = 7 * 60, utcOffsetMinutes = 0) =>
  isQuietHours({ epochMs, utcOffsetMinutes, startMinute, endMinute })

test('clock sync detection rejects unset and invalid clocks', () => {
  assert.equal(isClockSynced(0), false)
  assert.equal(isClockSynced(1672722071000), false)
  assert.equal(isClockSynced(1672722071001), true)
  assert.equal(isClockSynced(Number.NaN), false)
  assert.equal(isClockSynced(Number.POSITIVE_INFINITY), false)
})

test('local minutes follow the fixed offset across midnight', () => {
  assert.equal(localMinutesOfDay(at(0, 0), 0), 0)
  assert.equal(localMinutesOfDay(at(15, 0), JST), 0)
  assert.equal(localMinutesOfDay(at(0, 0), -480), 16 * 60)
})

test('day periods use closed-open boundaries', () => {
  const p = (h: number, m = 0) => dayPeriod(at(h, m), 0)
  assert.equal(p(4, 59), 'night')
  assert.equal(p(5), 'morning')
  assert.equal(p(9, 59), 'morning')
  assert.equal(p(10), 'day')
  assert.equal(p(16, 59), 'day')
  assert.equal(p(17), 'evening')
  assert.equal(p(21, 59), 'evening')
  assert.equal(p(22), 'night')
  assert.equal(p(0), 'night')
})

test('the same instant maps to different periods per timezone offset', () => {
  const epoch = at(0, 0) // 00:00 UTC
  assert.equal(dayPeriod(epoch, 540), 'morning') // 09:00
  assert.equal(dayPeriod(epoch, -480), 'day') // 16:00
  assert.equal(dayPeriod(epoch, 330), 'morning') // 05:30
  assert.equal(dayPeriod(epoch, 0), 'night')
})

test('unsynced clocks are unknown and never quiet', () => {
  for (const epoch of [0, 1672722071000, Number.NaN]) {
    assert.equal(dayPeriod(epoch, 0), 'unknown')
    assert.equal(quiet(epoch, 0, 1439), false)
  }
})

test('overnight quiet hours wrap midnight with exclusive end', () => {
  assert.equal(quiet(at(23, 59)), true)
  assert.equal(quiet(at(0, 0)), true)
  assert.equal(quiet(at(6, 59)), true)
  assert.equal(quiet(at(7, 0)), false)
  assert.equal(quiet(at(21, 59)), false)
  assert.equal(quiet(at(22, 0)), true)
})

test('same-day quiet windows and timezone offsets are honored', () => {
  assert.equal(quiet(at(12, 0), 13 * 60, 15 * 60), false)
  assert.equal(quiet(at(13, 0), 13 * 60, 15 * 60), true)
  assert.equal(quiet(at(15, 0), 13 * 60, 15 * 60), false)
  const epoch = at(14, 0) // 23:00 JST, 14:00 UTC, 06:00 UTC-8, 19:30 UTC+5:30
  assert.equal(quiet(epoch, 22 * 60, 7 * 60, 540), true)
  assert.equal(quiet(epoch, 22 * 60, 7 * 60, 0), false)
  assert.equal(quiet(epoch, 22 * 60, 7 * 60, -480), true)
  assert.equal(quiet(epoch, 22 * 60, 7 * 60, 330), false)
})

test('degenerate or invalid quiet windows are disabled', () => {
  assert.equal(quiet(at(3), 600, 600), false)
  assert.equal(quiet(at(3), -1, 420), false)
  assert.equal(quiet(at(3), 1320, 1440), false)
  assert.equal(quiet(at(3), 1320, Number.NaN), false)
})

test('normalizeQuietMinute keeps zero and rejects invalid values', () => {
  assert.equal(normalizeQuietMinute(0, 99), 0)
  assert.equal(normalizeQuietMinute(1439, 99), 1439)
  assert.equal(normalizeQuietMinute(1440, 99), 99)
  assert.equal(normalizeQuietMinute(-1, 99), 99)
  assert.equal(normalizeQuietMinute(30.5, 99), 99)
  assert.equal(normalizeQuietMinute(Number.NaN, 99), 99)
  assert.equal(normalizeQuietMinute('', 99), 99)
  assert.equal(normalizeQuietMinute(undefined, 99), 99)
})
