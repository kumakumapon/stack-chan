import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelResponder } from './model.ts'
import { defaultSettings } from './settings.ts'
import { requireSubscription } from './subscription.ts'

test('official subscription logins are accepted without exposing account details', async () => {
  await requireSubscription('codex', 'codex', '.', async () => 'Logged in using ChatGPT')
  await requireSubscription('claude', 'claude', '.', async () =>
    JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'private@example.com' }),
  )
})

test('API-key login or an unknown login method cannot generate a billable reply', async () => {
  for (const provider of ['codex', 'claude'] as const) {
    const settings = defaultSettings()
    settings.provider = provider
    let executions = 0
    const respond = createModelResponder({
      cwd: '.',
      schemaPath: '',
      runner: async (request) => {
        executions++
        assert.ok(request.args[0] === 'login' || request.args[0] === 'auth')
        return provider === 'codex'
          ? 'Logged in using an API key: masked'
          : JSON.stringify({ loggedIn: true, authMethod: 'api_key' })
      },
    })
    await assert.rejects(
      respond({ settings, history: [], text: 'こんにちは', signal: new AbortController().signal }),
      /サブスク/,
    )
    assert.equal(executions, 1)
  }
})
