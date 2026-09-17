import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

import { resolveChromium, startPreview } from '../test-preview-server.mjs'

if (!existsSync('simulator/mc.js') || !existsSync('simulator/mc.wasm')) {
  console.log('WASM simulator visual test skipped: run firmware npm run build:wasm first')
  process.exit(0)
}

const port = Number(process.env.STACKCHAN_SIMULATOR_TEST_PORT ?? 8098)
const executablePath = resolveChromium()
const { baseUrl, server } = await startPreview({
  port,
  url: process.env.STACKCHAN_SIMULATOR_TEST_URL,
})

// Shared with the mobile passes below: every visible control must expose an accessible name.
// Same check `visual-pages-test.mjs` runs across its viewport sweep.
async function assertNoUnnamedControls(page, label) {
  const unnamedControls = await page.evaluate(() =>
    [...document.querySelectorAll('button, a[href], input, select')].filter(
      (element) =>
        element.getClientRects().length > 0 &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !(
          element.getAttribute('aria-label') ||
          ('labels' in element && element.labels?.length) ||
          element.getAttribute('title') ||
          element.textContent?.trim() ||
          element.getAttribute('placeholder')
        )
    ).length
  )
  assert.equal(unnamedControls, 0, `${label} must give every visible control an accessible name`)
}

async function assertNoHorizontalOverflow(page, label) {
  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))
  assert.ok(layout.documentWidth <= layout.viewportWidth + 1, `${label} must not overflow horizontally`)
}

// The desktop pass below waits for the "シミュレーターを実行中" OperationStatus text, but
// SimulatorMobileSurface never renders that component at all (see simulator-mobile-surface.tsx) —
// the sheet-based layout has no space set aside for it. The firmware itself still announces
// readiness the same way on every surface: it prints `[main] app behaviors ready`
// (firmware/host/app/main.ts), and `simulator-engine.mjs` forwards every firmware print into the
// log buffer the log tab renders. So on mobile we open the log tab and wait for that exact trace
// line — which doubles as proof that the tab-gated log actually renders once opened.
const FIRMWARE_READY_TRACE = '[main] app behaviors ready'

// Playwright's default browser context reports `pointer: fine`, so a plain viewport resize to
// phone dimensions still renders SimulatorSurface (the desktop layout) because
// `simulator-page.tsx` picks a surface with `(pointer: coarse) and (max-width: 1023px)`. Only a
// context with `hasTouch: true` (and `isMobile: true`, which Chromium alone accepts) makes
// `(pointer: coarse)` actually match, so each mobile pass gets its own such context.
async function runMobileSimulatorPass({ browser, baseUrl, name, viewport, screenshotPath }) {
  const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true })
  await context.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const response = await page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })
    assert.equal(response?.ok(), true, `${name}: simulator page should load`)

    // Page loads and the shared 3D viewport region is present (same component/label both surfaces use).
    await page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' }).waitFor()

    await assertNoHorizontalOverflow(page, name)

    // Prove the mobile surface actually mounted, rather than a desktop layout that merely fits a
    // narrow viewport: the bottom tab bar is present and the desktop-only sidebar is not.
    const mobileNav = page.getByRole('navigation', { name: 'シミュレーター操作パネル' })
    await mobileNav.waitFor()
    assert.equal(
      await page.getByRole('complementary', { name: 'シミュレーター操作' }).count(),
      0,
      `${name}: the desktop toolbar sidebar must not render on the mobile surface`
    )

    await assertNoUnnamedControls(page, `${name} (sheet closed)`)

    // The firmware log lives behind the sheet's "ログ" tab and must not be in the document until
    // that tab is opened — this is the behaviour the sheet-based layout exists for.
    assert.equal(
      await page.getByRole('log').count(),
      0,
      `${name}: the firmware log must not be in the document before its tab is opened`
    )

    await mobileNav.getByRole('button', { name: 'ログ', exact: true }).click()
    await page.getByRole('log').waitFor()
    assert.equal(
      await page.getByRole('log').count(),
      1,
      `${name}: the firmware log must be in the document after its tab is opened`
    )

    // Firmware reaches the running state (the desktop pass's 45s "シミュレーターを実行中" wait,
    // read through the log tab this surface actually renders — see FIRMWARE_READY_TRACE above).
    await page
      .getByRole('log')
      .getByText(FIRMWARE_READY_TRACE, { exact: false })
      .waitFor({ timeout: 45_000 })

    await assertNoUnnamedControls(page, `${name} (log tab open)`)

    assert.deepEqual(errors, [], `${name}: must not raise uncaught errors`)

    await page.screenshot({ path: screenshotPath, fullPage: true })
  } catch (error) {
    throw new Error(`mobile simulator visual pass "${name}" failed: ${error.message}`, { cause: error })
  } finally {
    await context.close()
  }
}

let browser
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--use-gl=swiftshader'],
  })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const response = await page.goto(`${baseUrl}/simulator/`, { waitUntil: 'networkidle' })
  assert.equal(response?.ok(), true)
  await page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' }).waitFor()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45_000 })
  assert.equal(await page.locator('canvas[aria-label="ｽﾀｯｸﾁｬﾝ3Dシミュレーター"]').count(), 1)
  assert.equal(await page.getByRole('button', { name: 'カメラを接続' }).count(), 1)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: '/tmp/stackchan-simulator-runtime.png', fullPage: true })

  await runMobileSimulatorPass({
    browser,
    baseUrl,
    name: 'mobile portrait 390x844',
    viewport: { width: 390, height: 844 },
    screenshotPath: '/tmp/stackchan-simulator-mobile-portrait.png',
  })
  await runMobileSimulatorPass({
    browser,
    baseUrl,
    name: 'mobile landscape 844x390',
    viewport: { width: 844, height: 390 },
    screenshotPath: '/tmp/stackchan-simulator-mobile-landscape.png',
  })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
