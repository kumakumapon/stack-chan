import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createInbox, handleInbox } from '../../gateway/src/server/inbox.ts'
import { inboxPage } from '../../gateway/src/server/inbox-page.ts'
import { chromium } from 'playwright-core'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

const { baseUrl, server } = await startPreview({ port: 8107 })
const inbox = createInbox({ devices: [{ deviceId: 'stackchan-01', token: 'test-secret' }] })
let polls = 0
const inboxServer = createServer((request, response) => {
  if (request.url === '/inbox') {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(inboxPage)
    return
  }
  if (request.url === '/api/inbox/poll') polls++
  void handleInbox(request, response, inbox, [baseUrl])
})
await new Promise((resolve) => inboxServer.listen(0, '127.0.0.1', resolve))
const inboxUrl = `http://127.0.0.1:${inboxServer.address().port}`
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
  await page.clock.install()
  await page.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const boot = async () => {
    await page.getByRole('log').getByText('[main] checking mod override', { exact: false }).waitFor({ timeout: 20000 })
    const ready = page.getByRole('log').getByText('[main] app behaviors ready', { exact: false })
    for (let i = 0; i < 10 && (await ready.count()) === 0; i++) await page.clock.runFor(2000)
    assert((await ready.count()) > 0, 'host boots')
    await page.clock.runFor(3000)
  }
  await page.goto(`${baseUrl}/simulator/`)
  await boot()
  const lcd = page.locator('canvas[aria-hidden="true"]')
  const tap = async (x, y) => {
    await lcd.evaluate(
      (canvas, { x, y }) => {
        const bounds = canvas.getBoundingClientRect()
        for (const type of ['mousedown', 'mouseup'])
          canvas.dispatchEvent(
            new MouseEvent(type, { clientX: bounds.left + x, clientY: bounds.top + y, bubbles: true })
          )
      },
      { x, y }
    )
    await page.clock.runFor(100)
  }
  const image = () => lcd.evaluate((canvas) => canvas.toDataURL('image/png'))
  const capture = async (name) =>
    writeFileSync(`/tmp/stackchan-workshop-${name}.png`, Buffer.from((await image()).split(',')[1], 'base64'))
  const open = async (row) => {
    await tap(160, 110)
    await tap(270, 22)
    await tap(140, 74 + row * 44)
  }
  if (!process.env.WORKSHOP_STUDIO_ONLY) {
    await open(2)
    await capture('home')
    await tap(140, 58)
    const initial = await image()
    await tap(140, 154)
    await tap(140, 154)
    const friends = await image()
    assert.notEqual(friends, initial)
    await capture('friends')
    await tap(140, 222)
    assert.equal(await image(), initial, 'restart resets story')
    await tap(140, 186)
    await tap(140, 186)
    assert.notEqual(await image(), friends, 'second branch has a different ending')
    await capture('discovery')
    await tap(22, 22)
    await open(2)
    await tap(140, 134)
    await tap(140, 58)
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('stackchan.workshop.sc_workshop.state')))
    assert.equal(settings.gestures, true)
    await capture('settings')
    await tap(22, 22)
    await page.getByText('クイズ教材を作る', { exact: true }).click()
    await page.getByLabel('教材名', { exact: true }).fill('My custom math')
    await page.getByRole('button', { name: 'Simulatorに取り込む', exact: true }).click()
    await page.clock.runFor(200)
    await page.getByRole('status').filter({ hasText: '取り込みました' }).waitFor()
    await page.reload()
    await boot()
    const metadata = await page.evaluate(() => JSON.parse(localStorage.getItem('stackchan.workshop.sc_deck.meta')))
    assert(metadata.count > 0, 'deck persisted')
    await open(0)
    await tap(140, 84)
    await capture('custom-quiz')
    await tap(140, 157)
    const quiz = await page.evaluate(() => JSON.parse(localStorage.getItem('stackchan.workshop.sc_quiz.state')))
    assert(quiz.identity.startsWith('my-quiz:'), 'custom quiz owns separate history')
    await tap(22, 22)
  }
  await page.getByText('仕草ミニスタジオ', { exact: true }).click()
  await page.getByRole('button', { name: '作品を保存', exact: true }).click()
  await page.clock.fastForward(10000)
  await page.clock.runFor(200)
  await page.getByRole('button', { name: '再生', exact: true }).click()
  await page.clock.runFor(250)
  await page.getByRole('status').filter({ hasText: '再生を開始しました' }).waitFor()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.clock.runFor(250)
  await page.getByRole('status').filter({ hasText: '停止しました' }).waitFor()
  await page.clock.fastForward(7000)
  await page.clock.runFor(650)
  assert(
    (await page.getByRole('status').allTextContents()).some((text) => text.includes('パフォーマンス=なし')),
    'stop drops queued cues'
  )
  await page.getByRole('button', { name: '再生', exact: true }).click()
  await page.clock.runFor(650)
  assert(
    (await page.getByRole('status').allTextContents()).some((text) => text.includes('パフォーマンス=studio')),
    'studio owns the timeline'
  )
  await page.clock.fastForward(7000)
  await page.clock.runFor(650)
  assert(
    (await page.getByRole('status').allTextContents()).some((text) => text.includes('パフォーマンス=なし')),
    'browser monotonic clock completes the timeline'
  )
  if (!process.env.WORKSHOP_STUDIO_ONLY) {
    await page.getByText('通知と伝言を受け取る', { exact: true }).click()
    await page.getByLabel('Gateway URL', { exact: true }).fill(inboxUrl)
    await page.getByLabel('Gatewayトークン', { exact: true }).fill('test-secret')
    await page.getByRole('button', { name: '受信を開始', exact: true }).click()
    await page.clock.runFor(200)
    for (let i = 0; i < 10 && polls === 0; i++) {
      await page.waitForTimeout(50)
      await page.clock.runFor(100)
    }
    assert(polls > 0, 'independent inbox transport polls without starting conversation')
    inbox.build('stackchan-01', 'test-secret', 'build-1')
    assert.equal(inbox.build('stackchan-01', 'test-secret', 'build-1').accepted, false)
    await page.clock.fastForward(5000)
    await page.waitForTimeout(100)
    await page.clock.runFor(200)
    await open(2)
    await tap(140, 97)
    await tap(140, 58)
    await capture('notification-list')
    await tap(140, 58)
    await capture('notification')
    await tap(140, 222)
    await tap(140, 218)
    await tap(140, 97)
    const pairResponse = page.waitForResponse((response) => response.url().endsWith('/api/inbox/pair'))
    await tap(140, 180)
    const code = (await (await pairResponse).json()).code
    assert.equal(code.length, 12)
    await page.clock.runFor(200)
    await capture('pairing')
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await phone.goto(inboxUrl + '/inbox')
    await phone.getByLabel('あなたの名前').fill('Friend')
    await phone.getByLabel('登録コード').fill(code)
    await phone.getByRole('button', { name: '登録する', exact: true }).click()
    await phone.getByRole('status').filter({ hasText: '登録しました' }).waitFor()
    await phone.getByLabel('伝えること').selectOption('rest')
    await phone.getByRole('button', { name: '送る', exact: true }).click()
    await phone.getByRole('status').filter({ hasText: '配送待ち' }).waitFor()
    await page.clock.fastForward(5000)
    await page.waitForTimeout(100)
    await page.clock.runFor(200)
    await tap(140, 222)
    await tap(140, 58)
    await tap(140, 98)
    await page.waitForTimeout(100)
    await page.clock.runFor(200)
    await capture('message')
    await tap(140, 155)
    await page.waitForTimeout(100)
    await page.clock.runFor(200)
    await phone.getByText('返事: ありがとう', { exact: true }).waitFor({ timeout: 12000 })
    await tap(140, 186)
    await page.waitForTimeout(100)
    await page.clock.runFor(200)
    await phone.getByText('本体で削除済み', { exact: true }).waitFor({ timeout: 12000 })
    await phone.close()
    console.log('[Workshop] independent build notification, phone pairing, read/reply/delete passed')
  }
  assert.deepEqual(errors, [])
  console.log('[Workshop] branching story, settings, persisted custom quiz and studio play/stop passed')
} finally {
  await browser?.close()
  server?.kill('SIGTERM')
  await new Promise((resolve) => inboxServer.close(resolve))
}
