/**
 * Minimal MCP client over Streamable HTTP.
 *
 * Only `tools/list` and `tools/call` are implemented: the Gateway needs the
 * tool surface of an MCP server, not its resources or prompts. It mirrors what
 * `firmware/host/modules/connectivity/mcp-client/mcp-client.ts` does on the
 * robot, so the same servers work in Direct mode and Gateway mode.
 */

import type { McpToolClient } from './tools/mcp-adapter.ts'

export type McpHttpClientOptions = {
  label: string
  url: string
  token?: string
  fetchImpl?: typeof fetch
  protocolVersion?: string
}

const DEFAULT_PROTOCOL_VERSION = '2025-06-18'

export function createMcpHttpClient(options: McpHttpClientOptions): McpToolClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION
  let nextId = 0
  let sessionId: string | undefined
  let initialized: Promise<void> | undefined

  const call = async (method: string, parameters?: unknown): Promise<unknown> => {
    nextId += 1
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': protocolVersion,
    }
    if (options.token) headers.authorization = `Bearer ${options.token}`
    if (sessionId) headers['mcp-session-id'] = sessionId

    const response = await fetchImpl(options.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method, params: parameters ?? {} }),
    })
    if (!response.ok)
      throw new Error(`MCP ${method} failed on ${options.label}: ${response.status} ${response.statusText}`)
    const assigned = response.headers.get('mcp-session-id')
    if (assigned) sessionId = assigned
    const message = parseRpcBody(await response.text())
    if (message.error) throw new Error(`MCP ${method} failed on ${options.label}: ${message.error.message}`)
    return message.result
  }

  const initialize = async () => {
    await call('initialize', {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'stackchan-conversation-gateway', version: '0.1.0' },
    })
  }

  const ready = () => {
    initialized ??= initialize().catch((error) => {
      initialized = undefined
      throw error
    })
    return initialized
  }

  return {
    label: options.label,
    async listTools() {
      await ready()
      const result = await call('tools/list')
      const tools = (result as { tools?: unknown })?.tools
      if (!Array.isArray(tools)) return { tools: [] }
      return {
        tools: tools.filter(
          (tool): tool is { name: string; description?: string; inputSchema?: unknown } =>
            typeof tool === 'object' && tool !== null && typeof (tool as { name?: unknown }).name === 'string',
        ),
      }
    },
    async callTool(name, parameters) {
      await ready()
      return call('tools/call', { name, arguments: parameters })
    },
  }
}

/**
 * Accepts both a plain JSON body and the SSE framing a Streamable HTTP server
 * may answer with for a single request.
 */
function parseRpcBody(body: string): { result?: unknown; error?: { message: string } } {
  const trimmed = body.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as { result?: unknown; error?: { message: string } }
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (payload.length === 0) continue
    return JSON.parse(payload) as { result?: unknown; error?: { message: string } }
  }
  throw new Error('the MCP server returned an unreadable body')
}
