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
