import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from 'companion-idle'
import { localize } from 'localization'
import AudioOut from 'pins/audioout'
import { Application, Container, type Container as PiuContainer, type Label as PiuLabel } from 'piu/MC'
import { createRhythmGameApp, RHYTHM_GAME_APP_ID } from 'rhythm-game-mini-app'
import Speaker from 'speaker'
import { assert, equal } from 'testing/assert'

const application = new Application(
  { face: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }), appBar: new ChatStatusBar() },
  { contents: [], Behavior: AppController, displayListLength: 4096 },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const behavior = view.behavior as { main: PiuContainer; faceMain: PiuContainer; appBar: PiuContainer }
const timers: { at: number; fire(): void; active: boolean }[] = []
let now = 0
let tones = 0
let cancelled = 0
let results = 0
let tapHead: ((at: number) => void) | undefined
const unregister = controller.miniApps.register(
  createRhythmGameApp({
    now: () => now,
    schedule(fire, delay) {
      const timer = { at: now + delay, fire, active: true }
      timers.push(timer)
      return () => {
        timer.active = false
      }
    },
    tone() {
      tones++
      return () => {
        cancelled++
      }
    },
    subscribeTap(listener) {
      tapHead = listener
      return () => {
        tapHead = undefined
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
function tap(name: string, hold = 0, move = false): void {
  const target = control(name)
  assert(target?.active, `${name} must be active`)
  const input = target.behavior as {
    onTouchBegan(content: PiuContainer, id: number, x: number, y: number): void
    onTouchMoved(content: PiuContainer, id: number, x: number, y: number): void
    onTouchEnded(content: PiuContainer, id: number): void
  }
  input.onTouchBegan(target, 0, target.x + 10, target.y + 10)
  advance(hold)
  if (move) input.onTouchMoved(target, 0, target.x + 40, target.y + 40)
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
function state(): string {
  return (control('rhythmStatus') as unknown as PiuLabel).string
}
function demonstrate(): void {
  while (state() === localize('rhythm.phase.showing')) advance(20)
  equal(state(), localize('rhythm.phase.input'), 'demonstration must yield input')
}

async function run(): Promise<void> {
  assert(controller.launchMiniApp(RHYTHM_GAME_APP_ID), 'app launches beside Pet')
  assert((behavior.appBar.content('backButton') as PiuContainer).active, 'Back is accessible')
  equal(state(), localize('rhythm.phase.ready'), 'ready screen')
  assert(!control('rhythmPad').active, 'no answers before Start')
  tap('rhythmAction')
  advance(600)
  assert(tones === 1, 'cue starts sound')
  assert(!control('rhythmPad').active, 'no answers during demonstration')
  tap('rhythmSound')
  equal(cancelled, 1, 'mute cancels the active owned cue')
  demonstrate()
  tap('rhythmPad', 350)
  tap('rhythmPad', 0, true)
  assert((control('rhythmProgress') as unknown as PiuLabel).string.endsWith('0/3'), 'hold and drag are ignored')
  tap('rhythmPad', 100)
  advance(500)
  tap('rhythmPad', 50)
  advance(550)
  tap('rhythmPad')
  equal(state(), localize('rhythm.phase.won'), 'LCD taps match onset timing')
  equal(tones, 1, 'silent game does not emit sound')
  equal(results, 0, 'partial practice does not emit completion')
  tap('rhythmAction')
  demonstrate()
  tapHead?.(now)
  advance(600)
  tapHead?.(now)
  advance(1200)
  tapHead?.(now)
  equal(state(), localize('rhythm.phase.won'), 'head input also completes a round')
  tap('rhythmAction')
  demonstrate()
  tapHead?.(now)
  advance(250)
  tapHead?.(now)
  equal(state(), localize('rhythm.phase.lost'), 'too-fast rhythm shows retry')
  tap('rhythmReplay')
  demonstrate()
  tap('rhythmReplay')
  const staleTap = tapHead
  controller.onMiniAppBack()
  assert(!tapHead, 'Back unsubscribes head input')
  assert(!isCompanionIdleSuppressed(controller), 'Back releases idle suppression')
  equal(behavior.main, behavior.faceMain, 'Back restores face')
  for (const timer of timers) timer.fire()
  staleTap?.(now)
  assert(!timers.some((t) => t.active), 'no timer survives disposal')
  assert(controller.launchMiniApp('test.pet'), 'Pet remains available')
  assert(controller.launchMiniApp(RHYTHM_GAME_APP_ID), 'game reopens')
  equal(state(), localize('rhythm.phase.ready'), 'reopening resets play')
  tap('rhythmAction')
  advance(600)
  const before = cancelled
  unregister()
  equal(cancelled, before + 1, 'shutdown cancels the owned cue')
  assert(!tapHead && !isCompanionIdleSuppressed(controller), 'unregister releases resources')

  const speaker = new Speaker({ volume: 0.2 })
  const first = speaker.toneOwned(880, 90)
  const firstOutput = (AudioOut as unknown as { latest: { closed: number; callback(): void } }).latest
  first.cancel()
  await first.done
  equal(firstOutput.closed, 1, 'native cancellation closes AudioOut immediately')
  const second = speaker.toneOwned(880, 90)
  const secondOutput = (AudioOut as unknown as { latest: { closed: number; callback(): void } }).latest
  firstOutput.callback()
  first.cancel()
  equal(firstOutput.closed, 1, 'late callback and repeated cancel are idempotent')
  equal(secondOutput.closed, 0, 'old owner cannot close the next sound')
  secondOutput.callback()
  await second.done
  equal(secondOutput.closed, 1, 'natural completion closes native output')
  trace('ok\n')
}
void run()
