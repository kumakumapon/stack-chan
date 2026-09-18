import { buildStatusPayload, dispatchCommand, isPerformanceBridgeActive, parseCommand } from 'performance-command'
import Timer from 'timer'

// Matches the other WASM input bridges' poll cadence (see button-bridge.js);
// fast enough that a queued play()/cancel() never waits noticeably, cheap
// enough to run every tick regardless of whether anything is queued.
const POLL_INTERVAL_MS = 50
// Refresh the browser's status line at least twice a second while a reaction
// or performance is active, so its elapsed-time / nextCue display stays live
// even when no new command arrives.
const STATUS_INTERVAL_TICKS = Math.round(500 / POLL_INTERVAL_MS)

const takeCommand = native('xs_stackchan_wasm_performance_take')
const pushStatus = native('xs_stackchan_wasm_performance_status')

function describeCommand(command) {
  return command.name ? `${command.target} ${command.action} ${command.name}` : `${command.target} ${command.action}`
}

function traceResult(command, result) {
  if (result.ok) {
    trace(`[wasm-performance] ${describeCommand(command)}: ok\n`)
  } else {
    trace(`[wasm-performance] ${describeCommand(command)}: error ${result.error}\n`)
  }
}

// Installation is deferred until runtime because native functions are
// unavailable while xsl evaluates preloadable module code (see
// wasm-button-bridge for the same constraint).
export function installWasmPerformance(context) {
  if (!context?.reaction || !context.performance) return false

  let ticksSinceStatus = 0

  const pushStatusNow = () => {
    pushStatus(JSON.stringify(buildStatusPayload(context)))
    ticksSinceStatus = 0
  }

  Timer.repeat(() => {
    const raw = takeCommand()
    if (raw) {
      const command = parseCommand(raw)
      if (command) {
        traceResult(command, dispatchCommand(command, context))
      } else {
        trace('[wasm-performance] ignoring malformed command\n')
      }
      pushStatusNow()
      return
    }

    ticksSinceStatus += 1
    if (ticksSinceStatus >= STATUS_INTERVAL_TICKS) {
      if (isPerformanceBridgeActive(context)) pushStatusNow()
      else ticksSinceStatus = 0
    }
  }, POLL_INTERVAL_MS)

  return true
}
