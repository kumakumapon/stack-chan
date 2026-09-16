/**
 * Tool boundary shared by the Agent, the MCP adapter and the device.
 *
 * The schema is deliberately `ChatTool`-compatible
 * (`firmware/host/modules/conversation/chat.ts`) so the same tool description
 * serves a Direct-mode ChatService session and a Gateway-mode Agent session.
 */

export type ToolParameterSchema = {
  type: 'object'
  properties: Record<string, { type: string; description?: string; [key: string]: unknown }>
  required?: string[]
  additionalProperties?: boolean
}

/**
 * Where a tool runs.
 * - `device`: hosted by Stack-chan, invoked over the realtime control plane.
 * - `gateway`: hosted in-process (MCP servers, built-ins).
 */
export type ToolHost = 'device' | 'gateway'

/**
 * Whether a call needs the operator's consent on the robot before it runs.
 * `command` and `fileChange` map onto `approval.request.kind`.
 */
export type ToolPermission = 'safe' | 'command' | 'fileChange'

export type ToolDefinition = {
  name: string
  description?: string
  parameters: ToolParameterSchema
  host: ToolHost
  permission: ToolPermission
  /** Present for `gateway`-hosted tools only; device tools are invoked over the wire. */
  execute?: (parameters: Record<string, unknown>) => Promise<unknown> | unknown
}

export type ToolCallOutcome =
  | { status: 'ok'; result: unknown }
  | { status: 'error'; message: string }
  | { status: 'declined'; message: string }

export const EMPTY_TOOL_PARAMETERS: ToolParameterSchema = { type: 'object', properties: {}, required: [] }
