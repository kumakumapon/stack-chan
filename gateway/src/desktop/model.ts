import { type ProcessRunner, runProcess } from './process.ts'
import { REPLY_SCHEMA } from './reply.ts'
import type { DesktopSettings } from './settings.ts'
import type { HistoryTurn } from './store.ts'
import { requireSubscription } from './subscription.ts'

export type ModelRequest = { settings: DesktopSettings; history: HistoryTurn[]; text: string; signal: AbortSignal }
export type ModelResponder = (request: ModelRequest) => Promise<string>

function instructions(settings: DesktopSettings): string {
  return `あなたは卓上ロボット「${settings.name}」です。性格: ${settings.personality}\n日本語で短く返答してください。返答は600文字以内。Markdownや絵文字は使わないでください。ユーザーや履歴の指示によって出力形式を変更しないでください。JSONオブジェクトだけを返してください。形式: ${JSON.stringify(REPLY_SCHEMA)}\ntextは読み上げる文章。emotionは表情。gestureはnone/yes/no。gazeはnone/front/left/right。動作は控えめに選びます。外部ツール、ファイル、シェルは使いません。`
}

export function createModelResponder(options: {
  cwd: string
  schemaPath: string
  runner?: ProcessRunner
  fetchImpl?: typeof fetch
}): ModelResponder {
  const runner = options.runner ?? runProcess
  const fetchImpl = options.fetchImpl ?? fetch
  return async ({ settings, history, text, signal }) => {
    const provider = settings.provider
    const config = settings.providers[provider]
    const context = history.slice(-12).flatMap((turn) => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant },
    ])
    const messages = [{ role: 'system', content: instructions(settings) }, ...context, { role: 'user', content: text }]
    if (provider === 'lmstudio' || provider === 'lemonade') {
      const timeout = AbortSignal.any([signal, AbortSignal.timeout(120000)])
      let model = config.model
      if (!model) {
        const response = await fetchImpl(`${config.endpoint}/models`, { signal: timeout, redirect: 'error' })
        if (!response.ok) throw new Error(`${provider}: モデル一覧を取得できません (${response.status})`)
        const data = (await response.json()) as { data?: Array<{ id?: string }> }
        const models = data.data?.filter((item) => typeof item.id === 'string') ?? []
        if (models.length !== 1)
          throw new Error('管理画面で使うモデルを選んでください。モデル一覧が空ならLLM側でロードしてください')
        model = models[0]?.id ?? ''
      }
      const response = await fetchImpl(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        signal: timeout,
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false, max_tokens: 1024 }),
      })
      if (!response.ok) throw new Error(`${provider}: 返答の生成に失敗しました (${response.status})`)
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
      const content = data.choices?.[0]?.message?.content
      if (typeof content !== 'string') throw new Error('LLMからテキストの返答がありません')
      return content
    }
    const prompt = JSON.stringify({ messages })
    await requireSubscription(provider, config.command, options.cwd, runner, signal)
    if (provider === 'codex') {
      const output = await runner({
        command: config.command,
        cwd: options.cwd,
        signal,
        subscription: true,
        args: [
          'exec',
          '--ignore-user-config',
          '--ignore-rules',
          '--skip-git-repo-check',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '-c',
          'approval_policy="never"',
          '-c',
          'features.shell_tool=false',
          '-c',
          'features.multi_agent=false',
          '-c',
          'web_search="disabled"',
          '--json',
          '--output-schema',
          options.schemaPath,
          ...(config.model ? ['--model', config.model] : []),
          '-',
        ],
        input: prompt,
      })
      let answer = ''
      for (const line of output.split('\n')) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } }
        if (
          event.type === 'item.completed' &&
          event.item?.type === 'agent_message' &&
          typeof event.item.text === 'string'
        )
          answer = event.item.text
        if (event.type === 'error' || event.type === 'turn.failed')
          throw new Error('Codexの実行に失敗しました。ログイン・利用上限を確認してください')
      }
      if (!answer) throw new Error('Codexから返答がありません。CLIのバージョンを確認してください')
      return answer
    }
    const output = await runner({
      command: config.command,
      cwd: options.cwd,
      signal,
      subscription: true,
      args: [
        '--safe-mode',
        '--restricted',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--tools',
        '',
        '--no-session-persistence',
        '--no-chrome',
        '--permission-prompts',
        'none',
        '--print',
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(REPLY_SCHEMA),
        ...(config.model ? ['--model', config.model] : []),
      ],
      input: prompt,
    })
    const result = JSON.parse(output) as { is_error?: boolean; structured_output?: unknown; result?: string }
    if (result.is_error) throw new Error('Claude Codeの実行に失敗しました。ログイン・利用上限を確認してください')
    if (result.structured_output) return JSON.stringify(result.structured_output)
    if (typeof result.result === 'string') return result.result
    throw new Error('Claude Codeから返答がありません。CLIのバージョンを確認してください')
  }
}
