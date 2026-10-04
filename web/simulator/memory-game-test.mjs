import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM host first')
assert.ok(existsSync('mod-gallery/samples/stackchan-pet/stackchan-pet.xsa'), 'stage the Pet MOD first')
const { baseUrl, server } = await startPreview({ port: 8105 })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const pet of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.clock.install()
    await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
    if (pet) {
      await page.goto(`${baseUrl}/mod-gallery/`)
      await page.locator('[data-mod-id="sample.stackchan-pet"]')
        .getByRole('button', { name: 'シミュレーターで試す' }).click()
      await page.waitForURL(/\/simulator\/\?gallery=sample\.stackchan-pet/)
    } else await page.goto(`${baseUrl}/simulator/`)
    await page.getByRole('log').getByText('[main] checking mod override', { exact: false }).waitFor({ timeout: 15000 })
    const ready = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
    for (let attempt = 0; attempt < 8 && await ready.count() === 0; attempt++) await page.clock.runFor(2000)
    assert(await ready.count() > 0, 'host must boot')
    await page.clock.runFor(3000)
    if (pet) await page.getByText(/適用済み/).waitFor({ timeout: 45000 })

    const lcd = page.locator('canvas[aria-hidden="true"]')
    const tap = async (x, y) => {
      await lcd.evaluate((canvas, point) => {
        const bounds = canvas.getBoundingClientRect()
        const event = { clientX: bounds.left + point.x, clientY: bounds.top + point.y, bubbles: true }
        canvas.dispatchEvent(new MouseEvent('mousedown', event))
        canvas.dispatchEvent(new MouseEvent('mouseup', event))
      }, { x, y })
      await page.clock.runFor(70)
    }
    const open = async () => {
      await tap(160, 110)
      await tap(270, 22)
      await tap(140, pet ? 118 : 74)
    }
    const highlighted = async () => lcd.evaluate((canvas) => {
      const ctx = canvas.getContext('2d')
      return [16, 120, 224].findIndex((x) => {
        const [r, g, b] = ctx.getImageData(x, 114, 1, 1).data
        return r === 66 && g === 189 && b === 232
      })
    })
    const image = () => lcd.evaluate((canvas) => canvas.toDataURL('image/png'))
    const capture = async (name) => writeFileSync(
      join(tmpdir(), `stackchan-memory-${pet ? 'pet' : 'host'}-${name}.png`),
      Buffer.from((await image()).split(',')[1], 'base64'),
    )
    await open()
    const initial = await image()
    await capture('ready')
    await tap(70, 206)
    await page.clock.runFor(500)
    const first = await highlighted()
    assert(first >= 0, 'first cue must be visible')
    await capture('cue')
    await page.clock.runFor(1950)
    await tap(56 + first * 104, 136)
    await page.clock.runFor(300)
    await capture('correct')
    // Next replays the first cue, then appends one new cue.
    await tap(70, 206)
    await page.clock.runFor(500)
    assert.equal(await highlighted(), first, 'next round retains the first cue')
    await page.clock.runFor(1950)
    assert(await highlighted() >= 0, 'second cue must be visible')
    await page.clock.runFor(1950)
    await tap(56 + ((first + 1) % 3) * 104, 136)
    await capture('wrong')
    // Enable motion, retry, then exit while a cue is in progress.
    await tap(230, 206)
    await tap(70, 206)
    await page.clock.runFor(500)
    await tap(22, 22)
    await page.clock.runFor(2500)
    await open()
    assert.equal(await image(), initial, 'reopening must reset score, sequence and motion toggle')
    await tap(22, 22)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(`[Memory Game] ${pet ? 'Pet coexistence' : 'standard host'} passed`)
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
