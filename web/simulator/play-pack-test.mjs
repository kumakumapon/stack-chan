import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'
import { launcherRow, tapLauncherRow } from './lcd-test-helpers.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM host first')
assert.ok(existsSync('mod-gallery/samples/stackchan-pet/stackchan-pet.xsa'), 'stage the Pet MOD first')
const { baseUrl, server } = await startPreview({ port: 8109 })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const pet of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
    const boot = async (navigate = true) => {
      if (!navigate) {
        // Reloading keeps the current simulator URL, including the Gallery MOD.
      } else if (pet) {
        await page.goto(`${baseUrl}/mod-gallery/`)
        await page
          .locator('[data-mod-id="sample.stackchan-pet"]')
          .getByRole('button', { name: 'シミュレーターで試す' })
          .click()
        await page.waitForURL(/\/simulator\/\?gallery=sample\.stackchan-pet/)
      } else await page.goto(`${baseUrl}/simulator/`)
      await page
        .getByRole('log')
        .getByText('[main] checking mod override', { exact: false })
        .waitFor({ timeout: 15000 })
      const ready = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
      for (let i = 0; i < 8 && (await ready.count()) === 0; i++) {
        await page.clock.runFor(2000)
        if ((await page.getByRole('log').innerText()).includes('XS abort')) break
      }
      assert(
        (await ready.count()) > 0,
        `host must boot: ${await page.getByRole('log').innerText()} ${errors.join('; ')}`
      )
      await page.clock.runFor(3000)
      if (pet) await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
    }
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
    const open = async (app) => {
      await tap(160, 110) // Reveal the face AppBar.
      await tap(270, 22) // Mini App launcher.
      await tapLauncherRow(page, tap, launcherRow(app, pet))
    }
    const pixel = (x, y) =>
      lcd.evaluate((canvas, point) => Array.from(canvas.getContext('2d').getImageData(point.x, point.y, 1, 1).data), {
        x,
        y,
      })
    const isAccent = ([r, g, b]) => b > r * 2 && g > r * 1.5
    const isGreen = ([r, g, b]) => g > r * 1.5 && g > b * 1.2
    const isRed = ([r, g, b]) => r > g * 1.8 && r > b * 1.8
    const capture = async (name) =>
      writeFileSync(
        join(tmpdir(), `stackchan-play-${pet ? 'pet' : 'host'}-${name}.png`),
        Buffer.from((await lcd.evaluate((canvas) => canvas.toDataURL('image/png'))).split(',')[1], 'base64')
      )
    const saved = (domain) => page.evaluate((name) => localStorage.getItem(name), `stackchan.workshop.${domain}.state`)

    // Janken: the hands are random, so follow the phases on screen until a "hoi".
    await open('janken')
    await capture('janken-ready')
    await tap(80, 198) // Start.
    await page.clock.runFor(800)
    await capture('janken-choose')
    let hoi = false
    for (let attempt = 0; attempt < 12 && !hoi; attempt++) {
      await tap(56, 198) // Rock; a draw returns to choosing.
      await capture(`janken-reveal-${attempt}`)
      await page.clock.runFor(2000)
      hoi = isAccent(await pixel(12, 180)) // Corner of the left pad, clear of its label.
    }
    assert(hoi, 'a decided throw offers the direction pads')
    await capture('janken-hoi')
    await tap(122, 198) // Up.
    await capture('janken-hoi-reveal')
    await page.clock.runFor(1500)
    await tap(22, 22) // Back while playing.
    await page.clock.runFor(4000)

    // Quick tap: wait for the green signal on the LCD, then answer by LCD or head touch.
    await open('quick-tap')
    await capture('quicktap-ready')
    await tap(80, 202) // Start.
    const head = page.getByRole('button', { name: '頭をタップ', exact: true })
    for (let round = 0; round < 5; round++) {
      let green = false
      for (let step = 0; step < 50 && !green; step++) {
        await page.clock.runFor(100)
        green = isGreen(await pixel(16, 110))
      }
      assert(green, `round ${round + 1} shows the signal`)
      if (round === 0) await capture('quicktap-go')
      // Leave a human-scale gap after the signal so a hit is not judged as anticipation.
      await page.clock.runFor(150)
      if (round === 1) await head.dispatchEvent('click')
      else await tap(160, 138)
      if (round === 0) await capture('quicktap-hit')
      await page.clock.runFor(1400)
    }
    await capture('quicktap-complete')
    const record = Number(await saved('sc_quicktap'))
    assert(Number.isInteger(record) && record >= 100 && record <= 1500, `a set saves the personal best: ${record}`)
    await tap(22, 22)

    // Fortune: one saved slip per local day, shown again on reopening and after reload.
    await open('fortune')
    assert(isRed(await pixel(160, 110)), 'the fortune box is shown')
    await capture('fortune-ready')
    await tap(160, 216) // Draw.
    await page.clock.runFor(1500)
    await capture('fortune-revealed')
    const slip = JSON.parse(await saved('sc_fortune'))
    assert.equal(slip.version, 1, 'the slip is saved for the day')
    await tap(160, 216) // Drawing again today is disabled.
    await page.clock.runFor(1500)
    assert.deepEqual(JSON.parse(await saved('sc_fortune')), slip, 'one slip per day')
    await tap(22, 22)
    await page.reload()
    await boot(false)
    await open('fortune')
    assert(!isRed(await pixel(160, 110)), "after a reload today's slip replaces the box")
    await capture('fortune-reopened')
    await tap(22, 22)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`[Play Pack] ${pet ? 'Pet coexistence' : 'standard host'}: janken, quick tap and fortune passed`)
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
