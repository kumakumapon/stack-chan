/**
 * Gateway configuration.
 *
 * Cloud credentials live here, on the Gateway, and never on the robot — the
 * device only ever stores its Gateway URL, device id and Gateway token. Every
 * string value may reference an environment variable as `${NAME}` so a config
 * file can be committed without secrets.
 */

import { parse as parseYaml } from 'yaml'
import type { AgentBackendKind } from './agent/registry.ts'
import type { ToolPolicy } from './tools/tool-registry.ts'

export type ListenConfig = {
  host: string
  port: number
  path: string
}

export type DeviceCredential = {
  deviceId: string
  token?: string
}

export type SttConfig = {
  type: 'none' | 'openai'
  apiKey?: string
  model?: string
  baseUrl?: string
  language?: string
}

export type TtsConfig = {
  type: 'none' | 'openai'
  apiKey?: string
  model?: string
  voice?: string
  baseUrl?: string
}

export type AgentConfig = {
  type: AgentBackendKind
  apiKey?: string
  model?: string
  baseUrl?: string
  endpoint?: string
  token?: string
  instructions?: string
}

export type McpServerConfig = {
  label: string
  url: string
  token?: string
}

export type GatewayConfig = {
  listen: ListenConfig
  /** Shared token accepted from any device when no per-device token matches. */
  token?: string
  devices: DeviceCredential[]
  agent: AgentConfig
  stt: SttConfig
  tts: TtsConfig
  tools: {
    mcp: boolean
    servers: McpServerConfig[]
    policy: ToolPolicy
  }
  approvalTimeoutMs: number
}

export const DEFAULT_LISTEN: ListenConfig = { host: '0.0.0.0', port: 8765, path: '/' }
export const DEFAULT_APPROVAL_TIMEOUT_MILLISECONDS = 60_000

export function parseGatewayConfig(raw: unknown, env: Record<string, string | undefined> = {}): GatewayConfig {
  const root = expand(raw, env)
  if (root !== undefined && !isRecord(root)) throw new Error('the Gateway config must be a mapping')
  const source = root ?? {}
  const gateway = record(source.gateway, 'gateway')
  const agent = record(source.agent, 'agent')
  const stt = record(source.stt, 'stt')
  const tts = record(source.tts, 'tts')
  const tools = record(source.tools, 'tools')

  return {
    listen: readListen(gateway.listen),
    ...(optionalString(gateway.token, 'gateway.token') === undefined
      ? {}
      : { token: optionalString(gateway.token, 'gateway.token') }),
    devices: readDevices(gateway.devices),
    agent: readAgent(agent),
    stt: readStt(stt),
    tts: readTts(tts),
    tools: {
      mcp: tools.mcp === true,
      servers: readMcpServers(tools.servers),
      policy: readPolicy(tools.requireApproval),
    },
    approvalTimeoutMs: positiveInteger(tools.approvalTimeoutMs, DEFAULT_APPROVAL_TIMEOUT_MILLISECONDS),
  }
}

export function parseGatewayConfigFile(text: string, env: Record<string, string | undefined> = {}): GatewayConfig {
  return parseGatewayConfig(parseYaml(text) as unknown, env)
}

/**
 * Expands `${NAME}` references in every string. A reference with no value in
 * the environment is an error rather than an empty string, so a missing API key
 * fails at start-up instead of at the first conversation.
 */
function expand(value: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const resolved = env[name]
      if (resolved === undefined) throw new Error(`the Gateway config references an unset variable: ${name}`)
      return resolved
    })
  }
  if (Array.isArray(value)) return value.map((entry) => expand(entry, env))
  if (isRecord(value)) {
    const expanded: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) expanded[key] = expand(entry, env)
    return expanded
  }
  return value
}

function readListen(value: unknown): ListenConfig {
  if (value === undefined) return DEFAULT_LISTEN
  const listen = record(value, 'gateway.listen')
  return {
    host: typeof listen.host === 'string' && listen.host.length > 0 ? listen.host : DEFAULT_LISTEN.host,
    port: port(listen.port, DEFAULT_LISTEN.port),
    path: typeof listen.path === 'string' && listen.path.startsWith('/') ? listen.path : DEFAULT_LISTEN.path,
  }
}

