import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMcpTools, type McpToolClient } from './mcp-adapter.ts'

function client(label: string, overrides: Partial<McpToolClient> = {}): McpToolClient {
  return {
    label,
    listTools: async () => ({ tools: [] }),
    callTool: async () => ({}),
    ...overrides,
  }
}

test('createMcpTools builds gateway-hosted tools from listTools', async () => {
  const tools = await createMcpTools([
    client('weather', {
      listTools: async () => ({ tools: [{ name: 'forecast', description: 'weather forecast' }] }),
    }),
  ])
  assert.equal(tools.length, 1)
  assert.equal(tools[0]?.name, 'forecast')
  assert.equal(tools[0]?.host, 'gateway')
  assert.equal(tools[0]?.permission, 'safe')
  assert.equal(typeof tools[0]?.execute, 'function')
})

test('execute normalizes a text content array by joining with newlines', async () => {
  const tools = await createMcpTools([
    client('weather', {
      listTools: async () => ({ tools: [{ name: 'forecast' }] }),
      callTool: async () => ({
        content: [
          { type: 'text', text: 'line one' },
          { type: 'text', text: 'line two' },
          { type: 'image', text: 'ignored' },
        ],
      }),
    }),
  ])
  const result = await tools[0]?.execute?.({})
  assert.equal(result, 'line one\nline two')
})

test('execute falls back to JSON.stringify when there is no usable text content', async () => {
  const tools = await createMcpTools([
    client('weather', {
      listTools: async () => ({ tools: [{ name: 'forecast' }] }),
      callTool: async () => ({ temperature: 72 }),
    }),
  ])
  const result = await tools[0]?.execute?.({})
  assert.equal(result, JSON.stringify({ temperature: 72 }))
})

test('execute passes a plain string result through unchanged', async () => {
  const tools = await createMcpTools([
    client('weather', {
      listTools: async () => ({ tools: [{ name: 'forecast' }] }),
      callTool: async () => 'sunny',
    }),
  ])
  const result = await tools[0]?.execute?.({})
  assert.equal(result, 'sunny')
})

test('colliding tool names across clients are namespaced by label', async () => {
  const tools = await createMcpTools([
    client('alpha', { listTools: async () => ({ tools: [{ name: 'search' }] }) }),
    client('beta', { listTools: async () => ({ tools: [{ name: 'search' }] }) }),
  ])
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['beta.search', 'search'])
})

test('a failing listTools is logged and does not sink other clients', async () => {
  const logs: string[] = []
  const tools = await createMcpTools(
    [
      client('broken', { listTools: async () => Promise.reject(new Error('boom')) }),
      client('ok', { listTools: async () => ({ tools: [{ name: 'ping' }] }) }),
    ],
    {},
    { logger: (message) => logs.push(message) },
  )
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['ping'],
  )
  assert.equal(logs.length, 1)
  assert.match(logs[0] ?? '', /broken/)
  assert.match(logs[0] ?? '', /boom/)
})

test('calling execute forwards the original tool name to callTool, not the namespaced one', async () => {
  const calls: string[] = []
  const tools = await createMcpTools([
    client('alpha', { listTools: async () => ({ tools: [{ name: 'search' }] }) }),
    client('beta', {
      listTools: async () => ({ tools: [{ name: 'search' }] }),
      callTool: async (name) => {
        calls.push(name)
        return 'done'
      },
    }),
  ])
  const namespaced = tools.find((tool) => tool.name === 'beta.search')
  await namespaced?.execute?.({})
  assert.deepEqual(calls, ['search'])
})

test('permission is derived from the policy for the resolved (possibly namespaced) name', async () => {
  const tools = await createMcpTools([client('alpha', { listTools: async () => ({ tools: [{ name: 'search' }] }) })], {
    requireApproval: { command: ['search'] },
  })
  assert.equal(tools[0]?.permission, 'command')
})
