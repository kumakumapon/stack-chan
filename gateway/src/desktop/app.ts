import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { createLocalWhisperStt, createVoicevoxTts } from '../audio/local-speech.ts'
import { parseGatewayConfig } from '../config.ts'
import type { ConversationCommand } from '../protocol/stackchan-gateway-v1.ts'
import { createGatewayServer, type GatewayServer } from '../server/gateway-server.ts'
import { createDesktopBackend } from './backend.ts'
import { checkProvider, checkSpeech } from './checks.ts'
import { createModelResponder, type ModelResponder } from './model.ts'
import { page, pageScript, pageStyle } from './page.ts'
import { parseReply, REPLY_SCHEMA } from './reply.ts'
import { PROVIDERS, type Provider, parseSettings, record, text } from './settings.ts'
import { openDesktopStore } from './store.ts'

export type DesktopAppOptions = {
  directory: string
  adminPort?: number
  gatewayPort?: number
  gatewayHost?: string
  responder?: ModelResponder
  logger?(message: string): void
  onShutdown?(): void
}

export async function createDesktopApp(options: DesktopAppOptions) {
  const store = await openDesktopStore(options.directory)
  const cliDirectory = join(options.directory, 'cli')
  await mkdir(cliDirectory, { recursive: true })
  const schemaPath = join(options.directory, 'reply.schema.json')
  await writeFile(schemaPath, JSON.stringify(REPLY_SCHEMA), { mode: 0o600 })
  const respond = options.responder ?? createModelResponder({ cwd: cliDirectory, schemaPath })
  const backend = createDesktopBackend(store, respond)
  const stt = createLocalWhisperStt(() => store.settings().speech.sttEndpoint)
  const tts = createVoicevoxTts(() => ({
    endpoint: store.settings().speech.voicevoxEndpoint,
    speakerId: store.settings().speech.speakerId,
  }))
  const csrf = randomBytes(32).toString('hex')
  const diagnostics: Array<{ at: string; type: string; message: string }> = []
  const notify = (type: string, message: string) => {
    diagnostics.push({ at: new Date().toISOString(), type, message: message.slice(0, 500) })
    if (diagnostics.length > 30) diagnostics.shift()
  }
  let gateway!: GatewayServer
  let gatewayPort = options.gatewayPort ?? 8765
  let adminPort = options.adminPort ?? 8766
  let mutationBusy = false
  let closed = false
  let live: { input: string; output: string } = { input: '', output: '' }
  const lifetime = new AbortController()
  const startGateway = async () => {
    const settings = store.settings()
    gateway = createGatewayServer({
      config: parseGatewayConfig({
        gateway: {
          listen: { host: options.gatewayHost ?? '0.0.0.0', port: gatewayPort, path: '/' },
          devices: [{ deviceId: settings.deviceId, token: settings.deviceToken }],
        },
      }),
      backend,
      stt,
      tts,
      logger: options.logger ?? (() => {}),
      onMessage(_deviceId, message) {
        if (message.type === 'agent.error' && typeof message.message === 'string')
          notify(String(message.code), message.message)
        if (message.type === 'transcript.input' && typeof message.text === 'string')
          live = { input: message.text, output: '' }
        if (message.type === 'transcript.output' && typeof message.text === 'string') live.output = message.text
      },
    })
    try {
      gatewayPort = (await gateway.listen()).port
    } catch (error) {
      await gateway.close()
      throw error
    }
  }
  const device = () => gateway.sessions.get(store.settings().deviceId)
  const command = async (action: ConversationCommand['action'], input?: string) => {
    const session = device()
    if (!session?.ready || !session.requestCommand)
      throw new Error('本体が未接続です。画面の接続情報を本体へ設定してください')
    await session.requestCommand({ action, ...(input ? { text: input } : {}) })
  }
  const stopTurn = async () => {
    const session = device()
    if (!session) return
    if (session.controlSupported) await command('interrupt')
    // Even an old firmware must not write stale output after a setting/history change.
    await session.handleFrame(
      JSON.stringify({ schema: 'stackchan.gateway.v1', type: 'response.cancel', requestId: `desktop-${Date.now()}` }),
    )
  }
  const state = () => {
    const session = device()
    const addresses = Object.values(networkInterfaces())
      .flatMap((items) => items ?? [])
      .filter((item) => item.family === 'IPv4' && !item.internal)
      .sort((a, b) => {
        const priority = (address: string) =>
          address.startsWith('192.168.')
            ? 0
            : address.startsWith('10.')
              ? 1
              : /^172\.(1[6-9]|2\d|3[01])\./.test(address)
                ? 2
                : 3
        return priority(a.address) - priority(b.address)
      })
      .map((item) => `ws://${item.address}:${gatewayPort}/`)
    return {
      settings: store.settings(),
      history: store.history(store.settings().deviceId),
      live,
      device: {
        connected: session?.ready ?? false,
        state: session?.state ?? 'disconnected',
        controlSupported: session?.controlSupported ?? false,
      },
      gateway: { port: gatewayPort, endpoints: addresses },
      diagnostics,
    }
  }
  const send = (response: ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(JSON.stringify(value))
  }
  const routes = async (request: IncomingMessage, response: ServerResponse) => {
    const host = request.headers.host
    if (![`127.0.0.1:${adminPort}`, `localhost:${adminPort}`].includes(host ?? ''))
      return send(response, 403, { error: 'このPCの管理画面から操作してください' })
    const origin = request.headers.origin
    if (origin !== undefined && origin !== `http://${host}`)
      return send(response, 403, { error: '別のサイトからのアクセスは許可されません' })
    const path = request.url
    if (request.method === 'GET') {
      const asset =
        path === '/'
          ? [page.replace('__CSRF__', csrf), 'text/html']
          : path === '/app.js'
            ? [pageScript, 'text/javascript']
            : path === '/style.css'
              ? [pageStyle, 'text/css']
              : undefined
      if (asset) {
        response.writeHead(200, {
          'content-type': `${asset[1]}; charset=utf-8`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          'referrer-policy': 'no-referrer',
        })
        response.end(asset[0])
        return
      }
      if (path === '/api/state') return send(response, 200, state())
      if (path === '/health') return send(response, 200, { application: 'stackchan-desktop', ready: true })
      return send(response, 404, { error: 'ページが見つかりません' })
    }
    if (request.method !== 'POST') return send(response, 405, { error: 'POSTで操作してください' })
    if (request.headers['x-stackchan-admin'] !== csrf || request.headers['content-type'] !== 'application/json')
      return send(response, 403, { error: '管理画面を再読み込みしてください' })
    if (mutationBusy) return send(response, 409, { error: '別の操作が処理中です' })
    mutationBusy = true
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > 32768) {
          send(response, 413, { error: '送信内容が長すぎます' })
          return
        }
        chunks.push(chunk as Buffer)
      }
      const input = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (path === '/api/settings') {
        const before = store.settings()
        // Validate before interrupting the user's conversation.
        const next = parseSettings(input)
        await stopTurn()
        await store.update(next)
        if (before.deviceId !== next.deviceId || before.deviceToken !== next.deviceToken) {
          await gateway.close()
          await startGateway()
        }
        notify('settings', '設定を保存しました。次の返答から反映されます')
        send(response, 200, { ok: true })
      } else if (path === '/api/command') {
        if (!['start', 'stop', 'interrupt', 'text'].includes(input.action as string)) throw new Error('操作が不正です')
        await command(
          input.action as ConversationCommand['action'],
          input.action === 'text' ? text(input.text, '発話', 4000) : undefined,
        )
        send(response, 200, { ok: true })
      } else if (path === '/api/history/clear') {
        await stopTurn()
        await store.clear(store.settings().deviceId)
        live = { input: '', output: '' }
        notify('history', '会話履歴を削除しました')
        send(response, 200, { ok: true })
      } else if (path === '/api/check/provider') {
        if (!PROVIDERS.includes(input.provider as Provider)) throw new Error('LLMの種類が不正です')
        send(response, 200, await checkProvider(store.settings(), input.provider as Provider, cliDirectory))
      } else if (path === '/api/check/speech') {
        send(response, 200, await checkSpeech(store.settings()))
      } else if (path === '/api/test') {
        const settings = store.settings()
        const reply = parseReply(
          await respond({
            settings,
            history: store.history(settings.deviceId),
            text: text(input.text, '発話', 4000),
            signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000)]),
          }),
        )
        send(response, 200, reply)
      } else if (path === '/api/shutdown') {
        if (!options.onShutdown) throw new Error('起動ファイルから実行した Gateway だけを終了できます')
        send(response, 200, { ok: true })
        setImmediate(options.onShutdown)
      } else send(response, 404, { error: '操作が見つかりません' })
    } finally {
      mutationBusy = false
    }
  }
  const http = createServer((request, response) => {
    void routes(request, response).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '処理に失敗しました'
      notify('error', message)
      if (!response.headersSent) send(response, 400, { error: message })
      else response.end()
    })
  })
  http.requestTimeout = 15000
  http.headersTimeout = 10000
  await startGateway()
  try {
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(adminPort, '127.0.0.1', () => {
        http.removeListener('error', reject)
        resolve()
      })
    })
  } catch (error) {
    await gateway.close()
    throw error
  }
  const address = http.address()
  if (address && typeof address === 'object') adminPort = address.port
  return {
    url: `http://127.0.0.1:${adminPort}/`,
    gatewayPort,
    store,
    async close() {
      if (closed) return
      closed = true
      lifetime.abort()
      await gateway.close()
      http.closeAllConnections()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
