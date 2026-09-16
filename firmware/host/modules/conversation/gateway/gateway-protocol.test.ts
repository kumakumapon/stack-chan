import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  audioInput,
  audioInputEnd,
  isGatewayEnvelope,
  parseGatewayServerMessage,
  STACKCHAN_GATEWAY_PROTOCOL_VERSION,
  STACKCHAN_GATEWAY_SCHEMA,
  sessionHello,
  textInput,
} from './gateway-protocol.js'

type GatewayProtocolFixture = {
  gatewaySchema: string
  acceptedServerMessages: Array<Record<string, unknown>>
  rejectedServerMessages: unknown[]
  deviceHello: Array<{ input: Record<string, unknown>; expected: Record<string, unknown> }>
  deviceAudioInput: Array<{ seq: number; payload: string; expected: Record<string, unknown> }>
  deviceAudioInputEnd: Array<{ seq: number; expected: Record<string, unknown> }>
  deviceTextInput: Array<{ text: string; expected: Record<string, unknown> }>
}

const fixture = JSON.parse(
  readFileSync('host/modules/conversation/gateway/gateway-protocol-v1.json', 'utf8'),
) as GatewayProtocolFixture

test('gateway-protocol exposes the schema and protocol version constants used by the fixture', () => {
  assert.equal(STACKCHAN_GATEWAY_SCHEMA, fixture.gatewaySchema)
  assert.equal(STACKCHAN_GATEWAY_PROTOCOL_VERSION, 1)
})

test('isGatewayEnvelope accepts only records carrying the gateway schema tag', () => {
  assert.equal(isGatewayEnvelope({ schema: STACKCHAN_GATEWAY_SCHEMA, type: 'session.ready' }), true)
  assert.equal(isGatewayEnvelope({ schema: 'other.v1', type: 'session.ready' }), false)
  assert.equal(isGatewayEnvelope('not-an-object'), false)
  assert.equal(isGatewayEnvelope(null), false)
  assert.equal(isGatewayEnvelope([]), false)
})

test('parseGatewayServerMessage accepts every fixture vector and echoes it back unchanged', () => {
  for (const message of fixture.acceptedServerMessages) {
    const parsed = parseGatewayServerMessage(message)
    assert.deepEqual(parsed, message, String(message.type))
  }
})

test('parseGatewayServerMessage rejects malformed and unknown fixture vectors', () => {
  for (const message of fixture.rejectedServerMessages) {
    assert.equal(parseGatewayServerMessage(message), undefined, JSON.stringify(message))
  }
})

test('parseGatewayServerMessage never returns a value isGatewayEnvelope would reject', () => {
  for (const message of fixture.acceptedServerMessages) {
    const parsed = parseGatewayServerMessage(message)
    assert.equal(isGatewayEnvelope(parsed), true)
  }
})

test('sessionHello builds the exact device->gateway wire shape, with and without a token', () => {
  for (const vector of fixture.deviceHello) {
    const built = sessionHello(vector.input as Parameters<typeof sessionHello>[0])
    assert.deepEqual(built, vector.expected)
    // Round-trips through JSON the same way the wire transport would.
    assert.deepEqual(JSON.parse(JSON.stringify(built)), vector.expected)
  }
})

test('sessionHello always stamps the device protocol version, regardless of caller input', () => {
  const built = sessionHello({
    deviceId: 'device-x',
    clientId: 'client-x',
    capabilities: { audioInput: [], audioOutput: [], embodiment: [], approval: false },
  })
  assert.equal(built.protocolVersion, STACKCHAN_GATEWAY_PROTOCOL_VERSION)
})

test('audioInput, audioInputEnd and textInput build the exact device->gateway wire shapes', () => {
  for (const vector of fixture.deviceAudioInput) {
    assert.deepEqual(audioInput(vector.seq, vector.payload), vector.expected)
  }
  for (const vector of fixture.deviceAudioInputEnd) {
    assert.deepEqual(audioInputEnd(vector.seq), vector.expected)
  }
  for (const vector of fixture.deviceTextInput) {
    assert.deepEqual(textInput(vector.text), vector.expected)
  }
})

test('every device->gateway builder output is itself a valid gateway envelope', () => {
  const hello = sessionHello({
    deviceId: 'device-1',
    clientId: 'client-1',
    capabilities: { audioInput: [], audioOutput: [], embodiment: [], approval: false },
  })
  const input = audioInput(1, 'AAAA')
  const end = audioInputEnd(1)
  const text = textInput('hi')
  for (const built of [hello, input, end, text]) {
    assert.equal(isGatewayEnvelope(built), true)
  }
})
