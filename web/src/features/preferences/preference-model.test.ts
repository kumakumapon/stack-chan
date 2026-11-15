import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  isPreferenceKey,
  PREFERENCE_KEYS,
  quietTimeOptions,
  timezoneOptions,
  ttsFields,
  ttsServiceChanges,
  validatePreferenceChanges,
} from '@/features/preferences/preference-model'
import { TIMEZONE_PRESETS, getTimezonePreset } from 'timezone-model'

describe('preference model', () => {
  it('uses the canonical ui domain for the face type preference', () => {
    const preferenceKeys = new Set<string>(PREFERENCE_KEYS)

    expect(preferenceKeys.has('ui.type')).toBe(true)
    expect(isPreferenceKey('ui.type')).toBe(true)
    expect(preferenceKeys.has('renderer.type')).toBe(false)
    expect(isPreferenceKey('renderer.type')).toBe(false)
  })

  it('accepts the MCP server token advertised by the firmware', () => {
    expect(isPreferenceKey('mcp.token')).toBe(true)
    expect(DEFAULT_PREFERENCES['mcp.token']).toBe('')
  })

  it('accepts the low-battery notice setting and treats it as enabled by default', () => {
    expect(isPreferenceKey('companion.lowBatteryNotice')).toBe(true)
    expect(DEFAULT_PREFERENCES['companion.lowBatteryNotice']).not.toBe('0')
  })

  it('keeps quiet hours off by default and defaults to a window the device accepts', () => {
    expect(DEFAULT_PREFERENCES['companion.quietHours']).toBe('0')
    const minutes = quietTimeOptions().map((option) => Number(option.value))
    expect(minutes).toContain(Number(DEFAULT_PREFERENCES['companion.quietStart']))
    expect(minutes).toContain(Number(DEFAULT_PREFERENCES['companion.quietEnd']))
  })

  it('offers only integer minute values 0-1439 with matching HH:MM labels', () => {
    const options = quietTimeOptions()
    expect(options).toHaveLength(48)
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length)
    for (const option of options) {
      const minutes = Number(option.value)
      expect(Number.isInteger(minutes)).toBe(true)
      expect(minutes).toBeGreaterThanOrEqual(0)
      expect(minutes).toBeLessThanOrEqual(1439)
      const [hh, mm] = option.label.split(':').map(Number)
      expect(hh * 60 + mm).toBe(minutes)
    }
  })

  it('preserves saved quiet-hour times between the half-hour choices', () => {
    const options = quietTimeOptions('1337')
    expect(options.find((option) => option.value === '1337')?.label).toBe('22:17')
    expect(quietTimeOptions('1440')).toEqual(quietTimeOptions())
    expect(quietTimeOptions('-1')).toEqual(quietTimeOptions())
  })

  it('uses every firmware time zone with the same ID and offset, including half-hour offsets', () => {
    const options = timezoneOptions((key) => `translated:${key}`)
    expect(options.map((option) => option.value)).toEqual(TIMEZONE_PRESETS.map((preset) => preset.id))
    const delhi = options.find((option) => option.value === 'delhi')!
    expect(delhi.label).toContain('translated:timezone.city.delhi')
    expect(delhi.label).toContain('UTC+05:30')
    expect(getTimezonePreset(delhi.value).offsetMinutes).toBe(330)
  })

  it('switches provider units and credentials explicitly without changing unrelated settings', () => {
    const original = { ...DEFAULT_PREFERENCES, 'tts.token': 'previous-provider-secret', 'wifi.ssid': 'saved-network' }
    const openai = ttsServiceChanges('openai', original)
    expect(openai).toMatchObject({ 'tts.type': 'openai', 'tts.voice': 'alloy', 'tts.speed': '1', 'tts.token': '' })
    expect(openai).not.toHaveProperty('wifi.ssid')
    expect(original['tts.token']).toBe('previous-provider-secret')
    const stackchan = ttsServiceChanges('stackchan-voice', { ...original, ...openai })
    expect(stackchan).toMatchObject({ 'tts.voice': 'normal', 'tts.speed': '100' })
    expect(ttsServiceChanges('google-tts', original)).toEqual({})
    expect(ttsServiceChanges(original['tts.type'], original)).toEqual({})
  })

  it('only offers settings used by the chosen speech engine', () => {
    expect(ttsFields('local')).toEqual([])
    expect(ttsFields('voicevox')).toContain('tts.speakerId')
    expect(ttsFields('voicevox')).not.toContain('tts.voice')
    expect(ttsFields('voicevox-web')).toContain('tts.token')
    expect(ttsFields('voicevox-web')).not.toContain('tts.host')
    expect(ttsFields('stackchan-voice')).not.toContain('tts.token')
    expect(ttsFields('openai')).toContain('tts.instructions')
    expect(ttsFields('__proto__')).toEqual([])
  })

  it('rejects invalid numbers and time zones before a BLE write', () => {
    for (const [key, value] of [
      ['tts.volume', '1.01'],
      ['tts.volume', 'NaN'],
      ['tts.volume', ''],
      ['tts.port', '65536'],
      ['tts.port', '1.5'],
      ['tts.speakerId', '-1'],
      ['tts.speed', '0'],
      ['tts.speed', '1.5'],
      ['time.timezone', 'unknown'],
    ] as const) {
      expect(() => validatePreferenceChanges({ [key]: value }, DEFAULT_PREFERENCES)).toThrow()
    }
    expect(() =>
      validatePreferenceChanges(
        { 'tts.volume': '0.51', 'tts.speakerId': '0', 'time.timezone': 'delhi' },
        DEFAULT_PREFERENCES
      )
    ).not.toThrow()
    expect(() =>
      validatePreferenceChanges({ 'tts.speed': '0.5' }, { ...DEFAULT_PREFERENCES, 'tts.type': 'openai' })
    ).not.toThrow()
    expect(() =>
      validatePreferenceChanges({ 'tts.speed': '100' }, { ...DEFAULT_PREFERENCES, 'tts.type': 'openai' })
    ).toThrow()
  })
})
