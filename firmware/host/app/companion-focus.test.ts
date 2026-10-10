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
writeAliasPackage(hostRoot, 'companion-time', resolve(appRoot, 'companion-time.js'))
writeAliasPackage(hostRoot, 'timezone-model', resolve(compiledHost, 'modules/preferences/timezone-model.js'))
writeAliasPackage(hostRoot, 'modules', resolve(compiledHost, 'modules/testing/fakes/modules.js'), {
  hasDefaultExport: true,
})
writeAliasPackage(hostRoot, 'timer', resolve(compiledHost, 'modules/testing/fakes/timer.js'), {
  hasDefaultExport: true,
})
const { default: Timer } = await import('../modules/testing/fakes/timer.js')
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

const SYNCED_MIDNIGHT_UTC = Date.UTC(2026, 9, 11, 0, 0, 0)
// 14:00 UTC is 23:00 in Tokyo (inside the default quiet window) and 14:00 in London (outside).
const NIGHT_JST = SYNCED_MIDNIGHT_UTC + 14 * 3600000

type Harness = {
  reactions: { name: string; intensity?: number }[]
  performances: string[]
  advance(ms: number): void
  close(): void
}

/** Boots Companion with a stubbed clock; `epoch` is the Date.now() value at install. */
function boot(epoch: number, settings: Record<string, unknown>, timezone: string | undefined, tts = 'local'): Harness {
  Timer.reset()
  let now = epoch
  const reactions: Harness['reactions'] = []
  const performances: string[] = []
  let close: (() => void) | undefined
  const robot = {
    ui: { application: { behavior: { companionIdle: true } }, closeDrawer: () => undefined, showFace: () => undefined },
    conversation: {},
    audio: { isActive: false },
    reaction: {
      status: () => ({}),
      play: (name: string, options?: { intensity?: number }) => reactions.push({ name, intensity: options?.intensity }),
    },
    performance: {
      status: () => ({}),
      play: (name: string) => {
        performances.push(name)
        return { ok: true }
      },
    },
    drawer: { addDrawerButton: () => undefined },
    lifecycle: {
      onClose: (handler: () => void) => {
        close = handler
      },
    },
  }
  Date.now = () => now
  Math.random = () => 0
  globalThis.trace = () => undefined
  installCompanion(robot, {
    config: { companion: settings, time: timezone ? { timezone } : undefined, tts: { type: tts } },
  })
  return {
    reactions,
    performances,
    advance(ms) {
      now += ms
      Timer.advance(ms)
    },
    close: () => close?.(),
  }
}

function withClock(run: () => void) {
  const originalNow = Date.now
  const originalRandom = Math.random
  const originalTrace = globalThis.trace
  try {
    run()
  } finally {
    Date.now = originalNow
    Math.random = originalRandom
    globalThis.trace = originalTrace
  }
}

test('idle reactions: unsynced clock keeps the legacy candidates and intensity even when quiet hours are on', () => {
  withClock(() => {
    const h = boot(0, { greetingOnBoot: false, idleReactions: true, quietHours: 1 }, 'tokyo')
    h.advance(60000)
    assert.deepEqual(h.reactions, [{ name: 'yes', intensity: 0.2 }])
    h.close()
  })
})

test('idle reactions: synced quiet hours use only sleepy-yawn at low intensity', () => {
  withClock(() => {
    const h = boot(NIGHT_JST, { greetingOnBoot: false, idleReactions: true, quietHours: 1 }, 'tokyo')
    h.advance(60000)
    assert.ok(h.reactions.length >= 1)
    assert.deepEqual(new Set(h.reactions.map((r) => r.name)), new Set(['sleepy-yawn']))
    assert.ok(h.reactions.every((r) => r.intensity === 0.1))
    h.close()
  })
})

test('idle reactions: outside the window, or with quiet hours unset, behave as before', () => {
  withClock(() => {
    const outside = boot(NIGHT_JST, { greetingOnBoot: false, idleReactions: true, quietHours: 1 }, 'london')
    outside.advance(60000)
    assert.deepEqual(outside.reactions, [{ name: 'yes', intensity: 0.2 }])
    outside.close()
    const off = boot(NIGHT_JST, { greetingOnBoot: false, idleReactions: true }, 'tokyo')
    off.advance(60000)
    assert.deepEqual(off.reactions, [{ name: 'yes', intensity: 0.2 }])
    off.close()
  })
})

test('idle reactions: missing timezone falls back to the default zone and a custom window is honored', () => {
  withClock(() => {
    const custom = boot(
      NIGHT_JST,
      { greetingOnBoot: false, idleReactions: true, quietHours: 1, quietStart: 0, quietEnd: 1410 },
      undefined,
    )
    custom.advance(60000)
    assert.equal(custom.reactions[0]?.name, 'sleepy-yawn')
    custom.close()
  })
})

test('boot greeting: unsynced clock keeps the legacy path', () => {
  withClock(() => {
    const local = boot(0, { idleReactions: false, quietHours: 1 }, 'tokyo')
    local.advance(800)
    assert.deepEqual(local.reactions, [{ name: 'greeting', intensity: 0.3 }])
    local.close()
    const remote = boot(0, { idleReactions: false, quietHours: 1 }, 'tokyo', 'voicevox')
    remote.advance(800)
    assert.deepEqual(remote.performances, ['greeting'])
    remote.close()
  })
})

test('boot greeting: synced quiet hours play only a faint reaction, never a performance', () => {
  withClock(() => {
    const h = boot(NIGHT_JST, { idleReactions: false, quietHours: 1 }, 'tokyo', 'voicevox')
    h.advance(800)
    assert.deepEqual(h.performances, [])
    assert.deepEqual(h.reactions, [{ name: 'greeting', intensity: 0.1 }])
    h.close()
  })
})

test('boot greeting: a synced morning greets more strongly than a synced day', () => {
  withClock(() => {
    const morning = boot(SYNCED_MIDNIGHT_UTC, { idleReactions: false }, 'tokyo') // 09:00 JST
    morning.advance(800)
    const day = boot(SYNCED_MIDNIGHT_UTC + 3 * 3600000, { idleReactions: false }, 'tokyo') // 12:00 JST
    day.advance(800)
    assert.equal(morning.reactions[0]?.name, 'greeting')
    assert.ok((morning.reactions[0]?.intensity ?? 0) > (day.reactions[0]?.intensity ?? 1))
    morning.close()
    day.close()
  })
})
