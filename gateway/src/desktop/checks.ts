import { resolveCommand, runProcess } from './process.ts'
import type { DesktopSettings, Provider } from './settings.ts'
import { requireSubscription } from './subscription.ts'

export async function checkProvider(settings: DesktopSettings, provider: Provider, cwd: string) {
  const config = settings.providers[provider]
  if (provider === 'codex' || provider === 'claude') {
    await resolveCommand(config.command)
    const version = (await runProcess({ command: config.command, args: ['--version'], cwd, timeoutMs: 10000 })).trim()
    await requireSubscription(provider, config.command, cwd)
    return {
      ok: true,
      message: `${version} / ログイン確認済み。返答テストでサブスクの利用可否を確認できます`,
      models: [],
    }
  }
  const response = await fetch(`${config.endpoint}/models`, { signal: AbortSignal.timeout(5000), redirect: 'error' })
  if (!response.ok) throw new Error(`${provider} の接続に失敗しました (${response.status})`)
  const value = (await response.json()) as { data?: Array<{ id?: unknown }> }
  if (!Array.isArray(value.data)) throw new Error('モデル一覧の形式が不正です')
  const models = value.data.map((item) => item.id).filter((id): id is string => typeof id === 'string')
  return {
    ok: true,
    message: models.length
      ? '接続できました。使用するモデルを選んで保存してください'
      : 'モデルがありません。LLM側でダウンロード・ロードしてください',
    models,
  }
}

export async function checkSpeech(settings: DesktopSettings) {
  const [stt, tts] = await Promise.allSettled([
    fetch(`${settings.speech.sttEndpoint}/health`, { signal: AbortSignal.timeout(5000), redirect: 'error' }).then(
      async (response) => {
        const value = (await response.json()) as { ready?: boolean }
        if (!response.ok || value.ready !== true) throw new Error('認識エンジンが準備できていません')
        return '日本語音声認識: 接続済み'
      },
    ),
    fetch(`${settings.speech.voicevoxEndpoint}/speakers`, {
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    }).then(async (response) => {
      if (!response.ok) throw new Error('VOICEVOXに接続できません')
      const value = (await response.json()) as Array<{ name: string; styles: Array<{ id: number; name: string }> }>
      if (!Array.isArray(value)) throw new Error('話者一覧が不正です')
      const speakers = value.flatMap((speaker) =>
        speaker.styles.map((style) => ({ id: style.id, name: `${speaker.name} / ${style.name}` })),
      )
      return speakers
    }),
  ])
  return {
    stt: {
      ok: stt.status === 'fulfilled',
      message:
        stt.status === 'fulfilled'
          ? stt.value
          : '音声認識は未接続です。Setup-Speech.cmd 実行後、Gateway を再起動してください',
    },
    tts: {
      ok: tts.status === 'fulfilled',
      message:
        tts.status === 'fulfilled' ? 'VOICEVOX: 接続済み' : 'VOICEVOX は未接続です。PC の VOICEVOX を起動してください',
    },
    speakers: tts.status === 'fulfilled' ? tts.value : [],
  }
}
