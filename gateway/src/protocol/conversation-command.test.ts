import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseGatewayDeviceMessage, parseGatewayServerMessage } from './stackchan-gateway-v1.ts'

test('the Gateway decodes the same independently maintained wire fixtures as the firmware', () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL('../../../firmware/host/modules/conversation/gateway/gateway-protocol-v1.json', import.meta.url),
      'utf8',
    ),
  ) as { acceptedServerMessages: unknown[]; rejectedServerMessages: unknown[] }
  for (const message of fixtures.acceptedServerMessages) assert.deepEqual(parseGatewayServerMessage(message), message)
  for (const message of fixtures.rejectedServerMessages) assert.equal(parseGatewayServerMessage(message), undefined)
})

test('conversation control validates command actions, text bounds, and matching-result shape', () => {
  const command = { schema: 'stackchan.gateway.v1', type: 'conversation.command', requestId: 'r1', action: 'start' }
  assert.deepEqual(parseGatewayServerMessage(command), command)
  assert.equal(parseGatewayServerMessage({ ...command, action: 'shell' }), undefined)
  assert.equal(parseGatewayServerMessage({ ...command, action: 'text', text: ' ' }), undefined)
  assert.equal(parseGatewayServerMessage({ ...command, action: 'text', text: 'x'.repeat(4001) }), undefined)
  assert.equal(parseGatewayServerMessage({ ...command, requestId: '' }), undefined)
  const result = { schema: 'stackchan.gateway.v1', type: 'conversation.command.result', requestId: 'r1', success: true }
  assert.deepEqual(parseGatewayDeviceMessage(result), result)
  assert.equal(parseGatewayDeviceMessage({ ...result, success: 'true' }), undefined)
  assert.equal(parseGatewayDeviceMessage({ ...result, error: 1 }), undefined)
})
