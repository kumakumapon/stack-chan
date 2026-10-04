import { localize } from 'localization'
import { MEMORY_GAME_SYMBOLS, MemoryGame, type MemoryGameOptions } from 'memory-game'
import type { MiniAppDefinition } from 'mini-app'
import { Container, Label, type Container as PiuContainer } from 'piu/MC'
import { ActionButton, type ActionButtonBehavior } from 'ui-controls'
import { uiStyles } from 'ui-theme'

export const MEMORY_GAME_APP_ID = 'stackchan.memory-game'

export function createMemoryGameApp(options: MemoryGameOptions & { suppressIdle(): () => void }): MiniAppDefinition {
  return {
    id: MEMORY_GAME_APP_ID,
    title: localize('memory.title'),
    icon: 'play',
    create({ reportResult }) {
      const styles = uiStyles()
      const game = new MemoryGame({ ...options, onResult: reportResult })
      const releaseIdle = options.suppressIdle()
      const status = new Label(null, {
        name: 'memoryStatus',
        left: 8,
        right: 8,
        top: 0,
        height: 20,
        style: styles.title,
      })
      const progress = new Label(null, {
        name: 'memoryProgress',
        left: 8,
        right: 8,
        top: 20,
        height: 18,
        style: styles.bodyMuted,
      })
      const prompt = new Label(null, {
        name: 'memoryPrompt',
        left: 8,
        right: 8,
        top: 38,
        height: 20,
        style: styles.body,
      })
      const pads = MEMORY_GAME_SYMBOLS.map(
        (symbol, index) =>
          new Container(null, {
            name: `memory:${symbol}`,
            left: 8 + index * 104,
            top: 62,
            width: 96,
            height: 68,
            skin: styles.surface,
            contents: [
              new Label(null, {
                left: 0,
                right: 0,
                top: 4,
                height: 30,
                string: String(index + 1),
                style: styles.brand,
              }),
              new Label(null, {
                left: 0,
                right: 0,
                top: 36,
                height: 24,
                string: localize(`memory.${symbol}`),
                style: styles.button,
              }),
            ],
            Behavior: class extends Behavior {
              pressed = false
              x = 0
              y = 0
              onTouchBegan(_container: PiuContainer, _id: number, x: number, y: number) {
                this.pressed = true
                this.x = x
                this.y = y
              }
              onTouchMoved(_container: PiuContainer, _id: number, x: number, y: number) {
                if (Math.abs(x - this.x) > 8 || Math.abs(y - this.y) > 8) this.pressed = false
              }
              onTouchCancelled() {
                this.pressed = false
              }
              onTouchEnded() {
                const pressed = this.pressed
                this.pressed = false
                if (pressed) game.answer(symbol)
              }
            },
          }),
      )
      const action = new ActionButton(
        {
          name: 'memoryAction',
          icon: 'play',
          label: localize('memory.start'),
          onTap: () => (game.snapshot().phase === 'won' ? game.next() : game.start()),
        },
        { left: 8, top: 140, width: 148, height: 44 },
      )
      const motion = new ActionButton(
        {
          name: 'memoryMotion',
          icon: 'settings',
          label: localize('memory.motionOff'),
          onTap: () => game.setMotion(!game.snapshot().motion),
        },
        { left: 164, top: 140, width: 148, height: 44 },
      )
      const content = new Container(null, {
        name: 'memoryGame',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: styles.screen,
        contents: [
          status,
          progress,
          prompt,
          ...pads,
          action,
          motion,
          new Label(null, {
            left: 8,
            right: 8,
            top: 184,
            height: 12,
            string: localize('memory.closeHint'),
            style: styles.bodyMuted,
          }),
        ],
      })
      const unsubscribe = game.subscribe((snapshot) => {
        const phase = snapshot.phase
        status.string = localize(`memory.phase.${phase}`)
        progress.string = `${localize('memory.round')} ${snapshot.round}/12   ${localize('memory.score')} ${snapshot.score}`
        prompt.string = snapshot.motionBlockReason
          ? localize(`memory.motionBlocked.${snapshot.motionBlockReason}`)
          : phase === 'input' || phase === 'feedback'
            ? `${localize('memory.answer')} ${snapshot.matched}/${snapshot.round}`
            : localize(phase === 'lost' ? 'memory.expected' : 'memory.hint')
        for (let index = 0; index < pads.length; index++) {
          const pad = pads[index]
          pad.active = phase === 'input'
          pad.skin =
            snapshot.symbol === MEMORY_GAME_SYMBOLS[index]
              ? phase === 'lost'
                ? styles.danger
                : styles.accent
              : styles.surface
        }
        const controls = action.behavior as ActionButtonBehavior
        controls.setEnabled(action, phase === 'ready' || phase === 'won' || phase === 'lost' || phase === 'complete')
        controls.setLabel(
          action,
          localize(phase === 'won' ? 'memory.next' : phase === 'ready' ? 'memory.start' : 'memory.again'),
        )
        const motionControls = motion.behavior as ActionButtonBehavior
        motionControls.setLabel(
          motion,
          localize(
            snapshot.motionBlockReason
              ? 'memory.motionWaiting'
              : snapshot.motion
                ? 'memory.motionOn'
                : 'memory.motionOff',
          ),
        )
        motionControls.setSelected(motion, snapshot.motion)
      })
      return {
        content,
        dispose() {
          unsubscribe()
          game.close()
          releaseIdle()
        },
      }
    },
  }
}
