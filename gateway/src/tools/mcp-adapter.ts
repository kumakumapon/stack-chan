/**
 * Bridges MCP servers into Gateway-hosted `ToolDefinition`s.
 *
 * Mirrors `firmware/host/modules/conversation/mcp-tools.ts` on purpose: same
 * content-array normalization, so a tool behaves identically whether an Agent
 * session or a Direct-mode ChatService calls it.
 */

import { type ToolPolicy, toolPermissionFor } from './tool-registry.ts'
import { EMPTY_TOOL_PARAMETERS, type ToolDefinition } from './tool-types.ts'

export type McpToolClient = {
  readonly label: string
  listTools(): Promise<{ tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }>
  callTool(name: string, parameters: Record<string, unknown>): Promise<unknown>
}

export type McpAdapterOptions = {
  logger?: (message: string) => void
}

/**
 * Builds gateway-hosted tools from every client's `listTools()`. A name that
 * collides across clients already registered is namespaced as
 * `${label}.${name}` so both stay callable; the first client to claim a bare
 * name keeps it.
 *
 * A client whose `listTools()` rejects is logged and skipped — it must not
 * sink tools from the other clients.
 */
export async function createMcpTools(
  clients: McpToolClient[],
  policy: ToolPolicy = {},
  options: McpAdapterOptions = {},
): Promise<ToolDefinition[]> {
  const logger = options.logger ?? (() => {})
  const claimed = new Set<string>()
  const tools: ToolDefinition[] = []

  for (const client of clients) {
    let list: { tools: Array<{ name: string; description?: string; inputSchema?: unknown }> }
    try {
      list = await client.listTools()
    } catch (error) {
      logger(`[mcp-adapter] listTools failed for ${client.label}: ${errorMessage(error)}`)
      continue
    }

    for (const tool of list.tools) {
      const name = claimed.has(tool.name) ? `${client.label}.${tool.name}` : tool.name
      claimed.add(name)
      tools.push({
        name,
        description: tool.description,
        parameters: toParameterSchema(tool.inputSchema),
        host: 'gateway',
        permission: toolPermissionFor(name, policy),
        execute: async (parameters: Record<string, unknown>) =>
          normalizeToolResult(await client.callTool(tool.name, parameters)),
      })
    }
  }

  return tools
}

function toParameterSchema(inputSchema: unknown): ToolDefinition['parameters'] {
  if (!isRecord(inputSchema) || inputSchema.type !== 'object' || !isRecord(inputSchema.properties)) {
    return EMPTY_TOOL_PARAMETERS
  }
  return inputSchema as ToolDefinition['parameters']
}

/** Joins `type: 'text'` content parts with newlines, else falls back to JSON.stringify. */
function normalizeToolResult(result: unknown): string {
  const content = isRecord(result) ? result.content : undefined
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (item): item is { type: string; text: string } =>
          isRecord(item) && item.type === 'text' && typeof item.text === 'string',
      )
      .map((item) => item.text)
      .join('\n')
    if (text.length > 0) return text
  }
  return typeof result === 'string' ? result : JSON.stringify(result)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
