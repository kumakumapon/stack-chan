import { formatUtcOffset, TIMEZONE_PRESETS } from 'timezone-model'

export const PREFERENCE_KEYS = [
  'conversation.backend',
  'conversation.autoStart',
  'gateway.endpoint',
  'gateway.deviceId',
  'gateway.clientId',
  'gateway.token',
  'gateway.microphone',
  'companion.greetingOnBoot',
  'companion.idleReactions',
  'companion.lowBatteryNotice',
  'companion.quietHours',
  'companion.quietStart',
  'companion.quietEnd',
  'wifi.ssid',
  'wifi.password',
  'driver.type',
  'ui.type',
  'ui.language',
  'time.timezone',
  'tts.type',
  'tts.host',
  'tts.port',
  'tts.token',
  'tts.voice',
  'tts.volume',
  'tts.speed',
  'tts.speakerId',
  'tts.model',
  'tts.instructions',
  'ai.token',
  'mcp.token',
] as const

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number]
export type PreferenceValues = Record<PreferenceKey, string>

export const DEFAULT_PREFERENCES: PreferenceValues = {
  'conversation.backend': 'none',
  'conversation.autoStart': '0',
  'gateway.endpoint': '',
  'gateway.deviceId': 'stackchan-01',
  'gateway.clientId': 'companion',
  'gateway.token': '',
  'gateway.microphone': '0',
  'companion.greetingOnBoot': '1',
  'companion.idleReactions': '1',
  'companion.lowBatteryNotice': '1',
  'companion.quietHours': '0',
  'companion.quietStart': '1320',
  'companion.quietEnd': '420',
  'wifi.ssid': '',
  'wifi.password': '',
  'driver.type': 'm5stackchan',
  'ui.type': 'simple',
  'ui.language': 'ja',
  'time.timezone': 'tokyo',
  'tts.type': 'stackchan-voice',
  'tts.host': '',
  'tts.port': '',
  'tts.token': '',
  'tts.voice': 'normal',
  'tts.volume': '0.1',
  'tts.speed': '100',
  'tts.speakerId': '1',
  'tts.model': '',
  'tts.instructions': '',
  'ai.token': '',
  'mcp.token': '',
}

/** Half-hour choices for quiet hours; values are minutes since midnight (0-1439), the only form the device accepts. */
export const quietTimeOptions = (current?: string): { value: string; label: string; translate: false }[] => {
  const choices = Array.from({ length: 48 }, (_, index) => index * 30)
  if (current && /^\d+$/.test(current) && Number(current) < 1440 && !choices.includes(Number(current))) {
    choices.push(Number(current))
    choices.sort((a, b) => a - b)
  }
  return choices.map((minutes) => {
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mm = String(minutes % 60).padStart(2, '0')
    return { value: String(minutes), label: `${hh}:${mm}`, translate: false }
  })
}

export const FACE_OPTIONS = [
  { value: 'simple', label: 'シンプル' },
  { value: 'dog', label: 'いぬ' },
  { value: 'image', label: '画像' },
  { value: 'small-face', label: '小さい顔' },
] as const

export const TTS_OPTIONS = [
  { value: 'stackchan-voice', label: 'stackchan-voice', translate: false },
  { value: 'voicevox', label: 'VOICEVOX', translate: false },
  { value: 'voicevox-web', label: 'VOICEVOX Web (tts.quest)', translate: false },
  { value: 'remote', label: 'リモートWAV' },
  { value: 'elevenlabs', label: 'ElevenLabs', translate: false },
  { value: 'openai', label: 'OpenAI', translate: false },
  { value: 'local', label: 'ローカル音源' },
] as const

const TTS_FIELDS: Readonly<Record<string, readonly PreferenceKey[]>> = {
  'stackchan-voice': ['tts.voice', 'tts.speed'],
  voicevox: ['tts.host', 'tts.port', 'tts.speakerId'],
  'voicevox-web': ['tts.token', 'tts.speakerId'],
  remote: ['tts.host', 'tts.port'],
  elevenlabs: ['tts.token', 'tts.voice', 'tts.model'],
  openai: ['tts.token', 'tts.voice', 'tts.speed', 'tts.model', 'tts.instructions'],
  local: [],
}

export const ttsFields = (service: string): readonly PreferenceKey[] =>
  Object.hasOwn(TTS_FIELDS, service) ? TTS_FIELDS[service]! : []

export function ttsDefaults(service: string): Partial<PreferenceValues> {
  if (service === 'stackchan-voice') return { 'tts.voice': 'normal', 'tts.speed': '100' }
  if (service === 'openai') return { 'tts.voice': 'alloy', 'tts.speed': '1', 'tts.model': 'tts-1' }
  if (service === 'elevenlabs') return { 'tts.voice': 'AZnzlk1XvdvUeBnXmlld', 'tts.model': 'eleven_monolingual_v1' }
  if (service === 'voicevox' || service === 'voicevox-web') return { 'tts.speakerId': '1' }
  return {}
}

/** A provider switch is an explicit edit. Never reuse another provider's credentials or incompatible voice/rate. */
export function ttsServiceChanges(service: string, current: PreferenceValues): Partial<PreferenceValues> {
  if (service === current['tts.type'] || !TTS_OPTIONS.some((option) => option.value === service)) return {}
  const changes: Partial<PreferenceValues> = { ...ttsDefaults(service), 'tts.type': service, 'tts.token': '' }
  if (service === 'voicevox' || service === 'remote') changes['tts.port'] = service === 'voicevox' ? '50021' : '80'
  return changes
}

export const timezoneOptions = (translate: (key: string) => string) =>
  TIMEZONE_PRESETS.map((preset) => ({
    value: preset.id,
    label: `${translate(preset.labelKey)} (${formatUtcOffset(preset.offsetMinutes)})`,
    translate: false,
  }))

export function validatePreferenceChanges(changes: Partial<PreferenceValues>, values: PreferenceValues): void {
  for (const key of PREFERENCE_KEYS) {
    const value = changes[key]
    if (value === undefined) continue
    if (key === 'time.timezone' && !TIMEZONE_PRESETS.some((preset) => preset.id === value)) {
      throw new Error('タイムゾーンを選択してください。')
    }
    const numeric = key === 'tts.volume' || key === 'tts.port' || key === 'tts.speed' || key === 'tts.speakerId'
    if (numeric) {
      const number = Number(value)
      if (value.trim() === '' || !Number.isFinite(number)) throw new Error('数値の設定項目を確認してください。')
      if (key === 'tts.volume' && (number < 0 || number > 1)) throw new Error('音量は0から1で指定してください。')
      if (key === 'tts.port' && (!Number.isInteger(number) || number < 1 || number > 65535)) {
        throw new Error('ポートは1から65535の整数で指定してください。')
      }
      if (key === 'tts.speakerId' && (!Number.isInteger(number) || number < 0)) {
        throw new Error('話者IDは0以上の整数で指定してください。')
      }
      if (key === 'tts.speed') {
        const stackchan = values['tts.type'] === 'stackchan-voice'
        if (stackchan ? !Number.isInteger(number) || number < 1 || number > 65535 : number < 0.25 || number > 4) {
          throw new Error('選択した音声サービスの話速範囲を確認してください。')
        }
      }
    }
  }
}

export const isPreferenceKey = (value: string): value is PreferenceKey =>
  (PREFERENCE_KEYS as readonly string[]).includes(value)
