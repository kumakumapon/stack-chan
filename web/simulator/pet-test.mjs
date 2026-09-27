import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const archive = resolve('../firmware/dist/bin/wasm/debug/stackchan_pet/stackchan_pet.xsa')
assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM simulator before this test')
assert.ok(existsSync(archive), 'build the WASM Pet MOD before this test')

const { baseUrl, server } = await startPreview({ port: 8100 })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  await page.goto(`${baseUrl}/simulator/`)
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.locator('input[type="file"][aria-label="MODを追加"]').setInputFiles(archive)
  await page.getByText(/適用済み/).waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '前方スワイプ', exact: true }).first().click()
  await page.getByRole('button', { name: '後方スワイプ', exact: true }).first().click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: join(tmpdir(), 'stackchan-pet-wasm.png') })
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`)
  assert.equal(await page.getByText(/MODエラー/).count(), 0, 'MOD should not report a runtime error')
  assert.doesNotMatch(await page.getByRole('log').innerText(), /# Exception|\[main\] error/)
} finally {
  await browser?.close()
  await new Promise((resolveClose) => server.close(resolveClose))
}
