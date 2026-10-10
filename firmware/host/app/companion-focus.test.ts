import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { writeAliasPackage } from '../modules/testing/node-alias-package.js'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from './companion-idle.js'

const appRoot = dirname(fileURLToPath(import.meta.url))
const hostRoot = resolve(process.cwd(), 'host')
const compiledHost = resolve(appRoot, '..')
writeAliasPackage(hostRoot, 'companion-idle', resolve(appRoot, 'companion-idle.js'))
writeAliasPackage(hostRoot, 'companion-battery', resolve(appRoot, 'companion-battery.js'))
writeAliasPackage(hostRoot, 'localization', resolve(compiledHost, 'modules/testing/fakes/localization.js'))
writeAliasPackage(hostRoot, 'modules', resolve(compiledHost, 'modules/testing/fakes/modules.js'), {
  hasDefaultExport: true,
})
writeAliasPackage(hostRoot, 'timer', resolve(compiledHost, 'modules/testing/fakes/timer.js'), {
  hasDefaultExport: true,
})
const { default: Timer } = await import('../modules/testing/fakes/timer.js')
const { resetModules } = await import('../modules/testing/fakes/modules.js')
// Load this platform boundary through Node's TS stripping. The unit build's
// deliberately opaque StackchanContext fake cannot typecheck the full MOD API.
const { installCompanion } = (await import(
  pathToFileURL(resolve(hostRoot, 'app/default-behavior/companion.ts')).href
)) as { installCompanion(robot: unknown, options: unknown): void }

test('real Companion idle checks respect temporary suppression and user settings, while explicit play works', () => {
  Timer.reset()
  const originalNow = Date.now
  const originalRandom = Math.random
  const originalTrace = globalThis.trace
  let now = 0
  const reactions: string[] = []
  const performances: string[] = []
  const buttons: { key: string; callback: () => void }[] = []
  let close: (() => void) | undefined
  const controller: { companionIdle: boolean; onCompanionTap?: () => void } = { companionIdle: true }
  const settings = { greetingOnBoot: false, idleReactions: true }
  const robot = {
    ui: { application: { behavior: controller }, closeDrawer: () => undefined, showFace: () => undefined },
    conversation: {},
    audio: { isActive: false },
    reaction: { status: () => ({}), play: (name: string) => reactions.push(name) },
    performance: {
      status: () => ({}),
      play: (name: string) => {
        performances.push(name)
        return { ok: true }
      },
    },
    drawer: { addDrawerButton: (button: (typeof buttons)[number]) => buttons.push(button) },
    lifecycle: {
      onClose: (handler: () => void) => {
        close = handler
      },
    },
  }
  try {
    Date.now = () => now
    Math.random = () => 0
    globalThis.trace = () => undefined
    installCompanion(
      robot as unknown as Parameters<typeof installCompanion>[0],
      { config: { companion: settings } } as never,
    )
    const release = suppressCompanionIdle(robot)
    now += 60000
    Timer.advance(60000)
    assert.equal(reactions.length, 0, 'waiting reactions are blocked')
    buttons.find((button) => button.key === 'companion-cheer')?.callback()
    assert.deepEqual(performances, ['cheer'], 'user-started performance is still available')
    release()
    now += 60000
    Timer.advance(60000)
    assert.equal(reactions.length, 1)
    const releaseAgain = suppressCompanionIdle(robot)
    settings.idleReactions = false
    releaseAgain()
    now += 60000
    Timer.advance(60000)
    assert.equal(reactions.length, 1, 'releasing suppression must preserve the changed preference')
    assert.equal(settings.idleReactions, false)
    assert.equal(isCompanionIdleSuppressed(robot), false)
    close?.()
    now += 60000
    Timer.advance(60000)
    assert.equal(reactions.length, 1, 'host close must clear waiting callbacks')
    assert.equal(controller.onCompanionTap, undefined)
  } finally {
    Date.now = originalNow
    Math.random = originalRandom
    globalThis.trace = originalTrace
  }
})

type LowBatteryOptions = {
  level?: () => number | undefined
  setting?: number | boolean
  remoteState?: string
  busy?: () => boolean
}

