import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RealtimeToolDeclaration } from '../protocol/realtime-control.ts'
import { createToolRegistry, toolPermissionFor, toolsFromRealtimeDeclarations } from './tool-registry.ts'
import { EMPTY_TOOL_PARAMETERS, type ToolDefinition } from './tool-types.ts'

function gatewayTool(name: string): ToolDefinition {
  return { name, parameters: EMPTY_TOOL_PARAMETERS, host: 'gateway', permission: 'safe', execute: () => 'ok' }
}

function deviceTool(name: string): ToolDefinition {
  return { name, parameters: EMPTY_TOOL_PARAMETERS, host: 'device', permission: 'safe' }
}

test('register replaces an earlier tool of the same name', () => {
  const registry = createToolRegistry()
  registry.register(gatewayTool('a'))
  const replacement: ToolDefinition = { ...gatewayTool('a'), description: 'v2' }
  registry.register(replacement)
  assert.equal(registry.get('a')?.description, 'v2')
  assert.equal(registry.list().length, 1)
})

test('registerAll registers every tool', () => {
  const registry = createToolRegistry()
  registry.registerAll([gatewayTool('a'), gatewayTool('b')])
  assert.deepEqual(
    registry.list().map((tool) => tool.name),
    ['a', 'b'],
  )
})

test('unregisterHost drops only that host', () => {
  const registry = createToolRegistry()
  registry.registerAll([gatewayTool('a'), deviceTool('b')])
  registry.unregisterHost('device')
  assert.deepEqual(
    registry.list().map((tool) => tool.name),
    ['a'],
  )
})

test('list orders gateway tools before device tools, each alphabetical', () => {
  const registry = createToolRegistry()
  registry.registerAll([deviceTool('z'), gatewayTool('b'), deviceTool('x'), gatewayTool('a')])
  assert.deepEqual(
    registry.list().map((tool) => `${tool.host}:${tool.name}`),
    ['gateway:a', 'gateway:b', 'device:x', 'device:z'],
  )
})

test('snapshot is a copy safe from later registrations', () => {
  const registry = createToolRegistry()
  registry.register(gatewayTool('a'))
  const snapshot = registry.snapshot()
  registry.register(gatewayTool('b'))
  assert.deepEqual(
    snapshot.map((tool) => tool.name),
    ['a'],
  )
  assert.deepEqual(
    registry.list().map((tool) => tool.name),
    ['a', 'b'],
  )
})

test('get returns undefined for an unknown tool', () => {
  const registry = createToolRegistry()
  assert.equal(registry.get('missing'), undefined)
})

test('toolsFromRealtimeDeclarations skips mcp declarations and unnamed declarations', () => {
  const declarations: RealtimeToolDeclaration[] = [
    { type: 'function', name: 'stackchan.say', description: 'speak' },
    { type: 'mcp', name: 'ignored-mcp' },
    { type: 'function' },
  ]
  const tools = toolsFromRealtimeDeclarations(declarations)
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['stackchan.say'],
  )
  assert.equal(tools[0]?.host, 'device')
  assert.equal(tools[0]?.permission, 'safe')
  assert.equal(tools[0]?.execute, undefined)
})

test('toolsFromRealtimeDeclarations falls back to empty parameters when none are given', () => {
  const tools = toolsFromRealtimeDeclarations([{ type: 'function', name: 'noop' }])
  assert.deepEqual(tools[0]?.parameters, EMPTY_TOOL_PARAMETERS)
})

test('toolsFromRealtimeDeclarations passes through a well-formed parameter schema', () => {
  const parameters = { type: 'object' as const, properties: { text: { type: 'string' } }, required: ['text'] }
  const tools = toolsFromRealtimeDeclarations([{ type: 'function', name: 'say', parameters }])
  assert.deepEqual(tools[0]?.parameters, parameters)
})

test('toolPermissionFor defaults to safe', () => {
  assert.equal(toolPermissionFor('anything', {}), 'safe')
})

test('toolPermissionFor matches an exact name', () => {
  const policy = { requireApproval: { command: ['shell.run'] } }
  assert.equal(toolPermissionFor('shell.run', policy), 'command')
  assert.equal(toolPermissionFor('shell.other', policy), 'safe')
})

test('toolPermissionFor matches a trailing wildcard prefix', () => {
  const policy = { requireApproval: { fileChange: ['fs.*'] } }
  assert.equal(toolPermissionFor('fs.write', policy), 'fileChange')
  assert.equal(toolPermissionFor('fs', policy), 'safe')
  assert.equal(toolPermissionFor('other.fs.write', policy), 'safe')
})
