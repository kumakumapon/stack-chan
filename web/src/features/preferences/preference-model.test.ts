import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PREFERENCES,
  isPreferenceKey,
  PREFERENCE_KEYS,
  quietTimeOptions,
} from '@/features/preferences/preference-model'

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
})
