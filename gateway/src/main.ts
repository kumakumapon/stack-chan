#!/usr/bin/env node
/**
 * Gateway entry point.
 *
 *   stackchan-gateway [path/to/gateway.yaml]
 *
 * With no config file the Gateway starts with the offline `echo` backend, which
 * is enough to bring a Stack-chan through the whole Phase 0 text flow without
 * any cloud credentials.
 */

import { readFile } from 'node:fs/promises'
import { createAgentBackend } from './agent/registry.ts'
import { createNullStt, createOpenAiStt } from './audio/stt.ts'
import { createNullTts, createOpenAiTts } from './audio/tts.ts'
import { type GatewayConfig, parseGatewayConfig, parseGatewayConfigFile } from './config.ts'
import { createMcpHttpClient } from './mcp-http-client.ts'
import { createGatewayServer } from './server/gateway-server.ts'
import { createMcpTools } from './tools/mcp-adapter.ts'
import type { ToolDefinition } from './tools/tool-types.ts'

async function loadConfig(path: string | undefined): Promise<GatewayConfig> {
  if (!path) return parseGatewayConfig({}, process.env)
  return parseGatewayConfigFile(await readFile(path, 'utf8'), process.env)
}

async function main(): Promise<void> {
  const log = (message: string) => console.log(message)
  const path = process.argv[2] ?? process.env.STACKCHAN_GATEWAY_CONFIG
  const config = await loadConfig(path)

  const backend = createAgentBackend(config.agent)
  const stt =
    config.stt.type === 'openai'
      ? createOpenAiStt({
          apiKey: requireField(config.stt.apiKey, 'stt.apiKey'),
          ...(config.stt.model === undefined ? {} : { model: config.stt.model }),
          ...(config.stt.baseUrl === undefined ? {} : { baseUrl: config.stt.baseUrl }),
          ...(config.stt.language === undefined ? {} : { language: config.stt.language }),
        })
      : createNullStt()
  const tts =
    config.tts.type === 'openai'
      ? createOpenAiTts({
          apiKey: requireField(config.tts.apiKey, 'tts.apiKey'),
          ...(config.tts.model === undefined ? {} : { model: config.tts.model }),
          ...(config.tts.voice === undefined ? {} : { voice: config.tts.voice }),
          ...(config.tts.baseUrl === undefined ? {} : { baseUrl: config.tts.baseUrl }),
        })
      : createNullTts()

  let gatewayTools: ToolDefinition[] = []
  if (config.tools.mcp && config.tools.servers.length > 0) {
    gatewayTools = await createMcpTools(
      config.tools.servers.map((server) =>
        createMcpHttpClient({
          label: server.label,
          url: server.url,
          ...(server.token === undefined ? {} : { token: server.token }),
        }),
      ),
      config.tools.policy,
      { logger: log },
    )
    log(`[gateway] registered ${gatewayTools.length} MCP tool(s)`)
  }

  const server = createGatewayServer({ config, backend, stt, tts, gatewayTools, logger: log })
  const address = await server.listen()
  log(`[gateway] listening on ws://${address.host}:${address.port}${address.path} with the ${backend.name} backend`)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    log('[gateway] shutting down')
    void server.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error)
        process.exit(1)
      },
    )
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

function requireField(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for the configured adapter`)
  return value
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
