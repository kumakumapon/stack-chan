import assert from 'node:assert/strict'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

// mcrun 9.0 has no WASM MOD makefile; the same XS revision's `lin` archive
// contains portable JavaScript bytecode and resources for browser launch.
const archiveRoot = resolve('../firmware/dist/bin/lin')
const archives = existsSync(archiveRoot)
  ? readdirSync(archiveRoot, { recursive: true })
      .filter((name) => name.endsWith('.xsa'))
      .map((name) => resolve(archiveRoot, name))
  : []
const archive = archives.find((name) => name.endsWith('stackchan_pet.xsa')) ?? archives[0]
assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM simulator before this test')
assert.ok(archive && existsSync(archive), `build the WASM Pet MOD before this test; found ${archives.join(', ')}`)

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
  await page.goto(`${baseUrl}/simulator/`)
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.locator('input[type="file"][aria-label="MODを追加"]').setInputFiles(archive)
  await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '前方スワイプ', exact: true }).first().click()
  // The bridge plays a timed stroke; beginning another stroke immediately
  // cancels its pending release instead of forming a gesture pair.
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '後方スワイプ', exact: true }).first().click()
  await page.waitForTimeout(2000)
  const gestureLog = await page.getByRole('log').innerText()
  assert.match(gestureLog, /gesture: forwardSwipe/)
  assert.match(gestureLog, /gesture: backwardSwipe/)
  assert.match(gestureLog, /petting detected/)
  await page.screenshot({ path: join(tmpdir(), 'stackchan-pet-wasm.png') })
  const lcdImage = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => canvas.toDataURL('image/png'))
  writeFileSync(join(tmpdir(), 'stackchan-pet-lcd.png'), Buffer.from(lcdImage.split(',')[1], 'base64'))
  const stage = page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' })
  await stage.scrollIntoViewIfNeeded()
  await stage.click({ position: { x: 370, y: 200 } }) // Reveal face AppBar.
  await stage.click({ position: { x: 450, y: 140 } }) // Open Mini App launcher.
  await stage.click({ position: { x: 370, y: 170 } }) // Open PET STATUS, the only WASM MOD app.
  await page.waitForTimeout(500)
  const statusImage = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => canvas.toDataURL('image/png'))
  writeFileSync(join(tmpdir(), 'stackchan-pet-status.png'), Buffer.from(statusImage.split(',')[1], 'base64'))
  const statusPixel = await page.locator('canvas[aria-hidden="true"]').evaluate((canvas) => {
    const [r, g, b] = canvas.getContext('2d').getImageData(2, 60, 1, 1).data
    return [r, g, b]
  })
  assert.ok(
    statusPixel[0] > 200 && statusPixel[1] > 200 && statusPixel[2] > 180,
    `PET STATUS should render its light background, got ${statusPixel.join(',')}`,
  )
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
