import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { useSimulatorEngine } from './use-simulator-engine'
export function ConversationPanel({ controller }: { controller: ReturnType<typeof useSimulatorEngine> }) {
  const [endpoint, setEndpoint] = useState('')
  const [token, setToken] = useState('')
  const [microphone, setMicrophone] = useState(false)
  const [text, setText] = useState('')
  const [status, setStatus] = useState({ state: 'standby', transport: 'disconnected' })
  useEffect(() => {
    const timer = setInterval(() => {
      const next = controller.getConversationStatus()
      if (next) setStatus(next)
    }, 250)
    return () => clearInterval(timer)
  }, [controller])
  return (
    <Card className="page-container my-4">
      <CardHeader>
        <CardTitle>Conversation</CardTitle>
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
              deviceId: 'simulator',
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
          <Label htmlFor="conversation-token">Gateway token</Label>
          <Input
            id="conversation-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={microphone} onChange={(e) => setMicrophone(e.target.checked)} />
            Browser microphone
          </label>
          <Button type="submit">Apply and restart</Button>
        </form>
        <p role="status" aria-label="Conversation status">
          {status.transport} / {status.state}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => controller.conversationCommand({ action: 'start' })}>Start conversation</Button>
          <Button variant="outline" onClick={() => controller.conversationCommand({ action: 'stop' })}>
            Stop conversation
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
            Send
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
