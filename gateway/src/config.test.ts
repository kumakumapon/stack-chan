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

test("omitting audio and diagnostics keeps today's defaults", () => {
  const config = parseGatewayConfig({})
  assert.deepEqual(config.audio, { vad: {} })
  assert.equal(config.audio.maxUtteranceSeconds, undefined)
  assert.deepEqual(config.diagnostics, { logTranscripts: false })
})

test('stt.language is parsed and left unset by default', () => {
  assert.equal(parseGatewayConfig({}).stt.language, undefined)
  assert.equal(parseGatewayConfig({ stt: { language: 'ja' } }).stt.language, 'ja')
})

test('audio.vad and audio.maxUtteranceSeconds parse into their config fields', () => {
  const config = parseGatewayConfig({
    audio: {
      vad: { activationLevel: 0.03, releaseLevel: 0.015, hangoverMilliseconds: 250, minUtteranceMilliseconds: 150 },
      maxUtteranceSeconds: 20,
    },
  })
  assert.deepEqual(config.audio.vad, {
    activationLevel: 0.03,
    releaseLevel: 0.015,
    hangoverMilliseconds: 250,
    minUtteranceMilliseconds: 150,
  })
  assert.equal(config.audio.maxUtteranceSeconds, 20)
})

test('audio.maxUtteranceSeconds rejects zero, negative and over-30 values with a readable error', () => {
  assert.throws(() => parseGatewayConfig({ audio: { maxUtteranceSeconds: 0 } }), /maxUtteranceSeconds/)
  assert.throws(() => parseGatewayConfig({ audio: { maxUtteranceSeconds: -1 } }), /maxUtteranceSeconds/)
  assert.throws(() => parseGatewayConfig({ audio: { maxUtteranceSeconds: 31 } }), /maxUtteranceSeconds/)
  assert.throws(() => parseGatewayConfig({ audio: { maxUtteranceSeconds: 'thirty' } }), /maxUtteranceSeconds/)
  assert.equal(parseGatewayConfig({ audio: { maxUtteranceSeconds: 30 } }).audio.maxUtteranceSeconds, 30)
})

test('audio.vad levels must be normalized RMS values in (0, 1]', () => {
  assert.throws(() => parseGatewayConfig({ audio: { vad: { activationLevel: 0 } } }), /activationLevel/)
  assert.throws(() => parseGatewayConfig({ audio: { vad: { activationLevel: 1.5 } } }), /activationLevel/)
  assert.throws(() => parseGatewayConfig({ audio: { vad: { releaseLevel: -0.1 } } }), /releaseLevel/)
})

test('audio.vad rejects a releaseLevel above activationLevel', () => {
  assert.throws(
    () => parseGatewayConfig({ audio: { vad: { activationLevel: 0.01, releaseLevel: 0.02 } } }),
    /releaseLevel.*activationLevel/,
  )
  // A single field passed alone is not compared against the other's default.
  assert.doesNotThrow(() => parseGatewayConfig({ audio: { vad: { releaseLevel: 0.5 } } }))
})

test('audio.vad hangover and minUtterance fields must be non-negative integers', () => {
  assert.throws(() => parseGatewayConfig({ audio: { vad: { hangoverMilliseconds: -1 } } }), /hangoverMilliseconds/)
  assert.throws(() => parseGatewayConfig({ audio: { vad: { hangoverMilliseconds: 1.5 } } }), /hangoverMilliseconds/)
  assert.throws(
    () => parseGatewayConfig({ audio: { vad: { minUtteranceMilliseconds: -1 } } }),
    /minUtteranceMilliseconds/,
  )
  assert.equal(parseGatewayConfig({ audio: { vad: { hangoverMilliseconds: 0 } } }).audio.vad.hangoverMilliseconds, 0)
})

test('diagnostics.logTranscripts parses and rejects a non-boolean', () => {
  assert.equal(parseGatewayConfig({}).diagnostics.logTranscripts, false)
  assert.equal(parseGatewayConfig({ diagnostics: { logTranscripts: true } }).diagnostics.logTranscripts, true)
  assert.throws(
    () => parseGatewayConfig({ diagnostics: { logTranscripts: 'true' } }),
    /diagnostics\.logTranscripts must be a boolean/,
  )
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

test('the example audio/diagnostics YAML shape parses end to end', () => {
  const config = parseGatewayConfigFile(
    [
      'stt:',
      '  type: auto',
      '  apiKey: ${OPENAI_API_KEY}',
      '  language: ja',
      'audio:',
      '  vad:',
      '    activationLevel: 0.02',
      '    releaseLevel: 0.012',
      '    hangoverMilliseconds: 300',
      '    minUtteranceMilliseconds: 200',
      '  maxUtteranceSeconds: 30',
      'diagnostics:',
      '  logTranscripts: false',
      '',
    ].join('\n'),
    { OPENAI_API_KEY: 'sk-test' },
  )
  assert.equal(config.stt.language, 'ja')
  assert.deepEqual(config.audio.vad, {
    activationLevel: 0.02,
    releaseLevel: 0.012,
    hangoverMilliseconds: 300,
    minUtteranceMilliseconds: 200,
  })
  assert.equal(config.audio.maxUtteranceSeconds, 30)
  assert.equal(config.diagnostics.logTranscripts, false)
})
