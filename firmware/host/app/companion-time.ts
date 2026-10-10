// Pure time-of-day helpers for Companion. No imports, no Date/Intl, and no
// mutable module state so the module is cheap on small targets.

/**
 * Same threshold as network-service.ts and the chat status bar: epochs at or
 * before 2023-01-03 mean the RTC has not been set by SNTP yet.
 */
const MINIMUM_SYNCED_EPOCH_MS = 1672722071_000

export type DayPeriod = 'morning' | 'day' | 'evening' | 'night' | 'unknown'

export type QuietHoursInput = {
  epochMs: number
  utcOffsetMinutes: number
  startMinute: number
  endMinute: number
}

export const DEFAULT_QUIET_START_MINUTE = 22 * 60
export const DEFAULT_QUIET_END_MINUTE = 7 * 60

export function isClockSynced(epochMs: number): boolean {
  return Number.isFinite(epochMs) && epochMs > MINIMUM_SYNCED_EPOCH_MS
}

/** Minutes since local midnight (0-1439) using a fixed UTC offset. */
export function localMinutesOfDay(epochMs: number, utcOffsetMinutes: number): number {
  const minutes = Math.floor((epochMs + utcOffsetMinutes * 60000) / 60000)
  return ((minutes % 1440) + 1440) % 1440
}

/** morning 05:00-10:00, day 10:00-17:00, evening 17:00-22:00, otherwise night. */
export function dayPeriod(epochMs: number, utcOffsetMinutes: number): DayPeriod {
  if (!isClockSynced(epochMs) || !Number.isFinite(utcOffsetMinutes)) return 'unknown'
  const minute = localMinutesOfDay(epochMs, utcOffsetMinutes)
  if (minute >= 5 * 60 && minute < 10 * 60) return 'morning'
  if (minute >= 10 * 60 && minute < 17 * 60) return 'day'
  if (minute >= 17 * 60 && minute < 22 * 60) return 'evening'
  return 'night'
}

export function normalizeQuietMinute(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 1439) return fallback
  return value
}

/** Start is inclusive, end is exclusive; start > end wraps past midnight, start == end is disabled. */
export function isQuietHours({ epochMs, utcOffsetMinutes, startMinute, endMinute }: QuietHoursInput): boolean {
  if (!isClockSynced(epochMs) || !Number.isFinite(utcOffsetMinutes)) return false
  const start = normalizeQuietMinute(startMinute, -1)
  const end = normalizeQuietMinute(endMinute, -1)
  if (start < 0 || end < 0 || start === end) return false
  const minute = localMinutesOfDay(epochMs, utcOffsetMinutes)
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}
