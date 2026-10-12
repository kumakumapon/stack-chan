import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { delimiter, dirname, extname, isAbsolute, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export type ProcessRequest = {
  command: string
  args: string[]
  input?: string
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
  subscription?: boolean
  captureStderr?: boolean
}
export type ProcessRunner = (request: ProcessRequest) => Promise<string>

/** Windows npm shims are resolved to JS, never run through cmd.exe with user text. */
export async function resolveCommand(command: string): Promise<{ file: string; prefix: string[] }> {
  const extensions = process.platform === 'win32' && !extname(command) ? ['.exe', '.cmd', '.ps1', ''] : ['']
  const directories =
    isAbsolute(command) || command.includes('/') || command.includes('\\')
      ? ['']
      : (process.env.PATH ?? '').split(delimiter)
  for (const directory of directories) {
    for (const extension of extensions) {
      const file = directory ? join(directory, command + extension) : command + extension
      try {
        await access(file)
      } catch {
        continue
      }
      if (extname(file) === '.js' || extname(file) === '.mjs') return { file: process.execPath, prefix: [file] }
      if (/\.(cmd|ps1)$/i.test(file)) {
        const name = command.toLowerCase().includes('claude')
          ? '@anthropic-ai/claude-code/cli.js'
          : '@openai/codex/bin/codex.js'
        const script = join(dirname(file), 'node_modules', name)
        try {
          await access(script)
        } catch {
          throw new Error('npmのCLI実体が見つかりません。設定に.exeまたは.jsの完全パスを指定してください')
        }
        return { file: process.execPath, prefix: [script] }
      }
      return { file, prefix: [] }
    }
  }
  throw new Error(`${command} が見つかりません。CLIのインストールと実行ファイルのパスを確認してください`)
}

export const runProcess: ProcessRunner = async (request) => {
  request.signal?.throwIfAborted()
  const command = await resolveCommand(request.command)
  const env = { ...process.env }
  if (request.subscription) {
    // CLI-owned OAuth only. Do not accidentally bill an unrelated API key from the parent.
    for (const key of [
      'OPENAI_API_KEY',
      'CODEX_API_KEY',
      'OPENAI_BASE_URL',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ])
      delete env[key]
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command.file, [...command.prefix, ...request.args], {
      cwd: request.cwd,
      env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    const decoder = new StringDecoder('utf8')
    let bytes = 0
    let failure: Error | undefined
    let done = false
    const kill = (error: Error) => {
      failure ??= error
      if (process.platform === 'win32' && child.pid) {
        // Kill only this invocation's tree, including native children of npm shims.
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
        })
        killer.on('error', () => child.kill())
        killer.on('exit', (code) => {
          if (code !== 0) child.kill()
        })
      } else child.kill()
    }
    const abort = () => kill(new Error('応答を中断しました'))
    const timer = setTimeout(() => kill(new Error('LLMの応答がタイムアウトしました')), request.timeoutMs ?? 120000)
    request.signal?.addEventListener('abort', abort, { once: true })
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      if (failure ?? error) reject(failure ?? error)
      else resolve(output + decoder.end())
    }
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length
      if (bytes > 1024 * 1024) kill(new Error('CLIの出力が上限を超えました'))
      else output += decoder.write(data)
    })
    // Authentication status may be printed to stderr. Capture only when
    // explicitly requested; the caller must never publish its raw contents.
    child.stderr.on('data', (data: Buffer) => {
      if (!request.captureStderr) return
      bytes += data.length
      if (bytes > 1024 * 1024) kill(new Error('CLIの出力が上限を超えました'))
      else output += decoder.write(data)
    })
    child.on('error', (error) => finish(error))
    child.on('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(`CLIが終了コード${code}で失敗しました。ログイン・利用上限・CLIバージョンを確認してください`),
      ),
    )
    child.stdin.on('error', () => {})
    child.stdin.end(request.input ?? '')
    if (request.signal?.aborted) abort()
  })
}
