import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM simulator before this test')
assert.ok(
  existsSync('mod-gallery/samples/stackchan-pet/stackchan-pet.xsa'),
  'stage the Pet Gallery archive before this test'
)

const { baseUrl, server } = await startPreview({ port: 8100 })
let browser
let diagnosticPage
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  diagnosticPage = page
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  await page.goto(`${baseUrl}/mod-gallery/`)
  const petCard = page.locator('[data-mod-id="sample.stackchan-pet"]')
  await petCard.getByText('ｽﾀｯｸﾁｬﾝ Virtual Pet').waitFor()
  const [archiveResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/stackchan-pet.xsa')),
    petCard.getByRole('button', { name: 'シミュレーターで試す' }).click(),
    page.waitForURL(/\/simulator\/\?gallery=sample\.stackchan-pet/),
  ])
  assert.equal(archiveResponse.status(), 200, 'Gallery should serve the Pet archive')
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
  const installed = await page.evaluate(
    () =>
      new Promise((resolveInstalled, reject) => {
        const request = indexedDB.open('stackchan-wasm-mods')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const transaction = request.result.transaction('installed-mods', 'readonly')
          const record = transaction.objectStore('installed-mods').get('installed')
          record.onsuccess = () => resolveInstalled({ name: record.result?.name, size: record.result?.size })
          record.onerror = () => reject(record.error)
        }
      })
  )
  assert.equal(installed.name, 'sample.stackchan-pet.xsa')
  assert.ok(installed.size > 0, 'IndexedDB should retain the Pet archive')
  await page.reload()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '前方スワイプ', exact: true }).first().click()
  // The bridge plays a timed stroke. Wait for its release rather than a fixed
  // delay so browser scheduling cannot cancel the first gesture mid-flight.
  await page.waitForFunction(() => document.querySelector('[role="log"]')?.textContent?.includes('gesture: release'))
  await page.getByRole('button', { name: '後方スワイプ', exact: true }).first().click()
  // The host animates the head for five seconds. Let its pose return before
  // aiming simulated LCD clicks through the 3D viewport.
  await page.waitForFunction(() => document.querySelector('[role="log"]')?.textContent?.includes('restore emotion'))
  await page.waitForTimeout(1200)
  const gestureLog = await page.getByRole('log').innerText()
  assert.match(gestureLog, /gesture: forwardSwipe/)
  assert.match(gestureLog, /gesture: backwardSwipe/)
  assert.match(gestureLog, /petting detected/)
  await page.screenshot({ path: join(tmpdir(), 'stackchan-pet-wasm.png') })
  const lcdImage = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => canvas.toDataURL('image/png'))
  writeFileSync(join(tmpdir(), 'stackchan-pet-lcd.png'), Buffer.from(lcdImage.split(',')[1], 'base64'))
  const stage = page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' })
  await stage.scrollIntoViewIfNeeded()
  const openPetRow = () =>
    page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => {
      const bounds = canvas.getBoundingClientRect()
      for (const type of ['mousedown', 'mouseup'])
        canvas.dispatchEvent(
          new MouseEvent(type, {
            clientX: bounds.left + 140,
            clientY: bounds.top + 118,
            bubbles: true,
          })
        )
    })
  await stage.click({ position: { x: 370, y: 200 } }) // Reveal face AppBar.
  await stage.click({ position: { x: 450, y: 140 } }) // Open Mini App launcher.
  await openPetRow() // Quiz sorts before PET STATUS.
  await page.waitForTimeout(500)
  const statusImage = await page
    .locator('canvas[aria-hidden="true"]')
    .evaluate((canvas) => canvas.toDataURL('image/png'))
  writeFileSync(join(tmpdir(), 'stackchan-pet-status.png'), Buffer.from(statusImage.split(',')[1], 'base64'))
  await page.screenshot({ path: join(tmpdir(), 'stackchan-pet-status-stage.png') })
  const statusPixel = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => {
    const [r, g, b] = canvas.getContext('2d').getImageData(2, 60, 1, 1).data
    return [r, g, b]
  })
  assert.ok(
    statusPixel[0] > 200 && statusPixel[1] > 200 && statusPixel[2] > 180,
    `PET STATUS should render its light background, got ${statusPixel.join(',')}`
  )
  const bondPixels = () =>
    page
      .locator('canvas[aria-hidden="true"]')
      .evaluate((canvas) => Array.from(canvas.getContext('2d').getImageData(85, 75, 100, 18).data))
  const beforeTap = await bondPixels()
  await page.waitForTimeout(5200) // Allow the physical petting cooldown to expire.
  await stage.click({ position: { x: 325, y: 265 } }) // PET button on the LCD.
  await page.waitForTimeout(200)
  const afterTap = await bondPixels()
  const tappedImage = await page
    .locator('canvas[aria-hidden="true"]')
    .evaluate((canvas) => canvas.toDataURL('image/png'))
  writeFileSync(join(tmpdir(), 'stackchan-pet-tapped.png'), Buffer.from(tappedImage.split(',')[1], 'base64'))
  await page.screenshot({ path: join(tmpdir(), 'stackchan-pet-tapped-stage.png') })
  assert.notDeepEqual(afterTap, beforeTap, 'LCD PET should visibly increase the bond value')
  await stage.click({ position: { x: 325, y: 265 } })
  await page.waitForTimeout(200)
  assert.deepEqual(await bondPixels(), afterTap, 'rapid repeated PET taps should not farm bond')
  await page.waitForTimeout(1800) // Pet preferences are saved after a debounce.
  await page.reload()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
  await stage.click({ position: { x: 370, y: 200 } })
  await stage.click({ position: { x: 450, y: 140 } })
  await openPetRow()
  await page.waitForTimeout(500)
  assert.deepEqual(await bondPixels(), afterTap, 'reloading the Gallery MOD should retain Pet growth')
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`)
  assert.equal(await page.getByText(/MODエラー/).count(), 0, 'MOD should not report a runtime error')
  assert.doesNotMatch(await page.getByRole('log').innerText(), /# Exception|\[main\] error/)
} catch (error) {
  if (diagnosticPage) {
    console.error(await diagnosticPage.locator('body').innerText())
    await diagnosticPage.screenshot({ path: join(tmpdir(), 'stackchan-pet-failure.png') })
  }
  throw error
} finally {
  await browser?.close()
  server?.kill()
}
