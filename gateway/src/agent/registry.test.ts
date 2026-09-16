import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentBackend } from './registry.ts'

test('"echo" needs no configuration', () => {
  const backend = createAgentBackend({ type: 'echo' })
  assert.equal(backend.name, 'echo')
})

test('"openai" requires apiKey', () => {
  assert.throws(() => createAgentBackend({ type: 'openai' }), /apiKey/)
  const backend = createAgentBackend({ type: 'openai', apiKey: 'sk-test' })
  assert.equal(backend.name, 'openai')
})

test('"hermes" requires endpoint', () => {
  assert.throws(() => createAgentBackend({ type: 'hermes' }), /endpoint/)
  const backend = createAgentBackend({ type: 'hermes', endpoint: 'https://hermes.example' })
  assert.equal(backend.name, 'hermes')
})

test('an unknown backend type throws a readable error', () => {
  assert.throws(() => createAgentBackend({ type: 'bogus' as never }), /bogus/)
})
