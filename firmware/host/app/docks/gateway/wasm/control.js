import exchange from 'stackchan-gateway-browser'
import Timer from 'timer'
export default function install(context) {
  const session = context.conversation.remoteSession
  let errorMessage
  const timer = Timer.repeat(() => {
    const command = exchange({ action: 'control' })
    try {
      if (command) errorMessage = undefined
      if (command && !session) throw new Error('Configure a Gateway and restart before starting a conversation')
      if (command?.action === 'start') {
        context.performance.cancel()
        context.reaction.cancel()
        if (session?.activationState === 'active') session.deactivate()
        session?.activate()
        session?.requestStart()
      }
      if (command?.action === 'interrupt') session?.interrupt?.()
      if (command?.action === 'stop') session?.deactivate()
      if (command?.action === 'text') session?.sendText?.(command.text)
    } catch (error) {
      errorMessage = String(error)
      context.showBalloon(String(error))
    }
    exchange({
      action: 'status',
      status: {
        state: session?.state ?? 'standby',
        transport: session?.transportState ?? 'disconnected',
        activation: session?.activationState ?? 'inactive',
        error: errorMessage ?? session?.lastError,
      },
    })
  }, 50)
  context.lifecycle.onClose?.(() => {
    Timer.clear(timer)
    exchange({ action: 'close' })
  })
}
