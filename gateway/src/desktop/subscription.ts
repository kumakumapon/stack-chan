import { type ProcessRunner, runProcess } from './process.ts'

/** Ask the official CLI, without opening its credential files or showing account data. */
export async function requireSubscription(
  provider: 'codex' | 'claude',
  command: string,
  cwd: string,
  runner: ProcessRunner = runProcess,
  signal?: AbortSignal,
): Promise<void> {
  const result = await runner({
    command,
    cwd,
    signal,
    args: provider === 'codex' ? ['login', 'status'] : ['auth', 'status'],
    subscription: true,
    captureStderr: true,
    timeoutMs: 10000,
  })
  if (provider === 'codex') {
    if (!/logged in using chatgpt/i.test(result))
      throw new Error('Codex CLI を ChatGPT のサブスクアカウントでログインしてください。APIキーの認証は利用しません')
    return
  }
  let status: { loggedIn?: boolean; authMethod?: string; apiProvider?: string }
  try {
    status = JSON.parse(result)
  } catch {
    throw new Error('Claude Code の認証状態を確認できません。CLIを更新してログインしてください')
  }
  if (
    status.loggedIn !== true ||
    !['claude.ai', 'oauth'].includes(status.authMethod ?? '') ||
    (status.apiProvider !== undefined && status.apiProvider !== 'firstParty')
  )
    throw new Error('Claude Code を Claude のサブスクアカウントでログインしてください。APIキーの認証は利用しません')
}
