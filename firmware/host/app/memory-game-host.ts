import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { createMemoryGameScheduler } from 'memory-game'
import { createMemoryGameApp } from 'memory-game-mini-app'
import Timer from 'timer'

export function installMemoryGame(context: StackchanContext): void {
  const unregister = context.ui.miniApps.register(
    createMemoryGameApp({
      random: Math.random,
      schedule: createMemoryGameScheduler(Timer),
      react(name) {
        // Explicit user activity and another MOD's animation always win.
        if (
          context.audio.isActive ||
          context.performance.status().active ||
          context.reaction.status().active ||
          context.conversation.remoteSession?.activationState === 'active'
        )
          return undefined
        const result = context.reaction.playOwned?.(name, { intensity: 0.3, restore: true })
        return result?.ok
          ? () => {
              result.cancel()
            }
          : undefined
      },
      suppressIdle: () => suppressCompanionIdle(context),
    }),
  )
  context.lifecycle.onClose(unregister)
}
