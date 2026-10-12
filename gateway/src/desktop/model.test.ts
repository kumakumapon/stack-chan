import assert from 'node:assert/strict'
import test from 'node:test'
import { createModelResponder } from './model.ts'
import type { ProcessRequest } from './process.ts'
import { defaultSettings } from './settings.ts'

test('local LLM receives Japanese persona and shared chronological context without external tools', async () => {
  const settings = defaultSettings()
  settings.provider = 'lmstudio'
  settings.providers.lmstudio.model = 'local-japanese'
  let sent: Record<string, unknown> = {}
  const respond = createModelResponder({
    cwd: '.',
    schemaPath: 'schema.json',
    fetchImpl: (async (url, options) => {
      assert.equal(url, `${settings.providers.lmstudio.endpoint}/chat/completions`)
      sent = JSON.parse(String(options?.body))
      return new Response(JSON.stringify({ choices: [{ message: { content: 'response' } }] }))
    }) as typeof fetch,
  })
  await respond({
    settings,
    history: [{ at: '', provider: 'codex', user: '前の質問', assistant: '前の返答' }],
    text: '次の質問',
    signal: new AbortController().signal,
  })
  const messages = sent.messages as Array<{ role: string; content: string }>
  assert.equal(messages[0]?.role, 'system')
  assert.ok(messages[0]?.content.includes(settings.name))
  assert.deepEqual(
    messages.slice(1).map((message) => message.content),
    ['前の質問', '前の返答', '次の質問'],
  )
  assert.equal('tools' in sent, false)
})

test('both official CLIs consume stdin and structured outputs without interpolating speech in shell arguments', async () => {
  const settings = defaultSettings()
  let captured!: ProcessRequest
  const rawReply = { text: '日本語です。', emotion: 'neutral', gesture: 'none', gaze: 'none' }
  const respond = createModelResponder({
    cwd: 'isolated',
    schemaPath: 'schema.json',
    runner: async (request) => {
      if (request.args[0] === 'login') return 'Logged in using ChatGPT'
      if (request.args[0] === 'auth') return JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })
      captured = request
      return request.command === 'codex'
        ? JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(rawReply) } })
        : JSON.stringify({ structured_output: rawReply })
    },
  })
  const text = 'こんにちは & whoami $(Get-Content secret)'
  for (const provider of ['codex', 'claude'] as const) {
    settings.provider = provider
    assert.deepEqual(
      JSON.parse(await respond({ settings, history: [], text, signal: new AbortController().signal })),
      rawReply,
    )
    assert.equal(captured.subscription, true)
    assert.equal(
      captured.args.some((arg) => arg.includes(text)),
      false,
    )
    assert.ok(captured.input?.includes(text))
  }
})

test('ambiguous model selection fails with a useful message instead of selecting an unloaded model', async () => {
  const settings = defaultSettings()
  settings.provider = 'lemonade'
  const respond = createModelResponder({
    cwd: '.',
    schemaPath: '',
    fetchImpl: (async () => new Response(JSON.stringify({ data: [{ id: 'one' }, { id: 'two' }] }))) as typeof fetch,
  })
  await assert.rejects(
    respond({ settings, history: [], text: 'こんにちは', signal: new AbortController().signal }),
    /モデルを選んで/,
  )
})
