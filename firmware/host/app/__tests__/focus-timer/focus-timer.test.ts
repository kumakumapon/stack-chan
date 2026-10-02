import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from 'companion-idle'
import { FOCUS_TIMER_APP_ID, registerFocusTimerApp } from 'focus-timer-mini-app'
import { createFocusTimerScheduler, FocusTimerService } from 'focus-timer-service'
import { Application, Container, type Container as PiuContainer, type Label as PiuLabel } from 'piu/MC'
import { assert, equal } from 'testing/assert'
import Timer from 'timer'

const application = new Application(
  { face: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }), appBar: new ChatStatusBar() },
  { contents: [], Behavior: AppController, displayListLength: 4096 },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const behavior = view.behavior as { main: PiuContainer; faceMain: PiuContainer; appBar: PiuContainer }
let now = 0
let tick: (() => void) | undefined
let saves = 0
let close: (() => void) | undefined
const service = new FocusTimerService({
  now: () => now,
  schedule: (callback) => {
    tick = callback
    return () => {
      tick = undefined
    }
  },
  storage: { get: () => undefined, set: () => saves++ },
  suppressIdle: () => suppressCompanionIdle(controller),
})
registerFocusTimerApp(service, controller.miniApps, (handler) => {
  close = handler
})
controller.miniApps.register({ id: 'test.pet', title: 'PET STATUS', create: () => new Container() })

function button(name: string): PiuContainer {
  const root = behavior.main.first as PiuContainer
  const controls = root.last as PiuContainer
  return controls.content(name) as PiuContainer
}
function tap(name: string): void {
  const target = button(name)
  assert(target?.active, `${name} must be an active control`)
  ;(target.behavior as { onTouchEnded(content: PiuContainer): void }).onTouchEnded(target)
}

assert(controller.launchMiniApp(FOCUS_TIMER_APP_ID), 'host app must coexist with MOD Mini Apps')
assert((behavior.appBar.content('backButton') as PiuContainer).active, 'host Back remains accessible')
tap('focusPreset:focus-5')
tap('focusStart')
equal(service.getSnapshot().state, 'running', 'LCD Start should run offline')
assert(isCompanionIdleSuppressed(controller), 'running suppresses only Companion idle')
tap('focusPause')
equal(service.getSnapshot().state, 'paused', 'LCD Pause should work')
assert(!isCompanionIdleSuppressed(controller), 'pause releases idle')
tap('focusResume')
const beforeHidden = saves
controller.onMiniAppBack()
equal(behavior.main, behavior.faceMain, 'back restores the face')
equal(service.getSnapshot().state, 'running', 'view disposal cannot stop the host timer')
equal(saves, beforeHidden, 'view disposal cannot write storage')
assert(isCompanionIdleSuppressed(controller), 'UI close retains running suppression')
for (let index = 0; index < 20; index++) {
  assert(controller.launchMiniApp(FOCUS_TIMER_APP_ID), 'reopen')
  controller.onMiniAppBack()
}
assert(controller.launchMiniApp('test.pet'), 'another MOD app must remain usable')
const petMain = behavior.main
now = 300000
tick?.()
equal(behavior.main, petMain, 'completion must not steal another app')
equal(service.getSnapshot().state, 'completed', 'one delayed XS callback should complete')
assert(!isCompanionIdleSuppressed(controller), 'completion releases idle')
equal(saves, beforeHidden + 1, 'completion saves once, no per-second or view writes')
equal((behavior.appBar.content('title') as PiuLabel).string, 'PET STATUS', 'other AppBar title stays untouched')
assert(controller.launchMiniApp(FOCUS_TIMER_APP_ID), 'completion must remain available on return')
tap('focusBreak')
equal(service.getSnapshot().phase, 'break', 'break begins only through a user action')
tap('focusCancel')
equal(service.getSnapshot().state, 'idle', 'LCD Cancel is distinct from Back')
tap('focusStart')
close?.()
assert(!isCompanionIdleSuppressed(controller), 'host shutdown releases suppression')
equal(tick, undefined, 'host shutdown clears its Timer')
equal(service.getSnapshot().state, 'interrupted', 'shutdown records an interrupted session')
assert(!controller.launchMiniApp(FOCUS_TIMER_APP_ID), 'host shutdown unregisters only its app')
assert(controller.launchMiniApp('test.pet'), 'host timer shutdown must leave MOD registration intact')
const scheduleNative = createFocusTimerScheduler(Timer)
let fired = 0
const releaseFired = scheduleNative(() => {
  fired++
  releaseFired()
  releaseFired()
}, 1)
const releaseCancelled = scheduleNative(() => {
  throw new Error('cancelled native timer must not fire')
}, 1)
releaseCancelled()
releaseCancelled()
scheduleNative(() => {
  equal(fired, 1, 'native one-shot callback must fire once and accept repeated cleanup')
  trace('ok\n')
}, 20)
