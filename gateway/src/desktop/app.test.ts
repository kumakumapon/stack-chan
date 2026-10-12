import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { WebSocket } from 'ws'
import { createDesktopApp } from './app.ts'
import type { ModelRequest } from './model.ts'

const reply = JSON.stringify({ text: 'こんにちは。', emotion: 'happy', gesture: 'none', gaze: 'none' })
const PCM16 = { codec: 'pcm16', sampleRate: 16000, channels: 1 }

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return
    await delay(10)
  }
  throw new Error('timed out waiting for state')
}

async function browser(url: string) {
  const page = await (await fetch(url)).text()
  const csrf = page.match(/name="stackchan-csrf" content="([a-f0-9]+)"/)?.[1]
  assert.ok(csrf)
  return async (path: string, input: unknown) => {
    const response = await fetch(`${url.slice(0, -1)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stackchan-admin': csrf },
      body: JSON.stringify(input),
    })
    return { status: response.status, value: (await response.json()) as Record<string, unknown> }
  }
}

test('real HTTP and WebSocket controls share saved history across LLM switches and report old firmware', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-app-'))
  const requests: ModelRequest[] = []
  const app = await createDesktopApp({
    directory,
    adminPort: 0,
    gatewayPort: 0,
    gatewayHost: '127.0.0.1',
    responder: async (request) => {
      requests.push(request)
      return reply
    },
  })
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })
  const post = await browser(app.url)
  const socket = new WebSocket(`ws://127.0.0.1:${app.gatewayPort}/`)
  const frames: Array<Record<string, unknown>> = []
  let commandId = 0
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>
    frames.push(frame)
    if (frame.type !== 'conversation.command') return
    if (frame.action === 'start' || frame.action === 'stop')
      socket.send(
        JSON.stringify({
          schema: 'stackchan.event.v1',
          type: frame.action === 'start' ? 'conversation.start' : 'conversation.stop',
          requestId: `device-${++commandId}`,
          source: 'headTouch',
          gesture: frame.action === 'start' ? 'forwardSwipe' : 'backwardSwipe',
        }),
      )
    else if (frame.action === 'text')
      socket.send(JSON.stringify({ schema: 'stackchan.gateway.v1', type: 'text.input', text: frame.text }))
    else if (frame.action === 'interrupt')
      socket.send(
        JSON.stringify({ schema: 'stackchan.gateway.v1', type: 'response.cancel', requestId: `cancel-${++commandId}` }),
      )
    socket.send(
      JSON.stringify({
        schema: 'stackchan.gateway.v1',
        type: 'conversation.command.result',
        requestId: frame.requestId,
        success: true,
      }),
    )
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  const settings = app.store.settings()
  socket.send(
    JSON.stringify({
      schema: 'stackchan.gateway.v1',
      type: 'session.hello',
      protocolVersion: 1,
      deviceId: settings.deviceId,
      clientId: 'test-device',
      token: settings.deviceToken,
      capabilities: {
        audioInput: [PCM16],
        audioOutput: [PCM16],
        embodiment: [],
        approval: true,
        conversationControl: true,
      },
    }),
  )
  await waitUntil(() => frames.some((frame) => frame.type === 'session.ready'))
  assert.equal((await post('/api/command', { action: 'start' })).status, 200)
  await waitUntil(() => frames.some((frame) => frame.type === 'conversation.result' && frame.state === 'listening'))
  assert.equal((await post('/api/command', { action: 'text', text: '最初の会話' })).status, 200)
  await waitUntil(() => app.store.history(settings.deviceId).length === 1)
  settings.provider = 'lmstudio'
  assert.equal((await post('/api/settings', settings)).status, 200)
  assert.equal((await post('/api/command', { action: 'text', text: '続きを話そう' })).status, 200)
  await waitUntil(() => app.store.history(settings.deviceId).length === 2)
  assert.equal(requests[1]?.settings.provider, 'lmstudio')
  assert.equal(requests[1]?.history[0]?.user, '最初の会話')
  assert.equal((await post('/api/history/clear', {})).status, 200)
  assert.deepEqual(app.store.history(settings.deviceId), [])
  assert.equal((await post('/api/command', { action: 'stop' })).status, 200)
  await waitUntil(() => frames.some((frame) => frame.type === 'conversation.result' && frame.state === 'standby'))
  socket.close()
  await new Promise((resolve) => socket.once('close', resolve))

  // A legacy device can keep its face-tap control, but must never pretend to accept web commands.
  const legacy = new WebSocket(`ws://127.0.0.1:${app.gatewayPort}/`)
  await new Promise<void>((resolve, reject) => {
    legacy.once('open', resolve)
    legacy.once('error', reject)
  })
  const ready = new Promise((resolve) => legacy.once('message', resolve))
  legacy.send(
    JSON.stringify({
      schema: 'stackchan.gateway.v1',
      type: 'session.hello',
      protocolVersion: 1,
      deviceId: settings.deviceId,
      clientId: 'legacy',
      token: settings.deviceToken,
      capabilities: { audioInput: [PCM16], audioOutput: [PCM16], embodiment: [], approval: true },
    }),
  )
  await ready
  const rejected = await post('/api/command', { action: 'start' })
  assert.equal(rejected.status, 400)
  assert.match(String(rejected.value.error), /ファームウェア更新/)
  legacy.close()
})

test('admin server rejects cross-origin, forged Host, and unauthenticated settings changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-admin-'))
  const app = await createDesktopApp({ directory, adminPort: 0, gatewayPort: 0, gatewayHost: '127.0.0.1' })
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })
  assert.equal((await fetch(`${app.url}api/state`, { headers: { origin: 'https://malicious.example' } })).status, 403)
  const forgedHost = await new Promise<number | undefined>((resolve, reject) => {
    const request = httpRequest(`${app.url}api/state`, { headers: { host: 'malicious.example' } }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('error', reject)
    request.end()
  })
  assert.equal(forgedHost, 403)
  const before = app.store.settings()
  assert.equal(
    (
      await fetch(`${app.url}api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...before, name: '不正な変更' }),
      })
    ).status,
    403,
  )
  assert.deepEqual(app.store.settings(), before)
  const post = await browser(app.url)
  assert.equal(
    (await post('/api/settings', { ...before, speech: { ...before.speech, sttEndpoint: 'https://cloud.example' } }))
      .status,
    400,
  )
  assert.deepEqual(app.store.settings(), before)
})

test('local Japanese text test works without a robot and does not write history or actuate the body', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-preview-'))
  const app = await createDesktopApp({
    directory,
    adminPort: 0,
    gatewayPort: 0,
    gatewayHost: '127.0.0.1',
    responder: async () => reply,
  })
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })
  const post = await browser(app.url)
  assert.equal((await post('/api/test', { text: 'こんにちは' })).value.text, 'こんにちは。')
  assert.deepEqual(await (await fetch(`${app.url}health`)).json(), { application: 'stackchan-desktop', ready: true })
  assert.deepEqual(app.store.history(app.store.settings().deviceId), [])
})

test('dashboard shutdown acknowledges the request before notifying its process owner', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-shutdown-'))
  let requested = false
  const app = await createDesktopApp({
    directory,
    adminPort: 0,
    gatewayPort: 0,
    gatewayHost: '127.0.0.1',
    onShutdown: () => {
      requested = true
    },
  })
  t.after(async () => {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  })
  const post = await browser(app.url)
  assert.equal((await post('/api/shutdown', {})).status, 200)
  await waitUntil(() => requested)
})
