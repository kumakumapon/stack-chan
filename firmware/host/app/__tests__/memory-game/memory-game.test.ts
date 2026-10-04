import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from 'companion-idle'
import { localize } from 'localization'
import { createMemoryGameApp, MEMORY_GAME_APP_ID } from 'memory-game-mini-app'
import { Application, Container, type Container as PiuContainer, type Label as PiuLabel } from 'piu/MC'
import { assert, equal } from 'testing/assert'

const application = new Application(
  { face: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }), appBar: new ChatStatusBar() },
  { contents: [], Behavior: AppController, displayListLength: 4096 },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const behavior = view.behavior as { main: PiuContainer; faceMain: PiuContainer; appBar: PiuContainer }
const timers: { fire(): void; active: boolean }[] = []
let effects = 0
let cancelled = 0
let results = 0
const unregister = controller.miniApps.register(
  createMemoryGameApp({
    random: () => 0,
    schedule(callback) {
      const timer = { fire: callback, active: true }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    react() {
      effects++
      return () => {
        cancelled++
      }
    },
    suppressIdle: () => suppressCompanionIdle(controller),
  }),
)
controller.miniApps.subscribeResult(() => results++)
controller.miniApps.register({ id: 'test.pet', title: 'PET STATUS', create: () => new Container() })

function control(name: string): PiuContainer {
  return (behavior.main.first as PiuContainer).content(name) as PiuContainer
}
function tap(name: string): void {
  const target = control(name)
  assert(target?.active, `${name} must be active`)
  const input = target.behavior as {
    onTouchBegan(content: PiuContainer, id: number, x: number, y: number): void
    onTouchEnded(content: PiuContainer): void
  }
  input.onTouchBegan(target, 0, target.x + 10, target.y + 10)
  input.onTouchEnded(target)
}
function step(): void {
  const timer = timers.find((entry) => entry.active)
  assert(timer, 'expected a scheduled transition')
  if (!timer) return
  timer.active = false
  timer.fire()
}
function state(): string {
  return (control('memoryStatus') as unknown as PiuLabel).string
}

assert(controller.launchMiniApp(MEMORY_GAME_APP_ID), 'memory app must launch beside Pet')
assert((behavior.appBar.content('backButton') as PiuContainer).active, 'host Back stays accessible')
equal(state(), localize('memory.phase.ready'), 'ready screen')
assert(!control('memory:yes').active, 'answers disabled before Start')
tap('memoryAction')
step()
equal(state(), localize('memory.phase.showing'), 'LCD Start presents a cue')
assert(!control('memory:yes').active, 'answers disabled during demonstration')
step()
step()
tap('memory:yes')
assert(!control('memory:yes').active, 'feedback blocks repeated input')
step()
equal(state(), localize('memory.phase.won'), 'correct answer completes a round')
equal(effects, 0, 'default mode does not move the robot')
tap('memoryAction')
for (let index = 0; index < 5; index++) step()
tap('memory:no')
equal(state(), localize('memory.phase.lost'), 'wrong answer reveals expected cue')
equal(results, 1, 'finished game emits one result')
tap('memoryMotion')
tap('memoryAction')
step()
equal(effects, 1, 'opt-in movement starts with the cue')
const oldTimers = timers.slice()
controller.onMiniAppBack()
equal(cancelled, 1, 'Back cancels the owned movement')
assert(!isCompanionIdleSuppressed(controller), 'Back releases idle suppression')
equal(behavior.main, behavior.faceMain, 'Back restores face')
for (const timer of oldTimers) timer.fire()
equal(effects, 1, 'disposed callbacks cannot produce new movement')
assert(controller.launchMiniApp('test.pet'), 'Pet is still available')
for (let index = 0; index < 10; index++) {
  assert(controller.launchMiniApp(MEMORY_GAME_APP_ID), 'reopen')
  equal(state(), localize('memory.phase.ready'), 'reopen starts a fresh game')
  tap('memoryAction')
  controller.onMiniAppBack()
}
assert(controller.launchMiniApp(MEMORY_GAME_APP_ID), 'shutdown from open game')
tap('memoryAction')
unregister()
assert(!isCompanionIdleSuppressed(controller), 'unregister disposes the open app')
assert(!timers.some((timer) => timer.active), 'no timer retained')
assert(controller.launchMiniApp('test.pet'), 'unregister leaves other apps intact')
trace('ok\n')
