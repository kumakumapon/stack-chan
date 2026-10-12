import { randomBytes } from 'node:crypto'

export const PROVIDERS = ['codex', 'claude', 'lemonade', 'lmstudio'] as const
export type Provider = (typeof PROVIDERS)[number]
export type ProviderSettings = { model: string; endpoint: string; command: string }
export type DesktopSettings = {
  provider: Provider
  name: string
  personality: string
  embodiment: boolean
  deviceId: string
  deviceToken: string
  providers: Record<Provider, ProviderSettings>
  speech: { sttEndpoint: string; voicevoxEndpoint: string; speakerId: number }
}

export function defaultSettings(): DesktopSettings {
  return {
    provider: 'codex',
    name: 'スタックチャン',
    personality: '親しみやすく好奇心旺盛。日本語で短く自然に話し、相手の話をよく聞きます。',
    embodiment: true,
    deviceId: 'stackchan-01',
    deviceToken: randomBytes(24).toString('hex'),
    providers: {
      codex: { model: '', endpoint: '', command: 'codex' },
      claude: { model: '', endpoint: '', command: 'claude' },
      lemonade: { model: '', endpoint: 'http://127.0.0.1:13305/api/v1', command: '' },
      lmstudio: { model: '', endpoint: 'http://127.0.0.1:1234/v1', command: '' },
    },
    speech: { sttEndpoint: 'http://127.0.0.1:8767', voicevoxEndpoint: 'http://127.0.0.1:50021', speakerId: 3 },
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('設定はオブジェクトで指定してください')
  return value as Record<string, unknown>
}

export function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || value.includes('\0'))
    throw new Error(`${field} は${allowEmpty ? '0' : '1'}〜${max}文字で指定してください`)
  return value.trim()
}

/** Local speech must never silently send recorded audio or replies to a cloud. */
export function localUrl(value: unknown, field: string): string {
  const raw = text(value, field, 500)
  const url = new URL(raw)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(`${field} はPC内の http://127.0.0.1:ポート/パス を指定してください`)
  return raw.replace(/\/+$/, '')
}

export function parseSettings(value: unknown): DesktopSettings {
  const source = record(value)
  if (!PROVIDERS.includes(source.provider as Provider)) throw new Error('LLMの種類が不正です')
  if (typeof source.embodiment !== 'boolean') throw new Error('表情・動作の設定が不正です')
  const deviceId = text(source.deviceId, '本体ID', 64)
  if (!/^[a-zA-Z0-9_-]+$/.test(deviceId)) throw new Error('本体IDは英数字・ハイフン・アンダースコアで指定してください')
  const providers = record(source.providers)
  const parsed = {} as Record<Provider, ProviderSettings>
  for (const provider of PROVIDERS) {
    const item = record(providers[provider])
    const command = text(item.command, 'CLIコマンド', 500, provider === 'lemonade' || provider === 'lmstudio')
    if (/\r|\n/.test(command)) throw new Error('CLIは実行ファイルのパスだけ指定してください')
    parsed[provider] = {
      model: text(item.model, 'モデル', 200, true),
      command,
      endpoint: provider === 'lemonade' || provider === 'lmstudio' ? localUrl(item.endpoint, 'LLM接続先') : '',
    }
  }
  const speech = record(source.speech)
  if (!Number.isInteger(speech.speakerId) || (speech.speakerId as number) < 0 || (speech.speakerId as number) > 100000)
    throw new Error('VOICEVOXの話者IDが不正です')
  return {
    provider: source.provider as Provider,
    name: text(source.name, '名前', 40),
    personality: text(source.personality, '性格', 2000),
    embodiment: source.embodiment,
    deviceId,
    deviceToken: text(source.deviceToken, '本体トークン', 256),
    providers: parsed,
    speech: {
      sttEndpoint: localUrl(speech.sttEndpoint, '音声認識の接続先'),
      voicevoxEndpoint: localUrl(speech.voicevoxEndpoint, '音声合成の接続先'),
      speakerId: speech.speakerId as number,
    },
  }
}
