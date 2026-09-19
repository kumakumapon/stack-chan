import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createGatewayServer } from '../../gateway/dist/server/gateway-server.js'
import { parseGatewayConfig } from '../../gateway/dist/config.js'
import { createNullStt } from '../../gateway/dist/audio/stt.js'
import { createNullTts } from '../../gateway/dist/audio/tts.js'
import { resolveChromium, startPreview } from '../test-preview-server.mjs'

assert.ok(existsSync('simulator/mc.wasm'), 'build the WASM simulator before this test')
const turns = [],
  results = [],
  catalogs = []
const backend = {
  name: 'companion-fixture',
  producesAudio: false,
  async createSession({ onEvent, tools }) {
    catalogs.push(tools.map((tool) => tool.name))
    let finishTool
    return {
      async inputText(text) {
        turns.push(text)
        onEvent({ type: 'transcript', direction: 'input', text, final: true })
        await new Promise((resolve) => setTimeout(resolve, 1000))
        if (text === 'react' || text === 'perform') {
          const pending = new Promise((resolve) => {
            finishTool = resolve
          })
          onEvent({
            type: 'tool.call',
            callId: text,
            name: `stackchan.${text}`,
            arguments: { name: text === 'react' ? 'delighted' : 'happy-dance', intensity: 0.2 },
          })
          await pending
        }
        onEvent({ type: 'text', text: 'こんにちは。', final: true })
        onEvent({ type: 'turn.done' })
      },
      async inputAudio() {},
      async endAudio() {},
      async toolResult(callId, result) {
        results.push({ callId, result })
        finishTool?.()
      },
      async cancel() {
        finishTool?.()
      },
      async close() {
        finishTool?.()
      },
    }
  },
}
const gateway = createGatewayServer({
  config: parseGatewayConfig({
    gateway: {
      listen: { host: '127.0.0.1', port: 0, path: '/' },
      devices: [{ deviceId: 'stackchan-01', token: 'test-only' }],
    },
  }),
  backend,
  stt: createNullStt(),
  tts: createNullTts(),
  logger: () => {},
})
const address = await gateway.listen()
const { baseUrl, server } = await startPreview({ port: 8097 })
let browser
try {
  browser = await chromium.launch({
    executablePath: resolveChromium(),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    const NativeSocket = globalThis.WebSocket
    globalThis.companionFrames = []
    globalThis.WebSocket = class extends NativeSocket {
      send(data) {
        globalThis.companionFrames.push(JSON.parse(data))
        return super.send(data)
      }
    }
  })
  await page.goto(`${baseUrl}/simulator/`)
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByRole('status').filter({ hasText: 'パフォーマンス=greeting' }).waitFor({ timeout: 10000 })
  await page.locator('#conversation-endpoint').fill(`ws://127.0.0.1:${address.port}/`)
  await page.locator('#conversation-token').fill('test-only')
  await page.getByRole('button', { name: '適用して再起動' }).click()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '会話を開始', exact: true }).click()
  const status = page.getByRole('status', { name: 'Conversation status' })
  await status.filter({ hasText: 'listening' }).waitFor({ timeout: 30000 })
  for (const text of ['こんにちは', 'react', 'perform']) {
    await page.getByRole('textbox', { name: 'Conversation text' }).fill(text)
    await page.getByRole('button', { name: '送信', exact: true }).click()
    await status.filter({ hasText: 'recognizing' }).waitFor({ timeout: 10000 })
    await status.filter({ hasText: 'speaking' }).waitFor({ timeout: 10000 })
    await status.filter({ hasText: 'listening' }).waitFor({ timeout: 20000 })
  }
  assert.deepEqual(turns, ['こんにちは', 'react', 'perform'])
  assert.ok(catalogs.some((names) => names.includes('stackchan.react') && names.includes('stackchan.perform')))
  assert.deepEqual(
    results.map((result) => result.callId),
    ['react', 'perform']
  )
  for (const { result } of results) assert.equal(result.ok, true, JSON.stringify(result))
  await page.getByRole('button', { name: '会話を停止', exact: true }).click()
  await status.filter({ hasText: 'standby' }).waitFor()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(tmpdir(), 'stackchan-companion-conversation.png') })
  // Chromium supplies synthetic audio; this test never opens a physical microphone.
  await page.getByLabel('ブラウザのマイク').check()
  await page.getByRole('button', { name: '適用して再起動' }).click()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '会話を開始', exact: true }).click()
  await status.filter({ hasText: 'listening' }).waitFor({ timeout: 30000 })
  await page.waitForFunction(() => globalThis.companionFrames.some((frame) => frame.type === 'audio.input'), null, {
    timeout: 15000,
  })
  await page.getByRole('button', { name: '会話を停止', exact: true }).click()
  await status.filter({ hasText: 'standby' }).waitFor()
  const count = await page.evaluate(
    () => globalThis.companionFrames.filter((frame) => frame.type === 'audio.input').length
  )
  await page.waitForTimeout(250)
  assert.equal(
    await page.evaluate(() => globalThis.companionFrames.filter((frame) => frame.type === 'audio.input').length),
    count
  )
  assert.deepEqual(errors, [])
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await mobile.addInitScript(() => localStorage.setItem('stackchan.locale', 'ja'))
  const mobilePage = await mobile.newPage()
  await mobilePage.goto(`${baseUrl}/simulator/`)
  await mobilePage.getByRole('button', { name: '会話', exact: true }).click()
  await mobilePage.locator('#conversation-endpoint').fill('ws://localhost:8765/')
  await mobilePage.getByRole('button', { name: '操作', exact: true }).click()
  await mobilePage.getByRole('button', { name: '会話', exact: true }).click()
  assert.equal(await mobilePage.locator('#conversation-endpoint').inputValue(), 'ws://localhost:8765/')
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await mobilePage.screenshot({ path: join(tmpdir(), 'stackchan-companion-mobile.png') })
  await mobile.close()
  console.log('Companion WASM: text round trip, named tools, stop, and synthetic microphone passed')
} finally {
  await browser?.close()
  server?.kill()
  await gateway.close()
}