function readDevices(value: unknown): DeviceCredential[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('gateway.devices must be a list')
  return value.map((entry, index) => {
    const device = record(entry, `gateway.devices[${index}]`)
    const deviceId = optionalString(device.deviceId, `gateway.devices[${index}].deviceId`)
    if (!deviceId) throw new Error(`gateway.devices[${index}].deviceId is required`)
    const token = optionalString(device.token, `gateway.devices[${index}].token`)
    return token === undefined ? { deviceId } : { deviceId, token }
  })
}

function readAgent(value: Record<string, unknown>): AgentConfig {
  const type = value.type ?? 'echo'
  if (type !== 'echo' && type !== 'openai' && type !== 'hermes') {
    throw new Error(`agent.type must be one of echo, openai, hermes (received ${String(type)})`)
  }
  const config: AgentConfig = { type }
  assignOptional(config, value, ['apiKey', 'model', 'baseUrl', 'endpoint', 'token', 'instructions'], 'agent')
  return config
}

function readStt(value: Record<string, unknown>): SttConfig {
  const requested = value.type ?? 'none'
  const type = requested === 'auto' ? (value.apiKey ? 'openai' : 'none') : requested
  if (type !== 'none' && type !== 'openai')
    throw new Error(`stt.type must be none, openai or auto (received ${String(requested)})`)
  const config: SttConfig = { type }
  assignOptional(config, value, ['apiKey', 'model', 'baseUrl', 'language'], 'stt')
  return config
}

function readTts(value: Record<string, unknown>): TtsConfig {
  const requested = value.type ?? 'none'
  const type = requested === 'auto' ? (value.apiKey ? 'openai' : 'none') : requested
  if (type !== 'none' && type !== 'openai')
    throw new Error(`tts.type must be none, openai or auto (received ${String(requested)})`)
  const config: TtsConfig = { type }
  assignOptional(config, value, ['apiKey', 'model', 'voice', 'baseUrl'], 'tts')
  return config
}

function readMcpServers(value: unknown): McpServerConfig[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('tools.servers must be a list')
  return value.map((entry, index) => {
    const server = record(entry, `tools.servers[${index}]`)
    const label = optionalString(server.label, `tools.servers[${index}].label`)
    const url = optionalString(server.url, `tools.servers[${index}].url`)
    if (!label || !url) throw new Error(`tools.servers[${index}] requires label and url`)
    const token = optionalString(server.token, `tools.servers[${index}].token`)
    return token === undefined ? { label, url } : { label, url, token }
  })
}

function readPolicy(value: unknown): ToolPolicy {
  if (value === undefined) return {}
  const policy = record(value, 'tools.requireApproval')
  const requireApproval: { command?: string[]; fileChange?: string[] } = {}
  const command = stringList(policy.command, 'tools.requireApproval.command')
  const fileChange = stringList(policy.fileChange, 'tools.requireApproval.fileChange')
  if (command) requireApproval.command = command
  if (fileChange) requireApproval.fileChange = fileChange
  return { requireApproval }
}

function assignOptional<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
  keys: string[],
  scope: string,
): void {
  for (const key of keys) {
    const value = optionalString(source[key], `${scope}.${key}`)
    if (value !== undefined) (target as Record<string, unknown>)[key] = value
  }
}

function stringList(value: unknown, scope: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${scope} must be a list of strings`)
  }
  return [...(value as string[])]
}

function optionalString(value: unknown, scope: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${scope} must be a string`)
  return value
}

/** Port 0 is meaningful: it asks the OS for an ephemeral port. */
function port(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 65_535) {
    throw new Error(`gateway.listen.port must be between 0 and 65535, received ${String(value)}`)
  }
  return value as number
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new Error(`expected a positive integer, received ${String(value)}`)
  return value as number
}

function record(value: unknown, scope: string): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new Error(`${scope} must be a mapping`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
