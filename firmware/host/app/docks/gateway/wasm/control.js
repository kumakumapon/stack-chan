import exchange from 'stackchan-gateway-browser'
import Timer from 'timer'
export default function install(context) {
  const session = context.conversation.remoteSession
  const timer = Timer.repeat(() => {
    const command = exchange({ action: 'control' })
    try {
      if (command?.action === 'start') {
        context.performance.cancel()
        context.reaction.cancel()
        session?.activate()
        session?.requestStart()
      }
      if (command?.action === 'stop') session?.deactivate()
      if (command?.action === 'text') session?.sendText?.(command.text)
    } catch (error) {
      context.showBalloon(String(error))
    }
    exchange({
      action: 'status',
      status: {
        state: session?.state ?? 'standby',
        transport: session?.transportState ?? 'disconnected',
        activation: session?.activationState ?? 'inactive',
        error: session?.lastError,
      },
    })
  }, 50)
  context.lifecycle.onClose?.(() => {
    Timer.clear(timer)
    exchange({ action: 'close' })
  })
}
