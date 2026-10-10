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
  'companion.quietHours',
  'companion.quietStart',
  'companion.quietEnd',
  'wifi.ssid',
  'wifi.password',
  'driver.type',
  'driver.offsetPan',
  'driver.offsetTilt',
  'ui.type',
  'ui.language',
  'tts.type',
  'tts.host',
  'tts.port',
  'tts.token',
  'tts.voice',
  'tts.volume',
  'ai.token',
  'ai.context',
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
  'companion.quietHours': '0',
  'companion.quietStart': '1320',
  'companion.quietEnd': '420',
  'wifi.ssid': '',
  'wifi.password': '',
  'driver.type': 'm5stackchan',
  'driver.offsetPan': '0',
  'driver.offsetTilt': '0',
  'ui.type': 'simple',
  'ui.language': 'ja',
  'tts.type': 'voicevox',
  'tts.host': '',
  'tts.port': '',
  'tts.token': '',
  'tts.voice': '',
  'tts.volume': '1',
  'ai.token': '',
  'ai.context': '',
  'mcp.token': '',
}

/** Half-hour choices for quiet hours; values are minutes since midnight (0-1439), the only form the device accepts. */
export const quietTimeOptions = (): { value: string; label: string; translate: false }[] =>
  Array.from({ length: 48 }, (_, index) => {
    const minutes = index * 30
    const hh = String(Math.floor(minutes / 60)).padStart(2, '0')
    const mm = String(minutes % 60).padStart(2, '0')
    return { value: String(minutes), label: `${hh}:${mm}`, translate: false }
  })

export const isPreferenceKey = (value: string): value is PreferenceKey =>
  (PREFERENCE_KEYS as readonly string[]).includes(value)
