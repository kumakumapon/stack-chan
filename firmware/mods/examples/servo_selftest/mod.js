import { formatServoSelfTestSummary, runServoSelfTest } from 'servo-selftest'
import Timer from 'timer'

/**
 * Servo self-test MOD.
 *
 * Flashing this MOD is a single device cycle that reports which layer is
 * broken: power, link, framing or actual movement. `npm run mod` is much faster
 * than a host flash, so this is the cheapest way to narrow down a head failure
 * before changing any firmware code.
 *
 * The full report is traced as one JSON line; the screen shows the verdict.
 */

let running = false

export function onContextCreated(robot) {
  robot.ui.drawer.addDrawerButton({
    key: 'servo-selftest-run',
    label: 'Servo self-test',
    callback: () => {
      void run(robot)
    },
  })
  void run(robot)
}

async function run(robot) {
  if (running) return
  running = true
  robot.ui.showBalloon('Servo self-test: running')
  try {
    const report = await runServoSelfTest({
      motion: robot.motion,
      wait: (milliseconds) => new Promise((resolve) => Timer.set(resolve, milliseconds)),
    })
    trace(`[servo-selftest] ${JSON.stringify(report)}\n`)
    robot.ui.showBalloon(formatServoSelfTestSummary(report))
  } catch (error) {
    trace(`[servo-selftest] failed: ${String(error)}\n`)
    robot.ui.showBalloon('Servo self-test: failed to run')
  } finally {
    running = false
  }
}
