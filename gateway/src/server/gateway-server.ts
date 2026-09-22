/**
 * WebSocket front door.
 *
 * Everything below this file is transport-agnostic, which is what lets the
 * session and conversation layers be unit-tested without a socket.
 */

import { createServer, type Server } from 'node:http'
import { WebSocketServer } from 'ws'
import type { AgentBackend } from '../agent/agent-backend.ts'
import type { SttAdapter } from '../audio/stt.ts'
import type { TtsAdapter } from '../audio/tts.ts'
import type { VadOptions } from '../audio/vad.ts'
import type { GatewayConfig } from '../config.ts'
import type { ToolDefinition } from '../tools/tool-types.ts'
import { createAuthenticator } from './authenticator.ts'
import { createSessionManager, type SessionManager } from './session-manager.ts'

export type GatewayServerOptions = {
  config: GatewayConfig
  backend: AgentBackend
  stt: SttAdapter
  tts: TtsAdapter
  gatewayTools?: ToolDefinition[]
  logger?(message: string): void
  /** Log only frame counts and audio levels, never credentials or transcripts. */
  diagnostics?: boolean
}

export type GatewayServer = {
  readonly sessions: SessionManager
  listen(): Promise<{ host: string; port: number; path: string }>
  close(): Promise<void>
}

/**
 * `config.ts`'s `VadConfig` spells out "Milliseconds" to match the rest of
 * the YAML surface; `audio/vad.ts`'s `VadOptions` abbreviates it to `Ms`.
 * This is the one place that renames between the two.
 */
function vadOptionsFromConfig(vad: GatewayConfig['audio']['vad']): Omit<VadOptions, 'sampleRate'> {
  const options: Omit<VadOptions, 'sampleRate'> = {}
  if (vad.activationLevel !== undefined) options.activationLevel = vad.activationLevel
  if (vad.releaseLevel !== undefined) options.releaseLevel = vad.releaseLevel
  if (vad.hangoverMilliseconds !== undefined) options.hangoverMs = vad.hangoverMilliseconds
  if (vad.minUtteranceMilliseconds !== undefined) options.minUtteranceMs = vad.minUtteranceMilliseconds
  return options
}

export function createGatewayServer(options: GatewayServerOptions): GatewayServer {
  const logger = options.logger ?? ((message: string) => console.log(message))
  const { config } = options
  const vad = vadOptionsFromConfig(config.audio.vad)
  const sessions = createSessionManager({
    backend: options.backend,
    stt: options.stt,
    tts: options.tts,
    authenticate: createAuthenticator({
      devices: config.devices,
      ...(config.token === undefined ? {} : { sharedToken: config.token }),
      allowAnonymous: config.devices.length === 0 && config.token === undefined,
    }),
    ...(options.gatewayTools ? { gatewayTools: options.gatewayTools } : {}),
    instructions:
      config.agent.instructions ??
      'あなたは卓上ロボット「ｽﾀｯｸﾁｬﾝ」。返答は短く自然な会話にしてください。必要なときだけstackchan.reactやstackchan.performで気持ちを表現してください。生のサーボ値を生成せず名前付きの表現を優先してください。',
    policy: config.tools.policy,
    approvalTimeoutMs: config.approvalTimeoutMs,
    ...(Object.keys(vad).length > 0 ? { vad } : {}),
    ...(config.audio.maxUtteranceSeconds === undefined
      ? {}
      : { maxUtteranceSeconds: config.audio.maxUtteranceSeconds }),
    logTranscripts: config.diagnostics.logTranscripts,
    logger,
  })

  let http: Server | undefined
  let wss: WebSocketServer | undefined

  return {
    sessions,
    listen() {
      if (http) throw new Error('the Gateway server is already listening')
      const server = createServer((_request, response) => {
        response.writeHead(426, { 'content-type': 'text/plain' })
        response.end('the Stack-chan Gateway speaks WebSocket only\n')
      })
      const socketServer = new WebSocketServer({ server, path: config.listen.path })
      http = server
      wss = socketServer

      socketServer.on('connection', (socket, request) => {
        const peer = request.socket.remoteAddress ?? 'unknown'
        let frames = 0
        let maxRms = 0
        const diagnosticTimer = options.diagnostics
          ? setInterval(() => {
              logger(`[audio-diagnostic] peer=${peer} frames=${frames} maxRms=${maxRms.toFixed(5)}`)
              frames = 0
              maxRms = 0
            }, 5000)
          : undefined
        const managed = sessions.accept({
          send: (payload) => socket.send(payload),
          close: (code, reason) => socket.close(code ?? 1000, reason ?? ''),
        })
        logger(`[gateway] connection from ${peer}`)
        socket.on('message', (data, isBinary) => {
          if (isBinary) {
            logger('[gateway] dropped a binary frame; the v1 media plane is base64 inside JSON')
            return
          }
          if (options.diagnostics) {
            try {
              const frame = JSON.parse(data.toString())
              if (frame.type === 'audio.input' && typeof frame.payload === 'string') {
                const bytes = Buffer.from(frame.payload, 'base64')
                let sum = 0
                for (let i = 0; i + 1 < bytes.length; i += 2) sum += (bytes.readInt16LE(i) / 32768) ** 2
                maxRms = Math.max(maxRms, Math.sqrt(sum / Math.max(1, Math.floor(bytes.length / 2))))
                frames++
              } else if (
                ['conversation.start', 'conversation.stop', 'audio.input.end', 'session.update'].includes(frame.type)
              ) {
                logger(`[audio-diagnostic] received ${frame.type}`)
              }
            } catch {
              /* Normal frame validation below handles malformed input. */
            }
          }
          void managed.handleFrame(data.toString()).catch((error) => {
            logger(`[gateway] frame handling failed: ${error instanceof Error ? error.message : String(error)}`)
          })
        })
        socket.on('close', () => {
          clearInterval(diagnosticTimer)
          logger(`[gateway] connection from ${peer} closed`)
          void managed.release()
        })
        socket.on('error', (error) => logger(`[gateway] socket error: ${error.message}`))
      })

      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(config.listen.port, config.listen.host, () => {
          server.removeListener('error', reject)
          const address = server.address()
          const port = typeof address === 'object' && address ? address.port : config.listen.port
          resolve({ host: config.listen.host, port, path: config.listen.path })
        })
      })
    },
    async close() {
      await sessions.close()
      const socketServer = wss
      const server = http
      wss = undefined
      http = undefined
      if (socketServer) {
        for (const client of socketServer.clients) client.terminate()
        await new Promise<void>((resolve) => socketServer.close(() => resolve()))
      }
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
