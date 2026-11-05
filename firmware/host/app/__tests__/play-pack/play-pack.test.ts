import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from 'companion-idle'
import { createFortuneApp, FORTUNE_APP_ID } from 'fortune-mini-app'
import { HOI_DIRECTIONS, JANKEN_HANDS, JANKEN_TARGET_POINTS, JANKEN_TIMING } from 'janken-game'
import { createJankenApp, JANKEN_APP_ID } from 'janken-mini-app'
import { Application, Container, type Container as PiuContainer, type Label as PiuLabel } from 'piu/MC'
import { playText } from 'play-pack-text'
import { QUICK_TAP_ROUNDS, QUICK_TAP_TIMING } from 'quick-tap-game'
import { createQuickTapApp, QUICK_TAP_APP_ID } from 'quick-tap-mini-app'
import { assert, equal } from 'testing/assert'

const application = new Application(
  { face: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }), appBar: new ChatStatusBar() },
  { contents: [], Behavior: AppController, displayListLength: 4096 },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const behavior = view.behavior as { main: PiuContainer; faceMain: PiuContainer }
const timers: { at: number; fire(): void; active: boolean }[] = []
const randoms: number[] = []
const reactions: { name: string; active: boolean }[] = []
const saved = new Map<string, string>()
let now = 0
let day: number | null = 20000
let tones = 0
let results = 0
let tapHead: ((at: number) => void) | undefined
const schedule = (fire: () => void, delay: number) => {
  const timer = { at: now + delay, fire, active: true }
  timers.push(timer)
  return () => {
    timer.active = false
  }
}
const random = () => randoms.shift() ?? 0
const suppressIdle = () => suppressCompanionIdle(controller)
const storage = (key: string) => ({
  get: () => saved.get(key),
  set: (value: string) => {
    saved.set(key, value)
  },
})
const unregister = [
  controller.miniApps.register(
    createJankenApp({
      random,
      schedule,
      react(name) {
        const reaction = { name, active: true }
        reactions.push(reaction)
        return () => {
          reaction.active = false
        }
      },
      motionBlockReason: () => null,
      suppressIdle,
    }),
  ),
  controller.miniApps.register(
    createQuickTapApp({
      now: () => now,
      random,
      schedule,
      storage: storage('quicktap'),
      tone() {
        tones++
        return () => undefined
      },
      subscribeTap(listener) {
        tapHead = listener
        return () => {
          tapHead = undefined
        }
      },
      suppressIdle,
    }),
  ),
  controller.miniApps.register(
    createFortuneApp({ random, schedule, today: () => day, storage: storage('fortune'), suppressIdle }),
  ),
  controller.miniApps.register({ id: 'test.pet', title: 'PET STATUS', create: () => new Container() }),
]
controller.miniApps.subscribeResult(() => results++)

function control(name: string): PiuContainer {
  return (behavior.main.first as PiuContainer).content(name) as PiuContainer
}
function text(name: string, parent?: string): string {
  const target = parent ? control(parent).content(name) : control(name)
  return (target as unknown as PiuLabel).string
}
function tap(name: string): void {
  const target = control(name)
  assert(target?.visible !== false && target?.active, `${name} must be visible and active`)
  const input = target.behavior as {
    onTouchBegan(content: PiuContainer, id: number, x: number, y: number): void
    onTouchEnded(content: PiuContainer, id: number): void
  }
  input.onTouchBegan(target, 0, target.x + 10, target.y + 10)
  input.onTouchEnded(target, 0)
}
function advance(ms: number): void {
  const target = now + ms
  while (true) {
    const timer = timers.filter((entry) => entry.active && entry.at <= target).sort((a, b) => a.at - b.at)[0]
    if (!timer) break
    now = timer.at
    timer.active = false
    timer.fire()
  }
  now = target
}
const pick = <T>(items: readonly T[], item: T) => (items.indexOf(item) + 0.5) / items.length
function back(label: string): void {
  controller.onMiniAppBack()
  assert(!isCompanionIdleSuppressed(controller), `${label}: Back releases idle suppression`)
  equal(behavior.main, behavior.faceMain, `${label}: Back restores face`)
  for (const timer of timers) if (timer.active) timer.fire()
  assert(!timers.some((timer) => timer.active), `${label}: no timer survives disposal`)
}