function lowBatteryHarness(options: LowBatteryOptions = {}) {
  Timer.reset()
  const original = { now: Date.now, random: Math.random, trace: globalThis.trace }
  let now = 0
  Date.now = () => now
  Math.random = () => 0
  globalThis.trace = () => undefined
  resetModules(options.level ? { 'battery-status': options.level } : {})
  const reactions: string[] = []
  const balloons: string[] = []
  let hides = 0
  let close: (() => void) | undefined
  const remote =
    options.remoteState === undefined
      ? undefined
      : { state: options.remoteState, activationState: 'inactive', subscribe: () => () => undefined }
  const robot = {
    ui: { application: { behavior: { companionIdle: true } }, closeDrawer: () => undefined, showFace: () => undefined },
    conversation: { remoteSession: remote },
    audio: {
      get isActive() {
        return options.busy?.() ?? false
      },
    },
    reaction: { status: () => ({}), play: (name: string) => reactions.push(name) },
    performance: { status: () => ({}), play: () => ({ ok: true }) },
    drawer: { addDrawerButton: () => undefined },
    showBalloon: (text: string) => balloons.push(text),
    hideBalloon: () => {
      hides += 1
    },
    lifecycle: { onClose: (handler: () => void) => (close = handler) },
  }
  const settings: Record<string, unknown> = { greetingOnBoot: false, idleReactions: true }
  if (options.setting !== undefined) settings.lowBatteryNotice = options.setting
  installCompanion(robot as never, { config: { companion: settings } } as never)
  return {
    reactions,
    balloons,
    hides: () => hides,
    // The fake Timer fires each rescheduled callback once per call, so step in small increments.
    advance(ms: number) {
      for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
        now += 1000
        Timer.advance(1000)
      }
    },
    close: () => close?.(),
    restore() {
      Date.now = original.now
      Math.random = original.random
      globalThis.trace = original.trace
      resetModules()
    },
  }
}

test('low battery shows one notice, then hides only its own balloon', () => {
  const h = lowBatteryHarness({ level: () => 5 })
  try {
    h.advance(6000)
    assert.equal(h.balloons.length, 1)
    assert.equal(h.hides(), 0, 'balloon is visible right after the notice')
    h.advance(10000)
    assert.equal(h.hides(), 1, 'the notice balloon disappears on its own')
    h.advance(10 * 60000)
    assert.equal(h.balloons.length, 1, 'the notice is not repeated while the battery stays low')
  } finally {
    h.restore()
  }
})

test('the notice timer does not hide a balloon it did not show, and close cancels it', () => {
  let level = 90
  const h = lowBatteryHarness({ level: () => level })
  try {
    h.advance(6000)
    h.advance(120000)
    assert.equal(h.balloons.length, 0)
    assert.equal(h.hides(), 0, 'nothing of ours to hide')
    level = 5
    h.advance(120000)
    assert.equal(h.balloons.length, 1)
    h.close()
    h.advance(60000)
    assert.equal(h.hides(), 0, 'closing cancels the pending hide')
  } finally {
    h.restore()
  }
})

test('while busy the notice is deferred without being consumed, then shown once free', () => {
  let busy = true
  const h = lowBatteryHarness({ level: () => 5, busy: () => busy })
  try {
    h.advance(3 * 60000)
    assert.equal(h.balloons.length, 0)
    busy = false
    h.advance(2 * 60000)
    assert.equal(h.balloons.length, 1)
  } finally {
    h.restore()
  }
})

test('an active conversation defers the notice', () => {
  const h = lowBatteryHarness({ level: () => 5, remoteState: 'listening' })
  try {
    h.advance(3 * 60000)
    assert.equal(h.balloons.length, 0)
  } finally {
    h.restore()
  }
})

test('setting lowBatteryNotice to 0 disables both notice and idle reduction', () => {
  for (const setting of [0, false]) {
    const h = lowBatteryHarness({ level: () => 5, setting })
    try {
      h.advance(10 * 60000)
      assert.equal(h.balloons.length, 0)
      assert.ok(new Set(h.reactions).size > 1, 'ordinary idle variety is kept')
    } finally {
      h.restore()
    }
  }
})

test('low battery stretches idle gaps and narrows the candidates', () => {
  const normal = lowBatteryHarness({ level: () => 90 })
  let normalReactions: string[]
  try {
    normal.advance(20 * 60000)
    normalReactions = [...normal.reactions]
  } finally {
    normal.restore()
  }
  const low = lowBatteryHarness({ level: () => 5 })
  try {
    low.advance(20 * 60000)
    assert.ok(low.reactions.length > 0)
    assert.ok(low.reactions.length < normalReactions.length, 'fewer idle reactions while low')
    assert.deepEqual(new Set(low.reactions), new Set(['sleepy-yawn']), 'only the calm reaction is used')
    assert.ok(new Set(normalReactions).size > 1, 'normal mode keeps its variety')
  } finally {
    low.restore()
  }
})

test('without a battery reader nothing changes and nothing is shown', () => {
  const h = lowBatteryHarness()
  try {
    h.advance(20 * 60000)
    assert.equal(h.balloons.length, 0)
    assert.ok(h.reactions.length > 0, 'ordinary idle reactions continue')
  } finally {
    h.restore()
  }
})
