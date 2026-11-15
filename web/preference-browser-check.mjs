import assert from 'node:assert/strict'
import { captureScreenshot } from './test-browser-screenshot.mjs'

/** Exercise the built page and real BLE client against an in-browser UART device.
 * WASM has no Bluetooth radio (its PreferenceServer is a stub); this fixture
 * verifies the form/wire contract, not a physical connection or remote TTS API.
 */
export async function checkPreferenceBrowser(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  let page
  try {
    await context.addInitScript(() => {
      localStorage.setItem('stackchan.locale', 'ja')
      localStorage.setItem('stackchan.theme', 'light')
      const state = {
        values: {
          'wifi.ssid': 'fixture-network',
          'wifi.password': 'fixture-password',
          'driver.type': 'm5stackchan',
          'ui.type': 'simple',
          'ui.language': 'ja',
          'time.timezone': 'delhi',
          'tts.type': 'stackchan-voice',
          'tts.voice': 'cute',
          'tts.speed': '115',
          'tts.volume': '0.5',
          'tts.token': 'fixture-speech-token',
          'conversation.backend': 'none',
          'companion.quietStart': '1337',
          'mcp.token': 'fixture-mcp-token',
        },
        batches: [],
      }
      globalThis.__preferenceFixture = state
      const tx = new EventTarget()
      const notify = (prop, value) => {
        const data = new TextEncoder().encode(JSON.stringify({ prop, value, readOnly: prop === 'driver.type' }))
        const event = new Event('characteristicvaluechanged')
        Object.defineProperty(event, 'target', { value: { value: new DataView(data.buffer) } })
        tx.dispatchEvent(event)
      }
      tx.startNotifications = async () => {
        for (const [prop, value] of Object.entries(state.values)) notify(prop, value)
      }
      let buffer = ''
      const rx = {
        writeValue: async (data) => {
          assertPacket(data)
          buffer += new TextDecoder('utf-8', { fatal: true }).decode(data)
          let message
          try {
            message = JSON.parse(buffer)
          } catch {
            return
          }
          buffer = ''
          if (!message._batch) throw new Error('Expected a preference batch')
          state.batches.push(message._batch)
          for (const [prop, value] of Object.entries(message._batch)) {
            if (prop === 'driver.type') throw new Error('The fixed driver must not be written')
            state.values[prop] = value
            notify(prop, value)
          }
        },
      }
      function assertPacket(data) {
        if (data.byteLength > 128) throw new Error('UART packet exceeds the client limit')
      }
      const device = new EventTarget()
      device.gatt = {
        connected: false,
        connect: async () => {
          device.gatt.connected = true
          buffer = ''
          return {
            getPrimaryService: async () => ({
              getCharacteristic: async (uuid) => (uuid.startsWith('6e400002') ? rx : tx),
            }),
          }
        },
        disconnect: () => {
          device.gatt.connected = false
          device.dispatchEvent(new Event('gattserverdisconnected'))
        },
      }
      Object.defineProperty(navigator, 'bluetooth', {
        configurable: true,
        value: { requestDevice: async () => device },
      })
    })
    page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${baseUrl}/preference/`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'BLEで接続' }).click()
    const timeZone = page.getByRole('combobox', { name: 'タイムゾーン', exact: true })
    await timeZone.getByText(/デリー.*UTC\+05:30/).waitFor()
    assert.equal(await page.locator('[name="driver.offsetPan"], [name="driver.offsetTilt"], #driver\\.type').count(), 0)
    assert.equal(await page.getByLabel('ホスト', { exact: true }).count(), 0)
    assert.equal(await page.getByLabel('Gateway URL', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('combobox', { name: 'おやすみ開始', exact: true }).innerText(), '22:17')

    const choose = async (name, option) => {
      await page.getByRole('combobox', { name, exact: true }).click()
      await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click()
    }
    await choose('タイムゾーン', /ロンドン.*UTC\+00:00/)
    const volume = page.getByLabel('音量（0–1）', { exact: true })
    await volume.fill('0.50')
    await volume.press('ArrowUp')
    assert.equal(await volume.inputValue(), '0.51', 'volume should move in 1% increments')
    await page.getByRole('button', { name: '設定を保存' }).click()
    await page.waitForFunction(() => globalThis.__preferenceFixture.batches.length === 1)
    assert.deepEqual(await page.evaluate(() => globalThis.__preferenceFixture.batches[0]), {
      'time.timezone': 'london',
      'tts.volume': '0.51',
    })
    await page.getByRole('button', { name: '切断', exact: true }).click()
    await page.getByRole('button', { name: 'BLEで接続' }).click()
    await timeZone.getByText(/ロンドン.*UTC\+00:00/).waitFor()
    assert.equal(await volume.inputValue(), '0.51')

    await page.getByRole('combobox', { name: 'サービス', exact: true }).click()
    assert.equal(await page.getByRole('option', { name: 'Google TTS', exact: true }).count(), 0)
    await page.getByRole('option', { name: 'VOICEVOX Web (tts.quest)', exact: true }).click()
    assert.equal(await page.getByLabel('音声サービストークン', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('ホスト', { exact: true }).count(), 0)
    await page.getByLabel('音声サービストークン', { exact: true }).fill('fixture-new-speech-token')
    await page.getByLabel('話者ID', { exact: true }).fill('3')
    await page.getByRole('button', { name: '設定を保存' }).click()
    await page.waitForFunction(() => globalThis.__preferenceFixture.batches.length === 2)
    assert.deepEqual(await page.evaluate(() => globalThis.__preferenceFixture.batches[1]), {
      'tts.type': 'voicevox-web',
      'tts.token': 'fixture-new-speech-token',
      'tts.speakerId': '3',
    })

    await choose('サービス', 'OpenAI')
    assert.equal(await page.getByLabel('話速（標準1）', { exact: true }).inputValue(), '1')
    assert.equal(await page.getByLabel('音声ID', { exact: true }).inputValue(), 'alloy')
    assert.equal(await page.getByLabel('音声モデル', { exact: true }).inputValue(), 'tts-1')
    assert.equal(await page.getByLabel('音声サービストークン', { exact: true }).inputValue(), '')
    await page.getByLabel('音声への指示（対応モデルのみ）', { exact: true }).fill('fixture instructions')
    await choose('会話モード', 'Gateway')
    await page.getByLabel('Gateway URL', { exact: true }).waitFor()
    await choose('会話モード', 'USB')
    assert.equal(await page.getByLabel('Gateway URL', { exact: true }).count(), 0)

    await page.getByText('MOD向けの設定', { exact: true }).click()
    assert.equal(await page.getByLabel('Bearerトークン', { exact: true }).getAttribute('type'), 'password')
    await page.getByText('MOD向けの設定', { exact: true }).click()
    for (const [name, width, height] of [
      ['desktop', 1280, 900],
      ['mobile', 390, 844],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForFunction(() => window.scrollY === 0)
      const layout = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }))
      assert.ok(layout.content <= layout.viewport + 1, `preferences/${name} must not overflow`)
      await captureScreenshot(page, { path: `/tmp/stackchan-preferences-reviewed-${name}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: '切断', exact: true }).click()
    await page.evaluate(() => {
      globalThis.__preferenceFixture.values = { 'tts.type': 'local', 'time.timezone': 'tokyo' }
    })
    await page.getByRole('button', { name: 'BLEで接続' }).click()
    await timeZone.getByText(/東京.*UTC\+09:00/).waitFor()
    assert.equal(await page.getByLabel('パスワード', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Bearerトークン', { exact: true }).inputValue(), '')
    assert.deepEqual(errors, [], 'preference interactions must not raise browser errors')
  } catch (error) {
    if (page) {
      await captureScreenshot(page, { path: '/tmp/stackchan-preferences-reviewed-failure.png', fullPage: true }).catch(
        (captureError) => console.warn(`[preferences] failure screenshot unavailable: ${captureError.message}`)
      )
    }
    throw error
  } finally {
    await context.close()
  }
}
