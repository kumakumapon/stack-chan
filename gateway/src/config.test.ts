// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the config file's own ${NAME} environment-reference syntax, not template literals
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_LISTEN, parseGatewayConfig, parseGatewayConfigFile } from './config.ts'

test('an empty config starts an anonymous echo Gateway on the default port', () => {
  const config = parseGatewayConfig({})
  assert.deepEqual(config.listen, DEFAULT_LISTEN)
  assert.equal(config.agent.type, 'echo')
  assert.equal(config.stt.type, 'none')
  assert.equal(config.tts.type, 'none')
  assert.deepEqual(config.devices, [])
  assert.equal(config.tools.mcp, false)
})

test('environment references are expanded', () => {
  const config = parseGatewayConfig(
    { gateway: { token: '${STACKCHAN_GATEWAY_TOKEN}' } },
    {
      STACKCHAN_GATEWAY_TOKEN: 'from-env',
    },
  )
  assert.equal(config.token, 'from-env')
})

test('an unset environment reference fails at start-up instead of silently emptying', () => {
  assert.throws(() => parseGatewayConfig({ agent: { apiKey: '${MISSING_KEY}' } }, {}), /MISSING_KEY/)
})

test('auto selects a cloud adapter only when a key is present', () => {
  assert.equal(parseGatewayConfig({ stt: { type: 'auto' } }).stt.type, 'none')
  assert.equal(parseGatewayConfig({ stt: { type: 'auto', apiKey: 'k' } }).stt.type, 'openai')
  assert.equal(parseGatewayConfig({ tts: { type: 'auto' } }).tts.type, 'none')
  assert.equal(parseGatewayConfig({ tts: { type: 'auto', apiKey: 'k' } }).tts.type, 'openai')
})

test('an unknown agent type names the accepted values', () => {
  assert.throws(() => parseGatewayConfig({ agent: { type: 'gpt' } }), /echo, openai, hermes/)
})

test('devices require a deviceId', () => {
  assert.throws(() => parseGatewayConfig({ gateway: { devices: [{ token: 't' }] } }), /deviceId is required/)
})

test('the documented YAML shape parses', () => {
  const config = parseGatewayConfigFile(
    [
      'conversation:',
      '  backend: gateway',
      'gateway:',
      '  listen:',
      '    host: 127.0.0.1',
      '    port: 9000',
      '    path: /stackchan',
      '  devices:',
      '    - deviceId: stackchan-01',
      '      token: ${STACKCHAN_GATEWAY_TOKEN}',
      'agent:',
      '  type: hermes',
      '  endpoint: http://127.0.0.1:7000',
      'stt:',
      '  type: auto',
      'tts:',
      '  type: auto',
      'tools:',
      '  mcp: true',
      '  servers:',
      '    - label: github',
      '      url: https://mcp.example/github',
      '  requireApproval:',
      '    command:',
      '      - shell.*',
      '',
    ].join('\n'),
    { STACKCHAN_GATEWAY_TOKEN: 'abc' },
  )
  assert.deepEqual(config.listen, { host: '127.0.0.1', port: 9000, path: '/stackchan' })
  assert.deepEqual(config.devices, [{ deviceId: 'stackchan-01', token: 'abc' }])
  assert.equal(config.agent.type, 'hermes')
  assert.equal(config.agent.endpoint, 'http://127.0.0.1:7000')
  assert.equal(config.tools.mcp, true)
  assert.deepEqual(config.tools.servers, [{ label: 'github', url: 'https://mcp.example/github' }])
  assert.deepEqual(config.tools.policy.requireApproval?.command, ['shell.*'])
})

test('port 0 is accepted so a test can ask for an ephemeral port', () => {
  assert.equal(parseGatewayConfig({ gateway: { listen: { port: 0 } } }).listen.port, 0)
  assert.throws(() => parseGatewayConfig({ gateway: { listen: { port: 70_000 } } }), /between 0 and 65535/)
})
