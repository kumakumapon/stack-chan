import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM host first')
assert.ok(existsSync('mod-gallery/samples/stackchan-pet/stackchan-pet.xsa'), 'stage the Pet MOD first')

const { baseUrl, server } = await startPreview({ port: 8104 })
let browser
let diagnosticPage
const key = 'stackchan.focus.state.v1'
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const pet of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    diagnosticPage = page
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
    const ready = async () => {
      const hostReady = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
      await page
        .getByRole('log')
        .getByText('[main] checking mod override', { exact: false })
        .waitFor({ timeout: 15000 })
      // WASM's boot splash also uses the intercepted timer. Drive the clock
      // while waiting so it can finish before the browser's readiness timeout.
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.clock.runFor(2000)
        if ((await hostReady.count()) > 0) {
          await page.clock.runFor(3000) // Finish the greeting and Pet's initial save.
          return
        }
      }
      throw new Error('WASM host did not finish booting under the injected clock')
    }
    await ready()
    if (pet) await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
    console.log(`[Focus Timer] ${pet ? 'Pet' : 'host'} ready`)

    // Dispatch through the real browser LCD input handler. Coordinates are in
    // the native 320x240 screen, independent of the 3D camera's current pose.
    const tap = async (x, y) => {
      await page.locator('canvas[aria-hidden="true"]').evaluate(
        (canvas, point) => {
          const bounds = canvas.getBoundingClientRect()
          const options = { clientX: bounds.left + point.x, clientY: bounds.top + point.y, bubbles: true }
          canvas.dispatchEvent(new MouseEvent('mousedown', options))
          canvas.dispatchEvent(new MouseEvent('mouseup', options))
        },
        { x, y }
      )
      await page.clock.runFor(70)
    }
    const saved = () => page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), key)
    const waitState = async (state) => {
      await page.clock.runFor(70)
      assert.equal((await saved())?.state, state, `LCD operation must persist ${state}`)
    }
    const openTimer = async () => {
      await tap(160, 110) // Reveal face AppBar.
      await tap(270, 22) // Mini App launcher.
      await tap(140, pet ? 162 : 118) // MEMORY also sorts before the timer; PET STATUS is first.
    }
    const pixel = () =>
      page
        .locator('canvas[aria-hidden="true"]')
        .evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(2, 90, 1, 1).data))
    const screenshot = async (name) => {
      const data = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => canvas.toDataURL('image/png'))
      writeFileSync(
        join(tmpdir(), `stackchan-focus-${pet ? 'pet' : 'host'}-${name}.png`),
        Buffer.from(data.split(',')[1], 'base64')
      )
    }

    await openTimer()
    await tap(82, 120) // Select focus 5 minutes.
    await screenshot('ready')
    await tap(160, 212) // Start.
    await waitState('running')
    assert.equal((await saved()).preset, 'focus-5')
    await tap(82, 208) // Pause.
    await waitState('paused')
    await page.clock.fastForward(60000)
    await tap(82, 208) // Resume manually.
    await waitState('running')
    await tap(22, 22) // Close the view without cancelling.
    assert.equal((await saved()).state, 'running')
    let otherScreen
    let petBefore
    if (pet) {
      await tap(160, 110)
      await tap(270, 22)
      await tap(140, 74) // PET STATUS while the timer continues.
      otherScreen = await pixel()
      petBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('stackchan.pet.state.v1')))
    } else otherScreen = await pixel()
    await page.clock.fastForward(301000)
    await waitState('completed')
    console.log(`[Focus Timer] ${pet ? 'Pet' : 'host'} background completion`)
    assert.deepEqual(await pixel(), otherScreen, 'completion must leave the face/other Mini App on screen')
    if (pet) {
      const petAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('stackchan.pet.state.v1')))
      assert.equal(petAfter.xp, petBefore.xp, 'timer completion must not grant Pet XP')
      await tap(22, 22)
    }
    await openTimer()
    await screenshot('done')
    await tap(160, 208) // Start a break explicitly.
    await waitState('running')
    assert.equal((await saved()).preset, 'break-5')
    await tap(240, 208) // Cancel, distinct from Back.
    await waitState('idle')
    await tap(82, 120)
    await tap(160, 212)
    await waitState('running')

    // Deterministically deliver a browser visibility event, then simulate a
    // long RAF stall. Returning must retain a manual-resume pause.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.fastForward(601000)
    await waitState('paused')
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.clock.fastForward(301000)
    assert.equal((await saved()).state, 'paused')
    await screenshot('hidden-paused')
    console.log(`[Focus Timer] ${pet ? 'Pet' : 'host'} hidden pause`)

    await page.reload()
    await ready()
    await waitState('interrupted')
    await openTimer()
    await screenshot('interrupted')
    await tap(82, 208) // Restart from the previous setting, never from an inferred remainder.
    await waitState('running')
    await page.reload()
    await ready()
    await waitState('interrupted')
    await openTimer()
    await tap(82, 208)
    await waitState('running')
    await page.clock.fastForward(301000)
    await waitState('completed')
    await page.reload()
    await ready()
    assert.equal((await saved()).state, 'completed', 'completed reboot remains acknowledgement-only')
    await openTimer()
    await tap(265, 208) // End / acknowledge.
    await waitState('idle')
    assert.equal(errors.length, 0, errors.join('; '))
    assert.doesNotMatch(await page.getByRole('log').innerText(), /\[main\] error|XS abort|stack overflow/)
    console.log(`[Focus Timer] ${pet ? 'Pet' : 'host'} reboot recovery`)
    await context.close()
  }
} catch (error) {
  console.error(error)
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    try {
      console.error(await diagnosticPage.locator('body').innerText())
      const data = await diagnosticPage
        .locator('canvas[aria-hidden="true"]')
        .evaluate((canvas) => canvas.toDataURL('image/png'))
      writeFileSync(join(tmpdir(), 'stackchan-focus-failure.png'), Buffer.from(data.split(',')[1], 'base64'))
    } catch (diagnosticError) {
      console.error('Could not capture the LCD:', diagnosticError)
    }
  }
  throw error
} finally {
  await browser?.close()
  server?.kill()
}
