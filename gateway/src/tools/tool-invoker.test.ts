import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ApprovalController } from '../approval/approval-controller.ts'
import { createToolInvoker } from './tool-invoker.ts'
import { createToolRegistry } from './tool-registry.ts'
import { EMPTY_TOOL_PARAMETERS, type ToolCallOutcome } from './tool-types.ts'

/** Records the approval/task lifecycle instead of driving the real handshake. */
function createFakeApproval(requestOutcome: ToolCallOutcome = { status: 'ok', result: undefined }) {
  const events: string[] = []
  const controller: ApprovalController = {
    async requestApproval() {
      events.push('requestApproval')
      return requestOutcome
    },
    handleDeviceEvent() {
      return false
    },
    beginTask(requestId = 'task') {
      events.push('running')
      return {
        requestId,
        end() {
          events.push('idle')
        },
      }
    },
    close() {},
  }
  return { controller, events }
}

test('invoking an unknown tool returns an error without touching approval', async () => {
  const registry = createToolRegistry()
  const { controller, events } = createFakeApproval()
  const invoker = createToolInvoker({ registry, approval: controller, invokeDeviceTool: async () => 'unused' })

  const outcome = await invoker.invoke({ callId: '1', name: 'missing', arguments: {} })

  assert.deepEqual(outcome, { status: 'error', message: 'Unknown tool: missing' })
  assert.deepEqual(events, [])
})

test('a safe gateway tool runs without approval, bracketed by task.status', async () => {
  const registry = createToolRegistry()
  registry.register({
    name: 'echo',
    parameters: EMPTY_TOOL_PARAMETERS,
    host: 'gateway',
    permission: 'safe',
    execute: (parameters) => parameters.text,
  })
  const { controller, events } = createFakeApproval()
  const invoker = createToolInvoker({ registry, approval: controller, invokeDeviceTool: async () => 'unused' })

  const outcome = await invoker.invoke({ callId: '1', name: 'echo', arguments: { text: 'hi' } })

  assert.deepEqual(outcome, { status: 'ok', result: 'hi' })
  assert.deepEqual(events, ['running', 'idle'])
})

test('an approval-required tool that is approved requests approval then runs', async () => {
  const registry = createToolRegistry()
  registry.register({
    name: 'danger',
    parameters: EMPTY_TOOL_PARAMETERS,
    host: 'gateway',
    permission: 'safe',
    execute: () => 'done',
  })
  const { controller, events } = createFakeApproval({ status: 'ok', result: undefined })
  const invoker = createToolInvoker({
    registry,
    approval: controller,
    policy: { requireApproval: { command: ['danger'] } },
    invokeDeviceTool: async () => 'unused',
  })

  const outcome = await invoker.invoke({ callId: '1', name: 'danger', arguments: {} })

  assert.deepEqual(outcome, { status: 'ok', result: 'done' })
  assert.deepEqual(events, ['requestApproval', 'running', 'idle'])
})

test('an approval-required tool that is declined short-circuits without running', async () => {
  const registry = createToolRegistry()
  let executed = false
  registry.register({
    name: 'danger',
    parameters: EMPTY_TOOL_PARAMETERS,
    host: 'gateway',
    permission: 'safe',
    execute: () => {
      executed = true
      return 'done'
    },
  })
  const declined: ToolCallOutcome = { status: 'declined', message: 'no' }
  const { controller, events } = createFakeApproval(declined)
  const invoker = createToolInvoker({
    registry,
    approval: controller,
    policy: { requireApproval: { command: ['danger'] } },
    invokeDeviceTool: async () => 'unused',
  })

  const outcome = await invoker.invoke({ callId: '1', name: 'danger', arguments: {} })

  assert.deepEqual(outcome, declined)
  assert.equal(executed, false)
  assert.deepEqual(events, ['requestApproval'])
})

test('a device-hosted tool is routed through invokeDeviceTool, not execute', async () => {
  const registry = createToolRegistry()
  registry.register({
    name: 'stackchan.say',
    parameters: EMPTY_TOOL_PARAMETERS,
    host: 'device',
    permission: 'safe',
  })
  const { controller, events } = createFakeApproval()
  const invoker = createToolInvoker({
    registry,
    approval: controller,
    invokeDeviceTool: async (call) => `said:${call.arguments.text}`,
  })

  const outcome = await invoker.invoke({ callId: '1', name: 'stackchan.say', arguments: { text: 'hi' } })

  assert.deepEqual(outcome, { status: 'ok', result: 'said:hi' })
  assert.deepEqual(events, ['running', 'idle'])
})

test('a throwing tool resolves as an error and still emits task.status idle', async () => {
  const registry = createToolRegistry()
  registry.register({
    name: 'boom',
    parameters: EMPTY_TOOL_PARAMETERS,
    host: 'gateway',
    permission: 'safe',
    execute: () => {
      throw new Error('kaboom')
    },
  })
  const { controller, events } = createFakeApproval()
  const invoker = createToolInvoker({ registry, approval: controller, invokeDeviceTool: async () => 'unused' })

  const outcome = await invoker.invoke({ callId: '1', name: 'boom', arguments: {} })

  assert.deepEqual(outcome, { status: 'error', message: 'kaboom' })
  assert.deepEqual(events, ['running', 'idle'])
})
