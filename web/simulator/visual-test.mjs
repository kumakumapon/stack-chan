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
  const unnamedControls = await page.evaluate(
    () =>
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
// the split dock layout has no space set aside for it. The firmware itself still announces
// readiness the same way on every surface: it prints `[main] app behaviors ready`
// (firmware/host/app/main.ts), and `simulator-engine.mjs` forwards every firmware print into the
// log buffer the dock's "詳細" panel renders. So on mobile we open that panel and wait for that
// exact trace line — which doubles as proof that the panel-gated log actually renders once opened.
const FIRMWARE_READY_TRACE = '[main] app behaviors ready'

// The always-visible "クイック操作" group (前方スワイプ/後方スワイプ/シェイク) renders its own
// シェイク button regardless of dock state, so once the センサー panel's IMU list is open there
// are two buttons named シェイク on the page and a plain name lookup violates Playwright's strict
// mode. Pick the one that isn't a descendant of the quick-actions group — that's the dock control
// issue #32 wants proven reachable, not the always-visible shortcut. Resolving the group through
// `getByRole` (rather than guessing at an `aria-label` attribute) keeps this working whether the
// group's accessible name comes from `aria-label` or `aria-labelledby`.
async function findDockShakeControl(page) {
  const quickActionsGroup = await page.getByRole('group', { name: 'クイック操作' }).elementHandle()
  const candidates = await page.getByRole('button', { name: 'シェイク', exact: true }).all()
  for (const candidate of candidates) {
    const insideQuickActions = await candidate.evaluate(
      (element, group) => Boolean(group?.contains(element)),
      quickActionsGroup
    )
    if (!insideQuickActions) return candidate
  }
  throw new Error('no シェイク control found outside the always-visible クイック操作 group')
}

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
    const stageRegion = page.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' })
    await stageRegion.waitFor()

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

    await assertNoUnnamedControls(page, `${name} (dock closed)`)

    // The firmware log lives behind the dock's "詳細" panel and must not be in the document until
    // that panel is opened — this is the behaviour the split dock layout exists for.
    assert.equal(
      await page.getByRole('log').count(),
      0,
      `${name}: the firmware log must not be in the document before its panel is opened`
    )

    // --- センサー panel: prove the controls near the bottom of a long panel are actually
    // reachable and clickable on a small phone, not merely present in the DOM (issue #32).
    await mobileNav.getByRole('button', { name: 'センサー', exact: true }).click()

    const inCameraButton = page.getByRole('button', { name: 'インカメラ', exact: true })
    await inCameraButton.scrollIntoViewIfNeeded()
    await inCameraButton.click()

    // Headless Chromium has no camera, so `connectCamera` falls back to a synthetic frame by
    // design — we only assert the button can be reached and pressed, never on a permission result.
    const outCameraButton = page.getByRole('button', { name: 'アウトカメラ', exact: true })
    await outCameraButton.scrollIntoViewIfNeeded()
    await outCameraButton.click()

    const outCameraBox = await outCameraButton.boundingBox()
    const sensorViewport = page.viewportSize()
    assert.ok(outCameraBox, `${name}: アウトカメラ must have a bounding box once scrolled into view`)
    assert.ok(
      outCameraBox.y + outCameraBox.height <= sensorViewport.height + 1,
      `${name}: アウトカメラ must land fully inside the viewport, not under browser chrome or a home indicator`
    )

    // Issue #32's central acceptance criterion: the 3D viewport must stay visible and sized while
    // a dock panel is open, not get squeezed to nothing or pushed off-screen by the panel content.
    const stageBoxWithDockOpen = await stageRegion.boundingBox()
    assert.ok(stageBoxWithDockOpen, `${name}: the 3D viewport must still have a bounding box while the dock is open`)
    assert.ok(
      stageBoxWithDockOpen.height > 0,
      `${name}: the 3D viewport must not collapse to zero height while the dock is open`
    )
    assert.ok(
      stageBoxWithDockOpen.y < sensorViewport.height,
      `${name}: the 3D viewport's top edge must stay inside the viewport while the dock is open`
    )
    assert.ok(
      stageBoxWithDockOpen.height >= sensorViewport.height * 0.25,
      `${name}: a dock that grows enough to swallow the stage must fail this check`
    )

    const dockShakeControl = await findDockShakeControl(page)
    await dockShakeControl.click()

    await assertNoUnnamedControls(page, `${name} (センサー dock open)`)

    // --- 詳細 panel: the firmware log now lives here, along with the performance-mode toggle.
    await mobileNav.getByRole('button', { name: '詳細', exact: true }).click()
    await page.getByRole('log').waitFor()
    assert.equal(
      await page.getByRole('log').count(),
      1,
      `${name}: the firmware log must be in the document after its panel is opened`
    )

    // Firmware reaches the running state (the desktop pass's 45s "シミュレーターを実行中" wait,
    // read through the 詳細 panel this surface actually renders — see FIRMWARE_READY_TRACE above).
    await page.getByRole('log').getByText(FIRMWARE_READY_TRACE, { exact: false }).waitFor({ timeout: 45_000 })

    await assertNoUnnamedControls(page, `${name} (詳細 dock open)`)

    const desktopModeButton = page.getByRole('button', { name: 'デスクトップ', exact: true })
    await desktopModeButton.scrollIntoViewIfNeeded()
    await desktopModeButton.click()
    const mobileModeButton = page.getByRole('button', { name: 'モバイル', exact: true })
    await mobileModeButton.scrollIntoViewIfNeeded()
    await mobileModeButton.click()

    // Issue #32 also requires the running firmware's canvas survive UI switching — a remount
    // would silently reset the simulator every time someone taps a dock tab. Tag the live canvas
    // element, drive it through several tab switches plus a dock close, then confirm the same DOM
    // node (and therefore the same tag) is still there rather than a freshly mounted replacement.
    // The stage section actually holds two canvases (the visible viewport and a hidden off-screen
    // one used for MOD screen capture), so target the aria-labelled viewport canvas specifically —
    // same selector the desktop pass above already relies on — to keep this a single-element match.
    const canvasLocator = page.locator('canvas[aria-label="ｽﾀｯｸﾁｬﾝ3Dシミュレーター"]')
    await canvasLocator.waitFor()
    const canvasTag = await canvasLocator.evaluate((element) => {
      const tag = `visual-test-${Math.random().toString(36).slice(2)}`
      element.dataset.visualTestTag = tag
      return tag
    })

    await mobileNav.getByRole('button', { name: 'MOD', exact: true }).click()
    await mobileNav.getByRole('button', { name: '操作', exact: true }).click()
    await mobileNav.getByRole('button', { name: '詳細', exact: true }).click()
    // 詳細 is now the active panel, so clicking it again closes the dock.
    await mobileNav.getByRole('button', { name: '詳細', exact: true }).click()

    const canvasTagAfterSwitching = await canvasLocator.evaluate((element) => element.dataset.visualTestTag)
    assert.equal(
      canvasTagAfterSwitching,
      canvasTag,
      `${name}: the running firmware's canvas must not be remounted by switching dock panels`
    )

    assert.deepEqual(errors, [], `${name}: must not raise uncaught errors`)

    await page.screenshot({ path: screenshotPath, fullPage: true })
    // A green job should say which layouts it actually exercised. This test exits 0 when the
    // WASM build is missing, so without a line per pass "web-visual passed" cannot be told
    // apart from "web-visual skipped everything".
    console.log(`WASM simulator visual test: ${name} pass ok (${viewport.width}x${viewport.height})`)
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
  console.log('WASM simulator visual test: desktop pass ok (1280x800)')

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
  // Small-phone viewports issue #32 calls out by name — the portrait dock is capped at 40dvh, but
  // on a short screen that cap still leaves less room above it for the 3D viewport to stay usable.
  await runMobileSimulatorPass({
    browser,
    baseUrl,
    name: 'mobile portrait 375x667',
    viewport: { width: 375, height: 667 },
    screenshotPath: '/tmp/stackchan-simulator-mobile-375x667.png',
  })
  await runMobileSimulatorPass({
    browser,
    baseUrl,
    name: 'mobile portrait 360x640',
    viewport: { width: 360, height: 640 },
    screenshotPath: '/tmp/stackchan-simulator-mobile-360x640.png',
  })
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
}
