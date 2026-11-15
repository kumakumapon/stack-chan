import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PREFERENCES,
  isPreferenceKey,
  type PreferenceKey,
  type PreferenceValues,
  PREFERENCE_KEYS,
  validatePreferenceChanges,
  ttsDefaults,
} from '@/features/preferences/preference-model'
import { type OperationState } from '@/features/operations/operation-state'
import { toAppError } from '@/lib/errors/app-error'
import {
  BlePreferenceClient,
  type PreferenceClient,
  type PreferenceValue,
} from '@/services/preferences/ble-preference-client'

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
type ClientFactory = (onValue: (value: PreferenceValue) => void) => PreferenceClient

export function usePreferences(
  clientFactory: ClientFactory = (onValue) => new BlePreferenceClient({ deviceName: 'STK', onValue })
) {
  const [connection, setConnection] = useState<ConnectionState>('disconnected')
  const [values, setValues] = useState<PreferenceValues>(DEFAULT_PREFERENCES)
  const [readOnly, setReadOnly] = useState<Set<PreferenceKey>>(() => new Set(['driver.type']))
  const [operation, setOperation] = useState<OperationState>({ status: 'idle' })
  const currentValues = useRef<Partial<PreferenceValues>>({})
  const dirty = useRef(new Set<PreferenceKey>())
  const readOnlyRef = useRef(new Set<PreferenceKey>(['driver.type']))
  const valuesRef = useRef<PreferenceValues>(DEFAULT_PREFERENCES)
  const connectionVersion = useRef(0)
  const valueHandler = useRef<(value: PreferenceValue) => void>(() => {})
  const client = useRef<PreferenceClient | undefined>(undefined)

  const resetValues = useCallback(() => {
    connectionVersion.current++
    currentValues.current = {}
    dirty.current.clear()
    readOnlyRef.current = new Set(['driver.type'])
    valuesRef.current = { ...DEFAULT_PREFERENCES }
    setReadOnly(new Set(['driver.type']))
    setValues(valuesRef.current)
  }, [])

  valueHandler.current = ({ prop, value, readOnly: isReadOnly = false }) => {
    if (!isPreferenceKey(prop) || !['string', 'number', 'boolean'].includes(typeof value)) return
    const normalized = String(value)
    if (prop === 'tts.type' && !dirty.current.has(prop)) {
      const defaults = ttsDefaults(normalized)
      for (const key of PREFERENCE_KEYS) {
        const fallback = defaults[key]
        if (fallback !== undefined && currentValues.current[key] === undefined && !dirty.current.has(key)) {
          valuesRef.current = { ...valuesRef.current, [key]: fallback }
        }
      }
    }
    currentValues.current[prop] = normalized
    const nextReadOnly = new Set(readOnlyRef.current)
    if (isReadOnly || prop === 'driver.type') {
      nextReadOnly.add(prop)
      dirty.current.delete(prop)
    } else {
      nextReadOnly.delete(prop)
    }
    readOnlyRef.current = nextReadOnly
    setReadOnly(nextReadOnly)
    if (!dirty.current.has(prop)) {
      valuesRef.current = { ...valuesRef.current, [prop]: normalized }
      setValues(valuesRef.current)
    }
  }

  if (!client.current) client.current = clientFactory((value) => valueHandler.current(value))

  useEffect(() => {
    const activeClient = client.current
    if (!activeClient) return
    activeClient.onDisconnected = () => {
      resetValues()
      setConnection('disconnected')
      setOperation({
        status: 'cancelled',
        message: '接続が切れました。再接続して本体の設定を読み直してください。',
      })
    }
    return () => {
      activeClient.onDisconnected = undefined
      if (activeClient.isConnected()) activeClient.disconnect().catch(() => {})
    }
  }, [resetValues])

  const connect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    resetValues()
    setConnection('connecting')
    setOperation({ status: 'pending', message: 'BLEデバイスを検索しています' })
    try {
      await activeClient.connect()
      setConnection('connected')
      setOperation({ status: 'success', result: undefined, message: 'ｽﾀｯｸﾁｬﾝへ接続しました' })
    } catch (error) {
      setConnection('disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-connect') })
    }
  }, [resetValues])

  const disconnect = useCallback(async () => {
    const activeClient = client.current
    if (!activeClient) return
    setConnection('disconnecting')
    try {
      await activeClient.disconnect()
      resetValues()
      setConnection('disconnected')
      setOperation({ status: 'cancelled', message: 'BLE接続を切断しました' })
    } catch (error) {
      setConnection(activeClient.isConnected() ? 'connected' : 'disconnected')
      setOperation({ status: 'error', error: toAppError(error, 'ble-disconnect') })
    }
  }, [resetValues])

  const update = useCallback((key: PreferenceKey, value: string) => {
    if (!isPreferenceKey(key) || readOnlyRef.current.has(key)) return
    if (currentValues.current[key] === value) dirty.current.delete(key)
    else dirty.current.add(key)
    valuesRef.current = { ...valuesRef.current, [key]: value }
    setValues(valuesRef.current)
  }, [])

  const savePayload = useCallback(async (payload: Partial<PreferenceValues>, successMessage: string) => {
    const activeClient = client.current
    if (!activeClient?.isConnected()) return
    const entries = PREFERENCE_KEYS.flatMap((key) => {
      const value = payload[key]
      return value === undefined || readOnlyRef.current.has(key) ? [] : [[key, value] as const]
    })
    if (entries.length === 0) {
      setOperation({ status: 'cancelled', message: '変更する項目がありません。' })
      return
    }
    const batch = Object.fromEntries(entries)
    const version = connectionVersion.current
    try {
      validatePreferenceChanges(batch, valuesRef.current)
      setOperation({ status: 'pending', message: '設定を保存しています' })
      await activeClient.send({ _batch: batch })
      if (version !== connectionVersion.current || !activeClient.isConnected()) return
      for (const [key, value] of entries) {
        currentValues.current[key] = value
        if (valuesRef.current[key] === value) dirty.current.delete(key)
      }
      setOperation({ status: 'success', result: undefined, message: successMessage })
    } catch (error) {
      if (version !== connectionVersion.current) return
      setOperation({ status: 'error', error: toAppError(error, 'preference-save') })
    }
  }, [])

  const save = useCallback(() => {
    const payload: Partial<PreferenceValues> = {}
    for (const key of dirty.current) {
      if (!readOnlyRef.current.has(key) && currentValues.current[key] !== valuesRef.current[key]) {
        payload[key] = valuesRef.current[key]
      }
    }
    return savePayload(payload, '設定を送信しました。')
  }, [savePayload])

  const clearWifi = useCallback(async () => {
    dirty.current.add('wifi.ssid')
    dirty.current.add('wifi.password')
    valuesRef.current = { ...valuesRef.current, 'wifi.ssid': '', 'wifi.password': '' }
    setValues(valuesRef.current)
    await savePayload(
      { 'wifi.ssid': '', 'wifi.password': '' },
      'Wi-Fi設定を消去しました。再起動後はオフラインになります。'
    )
  }, [savePayload])

  return {
    connection,
    connected: connection === 'connected',
    busy: connection === 'connecting' || connection === 'disconnecting' || operation.status === 'pending',
    values,
    readOnly,
    operation,
    connect,
    disconnect,
    update,
    save,
    clearWifi,
  }
}
