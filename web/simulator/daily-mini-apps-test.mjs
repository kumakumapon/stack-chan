import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'
import { dragLcd } from './lcd-test-helpers.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM host first')
const { baseUrl, server } = await startPreview({ port: 8106 })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const pet of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
    const boot = async () => {
      await page
        .getByRole('log')
        .getByText('[main] checking mod override', { exact: false })
        .waitFor({ timeout: 15000 })
      const ready = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
      for (let i = 0; i < 8 && (await ready.count()) === 0; i++) await page.clock.runFor(2000)
      assert((await ready.count()) > 0, 'host boot completes')
      await page.clock.runFor(3000)
    }
    if (pet) {
      await page.goto(`${baseUrl}/mod-gallery/`)
      await page
        .locator('[data-mod-id="sample.stackchan-pet"]')
        .getByRole('button', { name: 'シミュレーターで試す' })
        .click()
      await page.waitForURL(/\/simulator\/\?gallery=sample\.stackchan-pet/)
    } else await page.goto(`${baseUrl}/simulator/`)
    await boot()
    const lcd = page.locator('canvas[aria-hidden="true"]')
    const tap = async (x, y) => {
      await lcd.evaluate(
        (canvas, { x, y }) => {
          const bounds = canvas.getBoundingClientRect()
          for (const type of ['mousedown', 'mouseup'])
            canvas.dispatchEvent(
              new MouseEvent(type, {
                clientX: bounds.left + x,
                clientY: bounds.top + y,
                bubbles: true,
              })
            )
        },
        { x, y }
      )
      await page.clock.runFor(70)
    }
    const saved = (app) => page.evaluate((app) => JSON.parse(localStorage.getItem(`stackchan.${app}.state.v1`)), app)
    const capture = async (name) =>
      writeFileSync(
        join(tmpdir(), `stackchan-daily-${pet ? 'pet' : 'host'}-${name}.png`),
        Buffer.from((await lcd.evaluate((canvas) => canvas.toDataURL('image/png'))).split(',')[1], 'base64')
      )
    const open = async (row) => {
      await tap(160, 110)
      await tap(270, 22)
      if (row >= 4) {
        await dragLcd(page, 215, 60)
        await tap(140, 166)
      } else await tap(140, 74 + row * 44)
    }
    await open(pet ? 4 : 3)
    await capture('quest')
    await tap(140, 84)
    assert.deepEqual((await saved('quest')).done, [true, false, false])
    await tap(140, 120)
    await tap(140, 156)
    assert.equal((await saved('quest')).celebrated, true)
    await capture('quest-complete')
    await tap(140, 156)
    await tap(140, 156)
    assert.equal((await saved('quest')).celebrated, true)
    await tap(22, 22)
    await page.reload()
    await boot()
    await open(pet ? 4 : 3)
    await capture('quest-restored')
    assert.deepEqual((await saved('quest')).done, [true, true, true])
    await tap(22, 22)
    await open(0)
    await tap(140, 84)
    await capture('quiz-question')
    await tap(140, 124)
    await tap(140, 124)
    assert.deepEqual((await saved('quiz')).review, ['sum'])
    await capture('quiz-explanation')
    await page.reload()
    await boot()
    await open(0)
    await tap(140, 84)
    await tap(140, 157)
    assert.deepEqual((await saved('quiz')).review, [])
    for (let index = 0; index < 2; index++) {
      await tap(140, 84)
      await tap(140, 124)
    }
    await tap(140, 84)
    await capture('quiz-result')
    assert.deepEqual((await saved('quest')).done, [true, true, true])
    await tap(22, 22)
    if (pet) {
      await tap(160, 110)
      await tap(270, 22)
      await dragLcd(page, 215, 60)
      await tap(140, 210)
      // Last row is Focus Timer: selecting and starting it proves the drag reached it.
      await tap(82, 120)
      await tap(160, 212)
      assert.equal((await saved('focus')).state, 'running')
      await capture('launcher-last-app')
    }
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`[Daily Mini Apps] ${pet ? 'Pet coexistence and launcher drag' : 'standard host'} passed`)
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
