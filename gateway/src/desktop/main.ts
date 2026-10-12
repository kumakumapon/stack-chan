import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDesktopApp } from './app.ts'

function openBrowser(url: string) {
  const opener =
    process.platform === 'win32'
      ? spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, stdio: 'ignore' })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' })
  opener.on('error', () => console.log(`[desktop] ブラウザで ${url} を開いてください`))
  opener.unref()
}

async function main() {
  // Double-clicking again opens the existing app instead of touching its data.
  const existing = await fetch('http://127.0.0.1:8766/health', { signal: AbortSignal.timeout(1000) })
    .then(
      async (response) =>
        response.ok && ((await response.json()) as { application?: string }).application === 'stackchan-desktop',
    )
    .catch(() => false)
  if (existing) {
    console.log('[desktop] Gateway はすでに起動しています: http://127.0.0.1:8766/')
    if (process.argv.includes('--open')) openBrowser('http://127.0.0.1:8766/')
    return
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const directory = resolve(process.env.STACKCHAN_DESKTOP_DATA ?? resolve(root, '.runtime'))
  let app: Awaited<ReturnType<typeof createDesktopApp>> | undefined
  let speech: ReturnType<typeof spawn> | undefined
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    speech?.kill()
    if (app)
      void app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      )
  }
  app = await createDesktopApp({ directory, logger: (message) => console.log(message), onShutdown: stop })
  if (stopping) {
    await app.close()
    return
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('exit', () => speech?.kill())
  const python = resolve(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
  const model = resolve(root, '.runtime/models/whisper-small')
  try {
    await access(python)
    await access(resolve(model, 'model.bin'))
    if (stopping) return
    const settings = app.store.settings()
    // An independently configured STT service is not managed by this launcher.
    if (settings.speech.sttEndpoint === 'http://127.0.0.1:8767') {
      const healthy = await fetch(`${settings.speech.sttEndpoint}/health`, { signal: AbortSignal.timeout(1000) })
        .then((response) => response.ok)
        .catch(() => false)
      if (!healthy) {
        speech = spawn(python, [resolve(root, 'scripts/whisper_server.py'), '--model', model], {
          cwd: root,
          windowsHide: true,
          stdio: ['ignore', 'inherit', 'inherit'],
          env: { ...process.env, HF_HUB_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', PYTHONIOENCODING: 'utf-8' },
        })
        speech.on('error', () =>
          console.error('[speech] ローカル音声認識を起動できません。Setup-Speech.cmd を確認してください'),
        )
      }
    }
  } catch {
    console.log('[speech] 初回は Setup-Speech.cmd を実行してください。VOICEVOX も PC で起動してください。')
  }
  console.log(`[desktop] 管理画面: ${app.url}`)
  console.log(`[desktop] 本体接続ポート: ${app.gatewayPort}`)
  if (process.argv.includes('--open')) {
    openBrowser(app.url)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Gatewayを起動できませんでした')
  process.exitCode = 1
})
