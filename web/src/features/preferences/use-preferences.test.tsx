import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { usePreferences } from '@/features/preferences/use-preferences'
import { DEFAULT_PREFERENCES } from '@/features/preferences/preference-model'
import { type PreferenceClient, type PreferenceValue } from '@/services/preferences/ble-preference-client'

describe('usePreferences', () => {
  it('keeps remote values, dirty fields, and batched save in application state', async () => {
    let connected = false
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {
        connected = true
      },
      disconnect: async () => {
        connected = false
      },
      isConnected: () => connected,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )

    await act(() => result.current.connect())
    expect(result.current.connected).toBe(true)
    act(() => notify({ prop: 'wifi.ssid', value: 'stackchan' }))
    expect(result.current.values['wifi.ssid']).toBe('stackchan')
    act(() => result.current.update('wifi.ssid', 'new-network'))
    act(() => notify({ prop: 'wifi.ssid', value: 'stale-remote' }))
    expect(result.current.values['wifi.ssid']).toBe('new-network')
    await act(() => result.current.save())
    expect(send).toHaveBeenCalledWith({ _batch: { 'wifi.ssid': 'new-network' } })
  })

  it('does not edit fields marked read-only by the device', () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send: async () => {},
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => notify({ prop: 'driver.type', value: 'fixed', readOnly: true }))
    act(() => result.current.update('driver.type', 'changed'))
    expect(result.current.values['driver.type']).toBe('fixed')
  })

  it('loads and saves the MCP server token', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )

    act(() => notify({ prop: 'mcp.token', value: 'old-token' }))
    expect(result.current.values['mcp.token']).toBe('old-token')

    act(() => result.current.update('mcp.token', 'new-token'))
    await act(() => result.current.save())

    expect(send).toHaveBeenCalledWith({ _batch: { 'mcp.token': 'new-token' } })
  })

  it('does not save a field reverted to its current device value', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => notify({ prop: 'wifi.ssid', value: 'stackchan' }))
    act(() => result.current.update('wifi.ssid', 'new-network'))
    act(() => result.current.update('wifi.ssid', 'stackchan'))

    await act(() => result.current.save())

    expect(send).not.toHaveBeenCalled()
    expect(result.current.operation).toMatchObject({ status: 'cancelled' })
  })

  it('keeps cleared Wi-Fi fields retryable when the immediate save fails', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(undefined)
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((onValue) => {
        notify = onValue
        return client
      })
    )
    act(() => {
      notify({ prop: 'wifi.ssid', value: 'stackchan' })
      notify({ prop: 'wifi.password', value: 'secret' })
    })

    await act(() => result.current.clearWifi())
    expect(result.current.operation.status).toBe('error')

    await act(() => result.current.save())
    expect(send).toHaveBeenNthCalledWith(1, { _batch: { 'wifi.ssid': '', 'wifi.password': '' } })
    expect(send).toHaveBeenNthCalledWith(2, { _batch: { 'wifi.ssid': '', 'wifi.password': '' } })
    expect(result.current.operation.status).toBe('success')
  })

  it('contains disconnect failures during unmount cleanup', async () => {
    const disconnect = vi.fn(async () => {
      throw new Error('adapter already closed')
    })
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect,
      isConnected: () => true,
      send: async () => {},
    }
    const { unmount } = renderHook(() => usePreferences(() => client))

    unmount()
    await Promise.resolve()

    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('reads and saves timezone and the newly exposed speech parameters without sending removed driver settings', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() =>
      usePreferences((handler) => {
        notify = handler
        return client
      })
    )
    act(() => {
      notify({ prop: 'time.timezone', value: 'tokyo' })
      notify({ prop: 'tts.type', value: 'voicevox' })
      notify({ prop: 'driver.offsetPan', value: 42 })
      notify({ prop: 'driver.type', value: 'm5stackchan' })
    })
    expect(result.current.values).not.toHaveProperty('driver.offsetPan')
    act(() => {
      result.current.update('time.timezone', 'delhi')
      result.current.update('tts.speakerId', '3')
      result.current.update('driver.type', 'scservo')
    })
    await act(() => result.current.save())
    expect(send).toHaveBeenCalledWith({ _batch: { 'time.timezone': 'delhi', 'tts.speakerId': '3' } })
  })

  it('does not overwrite advertised speech values when the service notification arrives late', () => {
    let notify: (value: PreferenceValue) => void = () => {}
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send: async () => {},
    }
    const { result } = renderHook(() =>
      usePreferences((handler) => {
        notify = handler
        return client
      })
    )
    act(() => {
      notify({ prop: 'tts.voice', value: 'custom-voice' })
      notify({ prop: 'tts.type', value: 'openai' })
    })
    expect(result.current.values['tts.voice']).toBe('custom-voice')
    expect(result.current.values['tts.speed']).toBe('1')
    expect(result.current.values['tts.model']).toBe('tts-1')
  })

  it('rejects invalid volume without writing and retains the edit for correction', async () => {
    const send = vi.fn(async () => {})
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() => usePreferences(() => client))
    act(() => result.current.update('tts.volume', '1.5'))
    await act(() => result.current.save())
    expect(send).not.toHaveBeenCalled()
    expect(result.current.operation.status).toBe('error')
    act(() => result.current.update('tts.volume', '0.51'))
    await act(() => result.current.save())
    expect(send).toHaveBeenCalledWith({ _batch: { 'tts.volume': '0.51' } })
  })

  it('clears the previous device values and ignores its pending save after reconnecting', async () => {
    let notify: (value: PreferenceValue) => void = () => {}
    let finishSave: () => void = () => {}
    let connected = false
    const client: PreferenceClient = {
      connect: async () => {
        connected = true
      },
      disconnect: async () => {
        connected = false
      },
      isConnected: () => connected,
      send: () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        }),
    }
    const { result } = renderHook(() =>
      usePreferences((handler) => {
        notify = handler
        return client
      })
    )
    await act(() => result.current.connect())
    act(() => {
      notify({ prop: 'wifi.password', value: 'previous-device-password' })
      notify({ prop: 'time.timezone', value: 'london' })
      result.current.update('tts.volume', '0.51')
    })
    let pending: Promise<void>
    act(() => {
      pending = result.current.save()
    })
    act(() => {
      connected = false
      client.onDisconnected?.()
    })
    await act(() => result.current.connect())
    expect(result.current.values).toEqual(DEFAULT_PREFERENCES)
    await act(async () => {
      finishSave()
      await pending!
    })
    expect(result.current.values).toEqual(DEFAULT_PREFERENCES)
    expect(result.current.operation).toMatchObject({ status: 'success', message: 'ｽﾀｯｸﾁｬﾝへ接続しました' })
  })

  it('keeps a newer edit dirty when an earlier save completes', async () => {
    let finishSave: () => void = () => {}
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve
        })
    )
    const client: PreferenceClient = {
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => true,
      send,
    }
    const { result } = renderHook(() => usePreferences(() => client))
    act(() => result.current.update('wifi.ssid', 'first'))
    let pending: Promise<void>
    act(() => {
      pending = result.current.save()
    })
    act(() => result.current.update('wifi.ssid', 'second'))
    await act(async () => {
      finishSave()
      await pending!
    })
    act(() => {
      pending = result.current.save()
    })
    expect(send).toHaveBeenLastCalledWith({ _batch: { 'wifi.ssid': 'second' } })
    await act(async () => {
      finishSave()
      await pending!
    })
  })
})
