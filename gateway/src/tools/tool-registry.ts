/**
 * Owns the merged tool set an Agent session sees: Gateway-hosted tools (MCP,
 * built-ins) plus device-hosted tools (`stackchan.*` embodiment, anything else
 * the robot advertises in `session.update`).
 *
 * Registration is last-write-wins per name so a reconnecting MCP server or a
 * fresh device `session.update` can replace a stale definition without the
 * caller having to diff the old set first.
 */

import type { RealtimeToolDeclaration } from '../protocol/realtime-control.ts'
import { EMPTY_TOOL_PARAMETERS, type ToolDefinition, type ToolHost, type ToolPermission } from './tool-types.ts'

export type ToolRegistry = {
  register(tool: ToolDefinition): void
  registerAll(tools: ToolDefinition[]): void
  /** Drops every tool from one host — used when the device retires a tool generation. */
  unregisterHost(host: ToolHost): void
  get(name: string): ToolDefinition | undefined
  /** Stable ordering: gateway-hosted first, then device-hosted, each alphabetical. */
  list(): ToolDefinition[]
  /** A copy of `list()`, safe to hand to an Agent session that must not see later mutations. */
  snapshot(): ToolDefinition[]
}

/**
 * Which tools require the operator's consent before running.
 *
 * Default is `safe`: an operator opts specific tools into approval by naming
 * them (or a trailing `*` prefix) under `command` or `fileChange`.
 */
export type ToolPolicy = {
  requireApproval?: {
    command?: string[]
    fileChange?: string[]
  }
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolDefinition>()

  const list = (): ToolDefinition[] => {
    const gateway = [...tools.values()].filter((tool) => tool.host === 'gateway')
    const device = [...tools.values()].filter((tool) => tool.host === 'device')
    gateway.sort((a, b) => a.name.localeCompare(b.name))
    device.sort((a, b) => a.name.localeCompare(b.name))
    return [...gateway, ...device]
  }

  return {
    register(tool) {
      tools.set(tool.name, tool)
    },
    registerAll(next) {
      for (const tool of next) tools.set(tool.name, tool)
    },
    unregisterHost(host) {
      for (const [name, tool] of tools) if (tool.host === host) tools.delete(name)
    },
    get(name) {
      return tools.get(name)
    },
    list,
    snapshot() {
      return list()
    },
  }
}

/**
 * Converts what the device advertised in `session.update` into device-hosted
 * `ToolDefinition`s. `mcp`-typed declarations are the device's own MCP bridge
 * and are skipped here — the Gateway reaches those servers directly via
 * `mcp-adapter.ts` instead of proxying through the device.
 */
export function toolsFromRealtimeDeclarations(declarations: RealtimeToolDeclaration[]): ToolDefinition[] {
  const result: ToolDefinition[] = []
  for (const declaration of declarations) {
    if (declaration.type !== 'function') continue
    if (!declaration.name) continue
    result.push({
      name: declaration.name,
      description: declaration.description,
      parameters: toParameterSchema(declaration.parameters),
      host: 'device',
      permission: 'safe',
    })
  }
  return result
}

function toParameterSchema(parameters: Record<string, unknown> | undefined): ToolDefinition['parameters'] {
  if (parameters?.type !== 'object' || typeof parameters.properties !== 'object') {
    return EMPTY_TOOL_PARAMETERS
  }
  return parameters as ToolDefinition['parameters']
}

/** Matches `name` against a policy list entry by exact string or trailing `*` prefix wildcard. */
function matches(name: string, patterns: string[] | undefined): boolean {
  if (!patterns) return false
  return patterns.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name))
}

/** Default is `safe`; an operator opts a tool into approval via `policy.requireApproval`. */
export function toolPermissionFor(name: string, policy: ToolPolicy): ToolPermission {
  if (matches(name, policy.requireApproval?.command)) return 'command'
  if (matches(name, policy.requireApproval?.fileChange)) return 'fileChange'
  return 'safe'
}
