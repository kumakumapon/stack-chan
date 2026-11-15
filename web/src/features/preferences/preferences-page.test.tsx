import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { PreferencesPage } from '@/features/preferences/preferences-page'
import { DEFAULT_PREFERENCES } from '@/features/preferences/preference-model'
import { usePreferences } from '@/features/preferences/use-preferences'
import { type PreferenceClient, type PreferenceValue } from '@/services/preferences/ble-preference-client'

const { usePreferences: useRealPreferences } =
  await vi.importActual<typeof import('./use-preferences')>('./use-preferences')

vi.mock('@/features/preferences/use-preferences', () => ({
  usePreferences: vi.fn(),
}))

async function renderConnectedPreferences() {
  const user = userEvent.setup()
  let notify: (value: PreferenceValue) => void = () => {}
  let connected = false
  const send = vi.fn(async () => {})
  const client: PreferenceClient = {
    connect: async () => {
      connected = true
      for (const [prop, value] of Object.entries({
        ...DEFAULT_PREFERENCES,
        'tts.token': 'previous-provider-secret',
      })) {
        notify({ prop, value })
      }
    },
    disconnect: async () => {
      connected = false
    },
    isConnected: () => connected,
    send,
  }
  vi.mocked(usePreferences).mockImplementation(() =>
    useRealPreferences((handler) => {
      notify = handler
      return client
    })
  )
  render(
    <I18nProvider>
      <PreferencesPage />
    </I18nProvider>
  )
  await user.click(screen.getByRole('button', { name: 'BLEで接続' }))
  await screen.findByRole('button', { name: '切断' })
  return { user, send }
}

describe('PreferencesPage', () => {
  it('shows the MCP server token as a password field', () => {
    vi.mocked(usePreferences).mockReturnValue({
      connection: 'connected',
      connected: true,
      busy: false,
      values: DEFAULT_PREFERENCES,
      readOnly: new Set(),
      operation: { status: 'idle' },
      connect: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      update: vi.fn(),
      save: vi.fn(async () => {}),
      clearWifi: vi.fn(async () => {}),
    })

    render(
      <I18nProvider>
        <PreferencesPage />
      </I18nProvider>
    )

    const token = screen.getByLabelText('Bearerトークン')
    expect(token).toHaveAttribute('name', 'mcp.token')
    expect(token).toHaveAttribute('type', 'password')
  })

  it('shows supported defaults and face options without obsolete settings', async () => {
    const { user } = await renderConnectedPreferences()
    expect(screen.getByRole('combobox', { name: 'タイムゾーン' })).toHaveTextContent('東京 (UTC+09:00)')
    expect(screen.queryByLabelText('ドライバー')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('パン オフセット')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('チルト オフセット')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('システムロール')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('ホスト')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('音声サービストークン')).not.toBeInTheDocument()
    expect(screen.getByLabelText('音量（0–1）')).toHaveAttribute('step', '0.01')

    await user.click(screen.getByRole('combobox', { name: '顔の種類' }))
    expect(await screen.findByRole('option', { name: '画像' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '小さい顔' })).toBeInTheDocument()
  })

  it('saves only edited timezone and provider settings after an explicit save', async () => {
    const { user, send } = await renderConnectedPreferences()
    await user.click(screen.getByRole('combobox', { name: 'タイムゾーン' }))
    await user.click(await screen.findByRole('option', { name: /ロンドン.*UTC\+00:00/ }))

    await user.click(screen.getByRole('combobox', { name: 'サービス' }))
    expect(await screen.findByRole('option', { name: 'VOICEVOX Web (tts.quest)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Google TTS' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'リモートWAV' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'VOICEVOX' }))
    expect(screen.queryByLabelText('音声ID')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('話速（標準100）')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('ホスト'), 'voicevox.local')
    await user.clear(screen.getByLabelText('話者ID'))
    await user.type(screen.getByLabelText('話者ID'), '3')
    expect(send).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '設定を保存' }))
    expect(send).toHaveBeenCalledWith({
      _batch: {
        'time.timezone': 'london',
        'tts.type': 'voicevox',
        'tts.host': 'voicevox.local',
        'tts.port': '50021',
        'tts.speakerId': '3',
        'tts.token': '',
      },
    })
  })

  it('shows the Gateway fields only when Gateway conversation is selected', async () => {
    const { user } = await renderConnectedPreferences()
    expect(screen.queryByLabelText('Gateway URL')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: '会話モード' }))
    await user.click(await screen.findByRole('option', { name: 'Gateway' }))
    expect(screen.getByLabelText('Gateway URL')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: '会話モード' }))
    await user.click(await screen.findByRole('option', { name: 'USB' }))
    expect(screen.queryByLabelText('Gateway URL')).not.toBeInTheDocument()
  })
})
