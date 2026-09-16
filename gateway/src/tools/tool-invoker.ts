/**
 * Runs a single tool call end to end: resolve -> approve (if required) ->
 * bracket with `task.status` -> execute -> normalize the outcome.
 *
 * This is the only place that ties the registry, the approval handshake and
 * the device invocation transport together, so an Agent backend only ever
 * needs to know about `ToolDefinition` and `ToolCallOutcome`.
 */

import type { ApprovalController } from '../approval/approval-controller.ts'
import { type ToolPolicy, type ToolRegistry, toolPermissionFor } from './tool-registry.ts'
import type { ToolCallOutcome } from './tool-types.ts'

export type ToolCall = {
  callId: string
  name: string
  arguments: Record<string, unknown>
}

export type ToolInvoker = {
  invoke(call: ToolCall): Promise<ToolCallOutcome>
}

export type ToolInvokerOptions = {
  registry: ToolRegistry
  approval: ApprovalController
  policy?: ToolPolicy
  invokeDeviceTool(call: ToolCall): Promise<unknown>
  logger?: (message: string) => void
}

export function createToolInvoker(options: ToolInvokerOptions): ToolInvoker {
  const { registry, approval, invokeDeviceTool } = options
  const policy = options.policy ?? {}
  const logger = options.logger ?? (() => {})

  return {
    async invoke(call) {
      const tool = registry.get(call.name)
      if (!tool) return { status: 'error', message: `Unknown tool: ${call.name}` }

      const permission = toolPermissionFor(tool.name, policy)
      if (permission !== 'safe') {
        const decision = await approval.requestApproval({
          kind: permission,
          title: tool.name,
          summary: `Stack-chan wants to run ${tool.name}`,
          detail: JSON.stringify(call.arguments, null, 2),
        })
        if (decision.status !== 'ok') return decision
      }

      const task = approval.beginTask()
      try {
        const result =
          tool.host === 'gateway'
            ? await runGatewayTool(tool.name, tool.execute, call.arguments)
            : await invokeDeviceTool(call)
        return { status: 'ok', result }
      } catch (error) {
        const message = errorMessage(error)
        logger(`[tool-invoker] ${call.name} failed: ${message}`)
        return { status: 'error', message }
      } finally {
        task.end()
      }
    },
  }
}

async function runGatewayTool(
  name: string,
  execute: ((parameters: Record<string, unknown>) => Promise<unknown> | unknown) | undefined,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  if (!execute) throw new Error(`Gateway-hosted tool ${name} has no execute()`)
  return await execute(parameters)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
