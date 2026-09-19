import { useEffect, useState, useRef } from 'react'
import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { useSimulatorEngine } from './use-simulator-engine'
export function ConversationPanel({ controller }: { controller: ReturnType<typeof useSimulatorEngine> }) {
  const { t } = useI18n()
  const currentController = useRef(controller)
  currentController.current = controller
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [deviceId, setDeviceId] = useState('stackchan-01')
  const [microphone, setMicrophone] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState<{ state: string; transport: string; error?: string }>({
    state: 'standby',
    transport: 'disconnected',
  })
  useEffect(() => {
    const timer = setInterval(() => {
      const next = currentController.current.getConversationStatus()
      if (next) setStatus(next)
    }, 250)
    return () => clearInterval(timer)
  }, [])
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('会話')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            void controller.configureConversation({
              endpoint,
              token,
              microphone,
              deviceId,
              clientId: 'browser',
            })
          }}
        >
          <Label htmlFor="conversation-endpoint">Gateway URL</Label>
          <Input
            id="conversation-endpoint"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="ws://localhost:8765/"
          />
          <Label htmlFor="conversation-token">{t('Gatewayトークン')}</Label>
          <Input
            id="conversation-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <Label htmlFor="conversation-device">Device ID</Label>
          <Input id="conversation-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={microphone} onChange={(e) => setMicrophone(e.target.checked)} />
            {t('ブラウザのマイク')}
          </label>
          <Button type="submit">{t('適用して再起動')}</Button>
        </form>
        <p role="status" aria-label="Conversation status">
          {status.transport} / {status.state}
        </p>
        {status.error && <p role="alert">{status.error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={status.state !== 'speaking' && status.state !== 'recognizing'}
            onClick={() => controller.conversationCommand({ action: 'interrupt' })}>
            {t('応答を中断')}
          </Button>
          <Button onClick={() => controller.conversationCommand({ action: 'start' })}>{t('会話を開始')}</Button>
          <Button variant="outline" onClick={() => controller.conversationCommand({ action: 'stop' })}>
            {t('会話を停止')}
          </Button>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            controller.conversationCommand({ action: 'text', text })
            setText('')
          }}
        >
          <Input
            aria-label="Conversation text"
            value={text}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
          />
          <Button disabled={status.state !== 'listening' || !text.trim()} type="submit">
            {t('送信')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
