import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM host first')
assert.ok(existsSync('mod-gallery/samples/stackchan-pet/stackchan-pet.xsa'), 'stage the Pet MOD first')
const { baseUrl, server } = await startPreview({ port: 8108 })
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
      await page
        .locator('[data-mod-id="sample.stackchan-pet"]')
        .getByRole('button', { name: 'シミュレーターで試す' })
        .click()
      await page.waitForURL(/\/simulator\/\?gallery=sample\.stackchan-pet/)
    } else await page.goto(`${baseUrl}/simulator/`)
    await page.getByRole('log').getByText('[main] checking mod override', { exact: false }).waitFor({ timeout: 15000 })
    const ready = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
    for (let i = 0; i < 8 && (await ready.count()) === 0; i++) {
      await page.clock.runFor(2000)
      if ((await page.getByRole('log').innerText()).includes('XS abort')) break
    }
    assert((await ready.count()) > 0, `host must boot: ${await page.getByRole('log').innerText()} ${errors.join('; ')}`)
    await page.clock.runFor(3000)
    if (pet) await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
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
    const open = async () => {
      await tap(160, 110)
      await tap(270, 22)
      await tap(140, pet ? 206 : 162)
    }
    const image = () => lcd.evaluate((canvas) => canvas.toDataURL('image/png'))
    const capture = async (name) =>
      writeFileSync(
        join(tmpdir(), `stackchan-rhythm-${pet ? 'pet' : 'host'}-${name}.png`),
        Buffer.from((await image()).split(',')[1], 'base64')
      )
    const padColor = () =>
      lcd.evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(16, 122, 1, 1).data))
    const won = async () => {
      const [r, g, b] = await padColor()
      if (!(g > r * 1.5 && g > b * 1.2)) await capture('failure')
      assert(g > r * 1.5 && g > b * 1.2, `successful rhythm turns the pad green: ${r},${g},${b}`)
    }
    await open()
    await capture('ready')
    const initial = await image()
    await tap(55, 200)
    await page.clock.runFor(550)
    const [r, g, b] = await padColor()
    assert(g > r * 1.5 && b > g, 'demonstration flashes cyan')
    await capture('cue')
    await page.clock.runFor(2200)
    // 600 ms between press edges, allowing the 70 ms spent delivering each tap.
    await tap(150, 145)
    await page.clock.runFor(530)
    await tap(150, 145)
    await page.clock.runFor(530)
    await tap(150, 145)
    await won()
    await capture('lcd-success')
    await tap(55, 200)
    await page.clock.runFor(3300)
    // Use the simulator's real head-touch bridge and recognizer, not direct game input.
    const head = page.getByRole('button', { name: '頭をタップ', exact: true })
    await head.dispatchEvent('click')
    await page.clock.runFor(600)
    await head.dispatchEvent('click')
    await page.clock.runFor(1200)
    await head.dispatchEvent('click')
    await page.clock.runFor(250)
    await won()
    await capture('head-success')
    // Third round begins with a long gap: deliberately tap too quickly.
    await tap(55, 200)
    await page.clock.runFor(4000)
    await tap(150, 145)
    await page.clock.runFor(200)
    await tap(150, 145)
    const wrong = await padColor()
    assert(wrong[0] > wrong[1] * 1.5, 'wrong rhythm turns the pad red')
    await capture('retry')
    await tap(270, 200) // mute
    await tap(150, 200) // replay the same round
    await page.clock.runFor(600)
    await tap(22, 22) // exit while demonstrating
    await page.clock.runFor(4000)
    await open()
    assert.equal(await image(), initial, 'reopening resets the game and sound switch')
    await tap(22, 22)
    assert.deepEqual(errors, [])
    await context.close()
    console.log(
      `[Rhythm Game] ${pet ? 'Pet coexistence' : 'standard host'}: LCD, head input, retry and disposal passed`
    )
  }
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
