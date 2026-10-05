// The SDK's WASM Time.ticks binding is a stub. Share the browser monotonic clock
// already used by Focus Timer instead of wall time (which users can change).
export { now as monotonicNow } from 'focus-timer-platform'