function janken(): void {
  assert(controller.launchMiniApp(JANKEN_APP_ID), 'janken launches beside Pet')
  assert(isCompanionIdleSuppressed(controller), 'janken suppresses idle')
  equal(text('jankenStatus'), playText('janken.phase.ready'), 'janken ready screen')
  assert(control('janken:rock').visible === false, 'hands wait for Start')
  tap('jankenMotion')
  equal(text('label', 'jankenMotion'), playText('janken.motionOn'), 'motion toggle has a visible state label')
  tap('jankenAction')
  equal(text('jankenStatus'), playText('janken.phase.call'), 'call before choosing')
  assert(control('janken:rock').visible && !control('janken:rock').active, 'no early choice')
  for (let point = 0; point < JANKEN_TARGET_POINTS; point++) {
    advance(JANKEN_TIMING.call)
    equal(text('jankenStatus'), playText('janken.phase.choose'), 'choose phase')
    if (point === 1) {
      randoms.push(pick(JANKEN_HANDS, 'rock'))
      tap('janken:rock')
      equal(text('jankenStatus'), playText('janken.outcome.draw'), 'same hands draw')
      advance(JANKEN_TIMING.draw)
      equal(text('jankenStatus'), playText('janken.phase.aiko'), 'draw asks again')
    }
    randoms.push(pick(JANKEN_HANDS, 'scissors'))
    tap('janken:rock')
    equal(text('jankenStatus'), playText('janken.outcome.win'), 'rock beats scissors')
    advance(JANKEN_TIMING.reveal + JANKEN_TIMING.hoiCall)
    equal(text('jankenStatus'), playText('janken.phase.hoi'), 'hoi phase')
    assert(control('janken:rock').visible === false, 'hands hide for hoi')
    randoms.push(pick(HOI_DIRECTIONS, 'up'))
    tap('janken:up')
    equal(text('jankenStatus'), playText('janken.hoi.playerPoint'), 'matching direction scores')
    advance(JANKEN_TIMING.hoiReveal)
  }
  equal(text('jankenStatus'), playText('janken.phase.won'), 'first to the target wins')
  equal(results, 1, 'a finished match reports once')
  equal(reactions.filter((reaction) => reaction.name === 'look-up').length, JANKEN_TARGET_POINTS, 'head glances')
  equal(reactions[reactions.length - 1].name, 'success', 'win gesture')
  assert(control('jankenAction').visible, 'rematch is offered')
  back('janken')
  assert(!reactions.some((reaction) => reaction.active), 'Back cancels our reactions')
}

function quickTap(): void {
  const before = results
  assert(controller.launchMiniApp(QUICK_TAP_APP_ID), 'quick tap launches')
  equal(text('quickTapStatus'), playText('quicktap.phase.ready'), 'quick tap ready screen')
  assert(!control('quickTapPad').active, 'pad waits for Start')
  const press = () => {
    const pad = control('quickTapPad')
    assert(pad.active, 'pad accepts presses')
    ;(pad.behavior as { onTouchBegan(content: PiuContainer): void }).onTouchBegan(pad)
  }
  randoms.push(0)
  tap('quickTapAction')
  equal(text('quickTapStatus'), playText('quicktap.phase.waiting'), 'waiting for the signal')
  press()
  equal(text('quickTapStatus'), playText('quicktap.phase.early'), 'press before the signal is a false start')
  for (let round = 2; round <= QUICK_TAP_ROUNDS; round++) {
    randoms.push(0)
    advance(QUICK_TAP_TIMING.result)
    advance(QUICK_TAP_TIMING.minDelay)
    equal(text('quickTapStatus'), playText('quicktap.phase.go'), 'signal')
    advance(240 + round)
    if (round === 2) press()
    else tapHead?.(now)
    assert(text('quickTapStatus').startsWith(`${240 + round} ms`), 'reaction time is shown')
  }
  equal(tones, QUICK_TAP_ROUNDS - 1, 'one owned cue per signal')
  advance(QUICK_TAP_TIMING.result)
  equal(text('quickTapStatus'), playText('quicktap.phase.complete'), 'set completes')
  equal(saved.get('quicktap'), '242', 'the best time becomes the record')
  equal(results, before + 1, 'a set reports once')
  back('quick tap')
  assert(!tapHead, 'Back unsubscribes head input')
  assert(controller.launchMiniApp(QUICK_TAP_APP_ID), 'quick tap reopens')
  assert(text('quickTapProgress').includes('242'), 'the record survives reopening')
  back('quick tap reopened')
}

function fortune(): void {
  const before = results
  assert(controller.launchMiniApp(FORTUNE_APP_ID), 'fortune launches')
  equal(text('fortuneStatus'), playText('fortune.phase.ready'), 'fortune ready screen')
  assert(control('fortuneSlip').visible === false, 'no slip before drawing')
  tap('fortuneDraw')
  equal(text('fortuneStatus'), playText('fortune.phase.shaking'), 'shaking')
  randoms.push(0, 0, 0)
  advance(2000)
  equal(text('fortuneStatus'), playText('fortune.phase.revealed'), 'revealed')
  equal(text('fortuneRank', 'fortuneSlip'), playText('fortune.rank.great'), 'slip shows the rank')
  assert(control('fortuneSlip').visible, 'slip is visible')
  assert(!control('fortuneDraw').active, 'one slip per day')
  assert(saved.has('fortune'), 'the slip is saved for the day')
  back('fortune')
  assert(controller.launchMiniApp(FORTUNE_APP_ID), 'fortune reopens')
  equal(text('fortunePrompt'), playText('fortune.alreadyDrawn'), "today's slip is shown again")
  back('fortune reopened')
  day = 20001
  assert(controller.launchMiniApp(FORTUNE_APP_ID), 'fortune opens the next day')
  equal(text('fortuneStatus'), playText('fortune.phase.ready'), 'a new day starts fresh')
  back('fortune next day')
  day = null
  assert(controller.launchMiniApp(FORTUNE_APP_ID), 'fortune opens without a clock')
  equal(text('fortunePrompt'), playText('fortune.unsynced'), 'unsynced clock is explained')
  back('fortune unsynced')
  equal(results, before, 'fortune is not a scored game')
}

janken()
quickTap()
fortune()
assert(controller.launchMiniApp('test.pet'), 'Pet remains available')
for (const release of unregister) release()
assert(!isCompanionIdleSuppressed(controller), 'unregister releases resources')
trace('ok\n')
