import Time from 'time'

export function monotonicNow(): number {
  return Time.ticks
}
