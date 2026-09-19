import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { createGatewayServer } from '../../gateway/dist/server/gateway-server.js'
import { parseGatewayConfig } from '../../gateway/dist/config.js'
import { createNullStt } from '../../gateway/dist/audio/stt.js'
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
        onEvent({ type: 'text', text: text === 'long' ? 'long' : 'こんにちは。', final: true })
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
let streamAudio = false
const syntheticTts = {
  get name() { return streamAudio ? 'synthetic' : 'null' },
  sampleRate: 16000,
  async *synthesize(text, signal) {
    if (!streamAudio) return
    const audio = Int16Array.from({ length: text === 'long' ? 128000 : 8000 }, (_, i) => Math.round(Math.sin(i * 0.1) * 1000))
    if (!signal?.aborted) yield { audio, sampleRate: 16000 }
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
  tts: syntheticTts,
  logger: () => {},
})
const address = await gateway.listen()
const { baseUrl, server } = await startPreview({ port: 8097 })
let browser, diagnosticPage
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
  diagnosticPage = page
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('stackchan.locale', 'ja')
    const NativeSocket = globalThis.WebSocket
    globalThis.companionFrames = []
    globalThis.gatewayFrames = []
    globalThis.playedBuffers = []
    globalThis.stoppedBuffers = 0
    const start = AudioBufferSourceNode.prototype.start
    const stop = AudioBufferSourceNode.prototype.stop
    AudioBufferSourceNode.prototype.start = function (...args) {
      globalThis.playedBuffers.push({ duration: this.buffer?.duration, time: performance.now() })
      return start.apply(this, args)
    }
    AudioBufferSourceNode.prototype.stop = function (...args) {
      globalThis.stoppedBuffers++
      return stop.apply(this, args)
    }
    globalThis.WebSocket = class extends NativeSocket {
      constructor(...args) {
        super(...args)
        this.addEventListener('message', (event) => globalThis.gatewayFrames.push(JSON.parse(event.data)))
      }
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
  assert.equal(await status.locator('..').getByRole('alert').count(), 0, 'stop must not report a firmware cleanup error')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(tmpdir(), 'stackchan-companion-conversation.png') })
  // Negotiate streamed output and verify the real WASM sink, browser scheduling,
  // cancellation acknowledgement, and a fresh turn after interruption.
  streamAudio = true
  await page.getByRole('button', { name: '適用して再起動' }).click()
  await page.getByText('シミュレーターを実行中').waitFor({ timeout: 45000 })
  await page.getByRole('button', { name: '会話を開始', exact: true }).click()
  await status.filter({ hasText: 'listening' }).waitFor({ timeout: 30000 })
  await page.evaluate(() => { globalThis.playedBuffers = []; globalThis.gatewayFrames = [] })
  await page.getByRole('textbox', { name: 'Conversation text' }).fill('long')
  await page.getByRole('button', { name: '送信', exact: true }).click()
  await page.waitForFunction(() => globalThis.playedBuffers.some((buffer) => buffer.duration > 0 && buffer.duration < 0.1))
  assert.equal(await page.evaluate(() => globalThis.gatewayFrames.some((frame) => frame.type === 'audio.completed')), false)
  await page.getByRole('button', { name: '応答を中断', exact: true }).click()
  await status.filter({ hasText: 'listening' }).waitFor({ timeout: 10000 })
  assert.ok(await page.evaluate(() => globalThis.gatewayFrames.some((frame) => frame.type === 'response.cancelled')))
  const interruptedCount = await page.evaluate(() => globalThis.playedBuffers.length)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => globalThis.playedBuffers.length), interruptedCount)
  await page.getByRole('textbox', { name: 'Conversation text' }).fill('again')
  await page.getByRole('button', { name: '送信', exact: true }).click()
  await status.filter({ hasText: 'speaking' }).waitFor({ timeout: 10000 })
  await status.filter({ hasText: 'listening' }).waitFor({ timeout: 10000 })
  assert.ok(await page.evaluate(() => globalThis.gatewayFrames.some((frame) => frame.type === 'audio.completed')))
  await page.getByRole('button', { name: '会話を停止', exact: true }).click()
  await status.filter({ hasText: 'standby' }).waitFor()
  assert.equal(await status.locator('..').getByRole('alert').count(), 0, 'stop must not report a firmware cleanup error')
  await page.screenshot({ path: join(tmpdir(), 'stackchan-gateway-stream-interrupt.png') })
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
  assert.equal(await status.locator('..').getByRole('alert').count(), 0, 'stop must not report a firmware cleanup error')
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
  console.log('Companion WASM: text round trip, named tools, streamed PCM, interruption, restart, stop, and synthetic microphone passed')
} catch (error) {
  if (diagnosticPage) {
    console.error(await diagnosticPage.locator('body').innerText())
    await diagnosticPage.screenshot({ path: join(tmpdir(), 'stackchan-companion-failure.png') })
  }
  throw error
} finally {
  await browser?.close()
  server?.kill()
  await gateway.close()
}
