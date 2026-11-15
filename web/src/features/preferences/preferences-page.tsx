import { Bluetooth, Info, Save, Trash2, Unplug } from 'lucide-react'
import { useState, type ComponentProps, type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  FACE_OPTIONS,
  PREFERENCE_KEYS,
  type PreferenceKey,
  quietTimeOptions,
  timezoneOptions,
  TTS_OPTIONS,
  ttsFields,
  ttsServiceChanges,
} from '@/features/preferences/preference-model'
import { usePreferences } from '@/features/preferences/use-preferences'

type FieldProps = Omit<ComponentProps<'input'>, 'id' | 'name' | 'value' | 'disabled' | 'onChange'> & {
  name: PreferenceKey
  label: string
  wide?: boolean
}

export function PreferencesPage() {
  const { t } = useI18n()
  const preferences = usePreferences()
  const [clearDialogOpen, setClearDialogOpen] = useState(false)
  const ttsService = preferences.values['tts.type']
  const activeTtsFields = ttsFields(ttsService)
  const gateway = preferences.values['conversation.backend'] === 'gateway'

  const inputField = ({ name, label, type = 'text', wide, ...props }: FieldProps) => (
    <div className={wide ? 'grid gap-2 sm:col-span-2' : 'grid gap-2'}>
      <Label htmlFor={name}>{t(label)}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        value={preferences.values[name]}
        disabled={!preferences.connected || preferences.busy || preferences.readOnly.has(name)}
        onChange={(event) => preferences.update(name, event.target.value)}
        {...props}
      />
    </div>
  )

  const selectField = (
    name: PreferenceKey,
    label: string,
    options: readonly { value: string; label: string; translate?: boolean }[],
    hint?: string,
    wide = false
  ) => (
    <div className={wide ? 'grid gap-2 sm:col-span-2' : 'grid gap-2'}>
      <Label htmlFor={name}>{t(label)}</Label>
      <Select
        items={options.map((option) => ({
          value: option.value,
          label: option.translate === false ? option.label : t(option.label),
        }))}
        value={preferences.values[name]}
        disabled={!preferences.connected || preferences.busy || preferences.readOnly.has(name)}
        onValueChange={(value) => {
          if (!value) return
          if (name === 'tts.type') {
            const changes = ttsServiceChanges(value, preferences.values)
            for (const key of PREFERENCE_KEYS) {
              const next = changes[key]
              if (next !== undefined) preferences.update(key, next)
            }
          } else preferences.update(name, value)
        }}
      >
        <SelectTrigger id={name} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {preferences.values[name] && !options.some((option) => option.value === preferences.values[name]) && (
            <SelectItem value={preferences.values[name]} disabled>
              {t('保存済みの値: {value}', { value: preferences.values[name] })}
            </SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span translate={option.translate === false ? 'no' : undefined}>
                {option.translate === false ? option.label : t(option.label)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && <p className="text-xs leading-5 text-muted-foreground">{t(hint)}</p>}
    </div>
  )

  const section = (title: string, children: ReactNode, description?: string) => (
    <Card>
      <CardHeader>
        <CardTitle>{t(title)}</CardTitle>
        {description && <CardDescription>{t(description)}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  )

  return (
    <>
      <div className="page-container grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="grid gap-4 lg:sticky lg:top-22">
          <Card>
            <CardHeader>
              <CardTitle>{t('本体設定')}</CardTitle>
              <CardDescription>{t('BLEでｽﾀｯｸﾁｬﾝに接続します。')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Alert role="note">
                <Info aria-hidden="true" />
                <AlertDescription>
                  {t('接続する前に、ｽﾀｯｸﾁｬﾝの起動画面で「設定」を押し、本体の設定画面を開いてください。')}
                </AlertDescription>
              </Alert>
              {preferences.connected ? (
                <Button variant="destructive" onClick={() => void preferences.disconnect()} disabled={preferences.busy}>
                  <Unplug data-icon="inline-start" />
                  {t('切断')}
                </Button>
              ) : (
                <Button onClick={() => void preferences.connect()} disabled={preferences.busy}>
                  <Bluetooth data-icon="inline-start" />
                  {t(preferences.connection === 'connecting' ? '接続中…' : 'BLEで接続')}
                </Button>
              )}
              <p className="text-sm text-muted-foreground" role="status">
                {t(preferences.connected ? '接続済み' : '未接続')}
              </p>
            </CardContent>
          </Card>
          <OperationStatus
            state={preferences.operation}
            labels={{
              pending: t('処理中'),
              success: t('設定を更新しました'),
              cancelled: t('お知らせ'),
              error: t('設定操作に失敗しました'),
            }}
          />
        </aside>

        <form
          className="grid min-w-0 gap-5"
          aria-label={t('設定項目')}
          onSubmit={(event) => {
            event.preventDefault()
            void preferences.save()
          }}
        >
          <Alert role="note">
            <Info aria-hidden="true" />
            <AlertDescription>
              {t('保存後は本体を再起動してください。言語・タイムゾーン・音量は本体の設定画面にすぐ反映されます。')}
            </AlertDescription>
          </Alert>
          {section(
            'Wi-Fi',
            <>
              {inputField({ name: 'wifi.ssid', label: 'SSID', autoComplete: 'off' })}
              {inputField({
                name: 'wifi.password',
                label: 'パスワード',
                type: 'password',
                autoComplete: 'off',
              })}
              <div className="sm:col-span-2">
                <Button
                  type="button"
                  variant="destructive"
                  disabled={!preferences.connected || preferences.busy}
                  onClick={() => setClearDialogOpen(true)}
                >
                  <Trash2 data-icon="inline-start" />
                  {t('Wi-Fi設定を消去')}
                </Button>
              </div>
            </>
          )}
          {section(
            '外観',
            <>
              {selectField('ui.type', '顔の種類', FACE_OPTIONS)}
              {selectField('ui.language', '本体の表示言語', [
                { value: 'ja', label: '日本語', translate: false },
                { value: 'en', label: 'English', translate: false },
              ])}
            </>
          )}
          {section(
            '時刻',
            <>
              {selectField(
                'time.timezone',
                'タイムゾーン',
                timezoneOptions(t),
                '本体の時計とおやすみ時間帯に使用します。UTCとの差は固定で、夏時間は自動切替しません。',
                true
              )}
            </>
          )}
          {section(
            '音声合成',
            <>
              {selectField(
                'tts.type',
                'サービス',
                TTS_OPTIONS,
                'サービスを切り替えると音声・話速・モデルなどを初期値に戻し、トークンを空にします。保存前に接続先と認証情報を確認してください。',
                true
              )}
              {activeTtsFields.includes('tts.host') &&
                inputField({ name: 'tts.host', label: 'ホスト', placeholder: 'my-tts-host.local', required: true })}
              {activeTtsFields.includes('tts.port') &&
                inputField({
                  name: 'tts.port',
                  label: 'ポート',
                  type: 'number',
                  min: '1',
                  max: '65535',
                  step: '1',
                  required: true,
                })}
              {activeTtsFields.includes('tts.speakerId') &&
                inputField({
                  name: 'tts.speakerId',
                  label: '話者ID',
                  type: 'number',
                  min: '0',
                  step: '1',
                  required: true,
                })}
              {activeTtsFields.includes('tts.token') &&
                inputField({ name: 'tts.token', label: '音声サービストークン', type: 'password', autoComplete: 'off' })}
              {activeTtsFields.includes('tts.voice') &&
                (ttsService === 'stackchan-voice'
                  ? selectField('tts.voice', '音声', [
                      { value: 'normal', label: '標準' },
                      { value: 'cute', label: 'かわいい' },
                    ])
                  : inputField({ name: 'tts.voice', label: '音声ID', required: true }))}
              {activeTtsFields.includes('tts.speed') &&
                inputField({
                  name: 'tts.speed',
                  label: ttsService === 'stackchan-voice' ? '話速（標準100）' : '話速（標準1）',
                  type: 'number',
                  min: ttsService === 'stackchan-voice' ? '1' : '0.25',
                  max: ttsService === 'stackchan-voice' ? '65535' : '4',
                  step: ttsService === 'stackchan-voice' ? '1' : '0.01',
                  required: true,
                })}
              {activeTtsFields.includes('tts.model') &&
                inputField({ name: 'tts.model', label: '音声モデル', required: true })}
              {activeTtsFields.includes('tts.instructions') && (
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="tts.instructions">{t('音声への指示（対応モデルのみ）')}</Label>
                  <Textarea
                    id="tts.instructions"
                    rows={3}
                    value={preferences.values['tts.instructions']}
                    disabled={
                      !preferences.connected || preferences.busy || preferences.readOnly.has('tts.instructions')
                    }
                    onChange={(event) => preferences.update('tts.instructions', event.target.value)}
                  />
                </div>
              )}
              {inputField({
                name: 'tts.volume',
                label: '音量（0–1）',
                type: 'number',
                step: '0.01',
                min: '0',
                max: '1',
              })}
            </>
          )}
          {section(
            '会話',
            <>
              {selectField('conversation.backend', '会話モード', [
                { value: 'none', label: 'オフ' },
                { value: 'gateway', label: 'Gateway', translate: false },
                { value: 'usb', label: 'USB', translate: false },
              ])}
              {preferences.values['conversation.backend'] !== 'none' &&
                selectField('conversation.autoStart', '起動時に接続', [
                  { value: '0', label: 'オフ' },
                  { value: '1', label: 'オン' },
                ])}
              {gateway &&
                inputField({
                  name: 'gateway.endpoint',
                  label: 'Gateway URL',
                  placeholder: 'ws://192.168.1.10:8765/',
                  wide: true,
                })}
              {gateway && inputField({ name: 'gateway.deviceId', label: 'Device ID' })}
              {gateway && inputField({ name: 'gateway.clientId', label: 'Client ID' })}
              {gateway &&
                inputField({ name: 'gateway.token', label: 'Gatewayトークン', type: 'password', autoComplete: 'off' })}
              {gateway &&
                selectField('gateway.microphone', 'マイクを使用', [
                  { value: '0', label: 'オフ' },
                  { value: '1', label: 'オン' },
                ])}
              <p className="text-sm text-muted-foreground sm:col-span-2">
                {t('会話設定は再起動後に反映されます。AIのAPIキーはGateway側で設定します。')}
              </p>
            </>
          )}
          {section(
            'Companion',
            <>
              {selectField('companion.greetingOnBoot', '起動時の挨拶', [
                { value: '0', label: 'オフ' },
                { value: '1', label: 'オン' },
              ])}
              {selectField('companion.idleReactions', '待機中のリアクション', [
                { value: '0', label: 'オフ' },
                { value: '1', label: 'オン' },
              ])}
              {selectField('companion.lowBatteryNotice', '低電池のお知らせ', [
                { value: '0', label: 'オフ' },
                { value: '1', label: 'オン' },
              ])}
              {selectField(
                'companion.quietHours',
                'おやすみ時間帯',
                [
                  { value: '0', label: 'オフ' },
                  { value: '1', label: 'オン' },
                ],
                'オンにすると、時刻同期後のおやすみ時間帯は待機中のリアクションを控えめなあくびだけにします。',
                true
              )}
              {selectField(
                'companion.quietStart',
                'おやすみ開始',
                quietTimeOptions(preferences.values['companion.quietStart'])
              )}
              {selectField(
                'companion.quietEnd',
                'おやすみ終了',
                quietTimeOptions(preferences.values['companion.quietEnd'])
              )}
            </>
          )}
          <details className="grid gap-4">
            <summary className="cursor-pointer py-2 font-medium">{t('MOD向けの設定')}</summary>
            <div className="grid gap-5 pt-3">
              {section(
                'AI MOD',
                <>
                  {inputField({ name: 'ai.token', label: 'AI MODトークン', type: 'password', autoComplete: 'off' })}
                  {!activeTtsFields.includes('tts.host') &&
                    inputField({ name: 'tts.host', label: 'MODの音声認識ホスト', placeholder: 'stackchan-base.local' })}
                </>,
                '対応するAI MODのAPIキーと音声認識ホストです。音声合成のホストと共通の値を使います。Gatewayの会話設定には使用しません。'
              )}
              {section(
                'MCP Server',
                <>
                  {inputField({
                    name: 'mcp.token',
                    label: 'Bearerトークン',
                    type: 'password',
                    wide: true,
                    autoComplete: 'off',
                  })}
                </>,
                'MCP Serverを使うMOD向けの認証設定です。'
              )}
            </div>
          </details>
          <footer className="sticky bottom-0 z-10 flex justify-end border-t bg-background/95 py-3 backdrop-blur">
            <Button type="submit" disabled={!preferences.connected || preferences.busy}>
              <Save data-icon="inline-start" />
              {t('設定を保存')}
            </Button>
          </footer>
        </form>
      </div>

      <AlertDialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Wi-Fi設定を消去しますか？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('保存済みのSSIDとパスワードを消去します。次回はオフラインで起動します。')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('キャンセル')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setClearDialogOpen(false)
                void preferences.clearWifi()
              }}
            >
              {t('消去する')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
