import { localize } from 'localization'
import type { MiniAppDefinition } from 'mini-app'
import { Container, Label, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'
import { RHYTHM_GAME_ROUNDS, RHYTHM_TAP_MAX_DURATION, RhythmGame, type RhythmGameOptions } from 'rhythm-game'
import { ActionButton, type ActionButtonBehavior } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export const RHYTHM_GAME_APP_ID = 'stackchan.rhythm-game'
export type RhythmGameAppOptions = RhythmGameOptions & {
  suppressIdle(): () => void
  subscribeTap?(listener: (pressedAt: number) => void): () => void
}

export function createRhythmGameApp(options: RhythmGameAppOptions): MiniAppDefinition {
  return {
    id: RHYTHM_GAME_APP_ID,
    title: localize('rhythm.title'),
    icon: 'play',
    create({ reportResult }) {
      const styles = uiStyles()
      const game = new RhythmGame({
        ...options,
        onResult(score) {
          reportResult(score)
          options.onResult?.(score)
        },
      })
      const releaseIdle = options.suppressIdle()
      const unsubscribeTap = options.subscribeTap?.((at) => game.tap(at))
      const status = new Label(null, {
        name: 'rhythmStatus',
        left: 8,
        right: 8,
        top: 0,
        height: 20,
        style: styles.title,
      })
      const progress = new Label(null, {
        name: 'rhythmProgress',
        left: 8,
        right: 8,
        top: 20,
        height: 18,
        style: styles.bodyMuted,
      })
      const prompt = new Label(null, {
        name: 'rhythmPrompt',
        left: 8,
        right: 8,
        top: 38,
        height: 20,
        style: styles.body,
      })
      let faceDisplayed = false
      const face = new Port(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        Behavior: class extends Behavior {
          onDisplaying() {
            faceDisplayed = true
          }
          onUndisplaying() {
            faceDisplayed = false
          }
          onDraw(port: PiuPort) {
            const state = game.snapshot()
            const happy = state.phase === 'won' || state.phase === 'complete'
            const color = UI.colors.text
            // A tiny face stays visible within the playable pad, including while the host face is hidden.
            for (const x of [112, 180]) {
              if (happy) {
                port.fillColor(color, x, 28, 8, 8)
                port.fillColor(color, x + 8, 20, 8, 8)
                port.fillColor(color, x + 16, 28, 8, 8)
              } else port.fillColor(color, x + 8, state.pulse ? 22 : 26, 8, state.pulse ? 20 : 12)
            }
            port.fillColor(color, 148, happy ? 48 : 50, 24, 4)
            if (happy) {
              port.fillColor(color, 144, 42, 4, 8)
              port.fillColor(color, 172, 42, 4, 8)
            }
            const count = state.phase === 'showing' ? state.cue : state.matched
            const start = (port.width - state.beats * 20) / 2
            for (let index = 0; index < state.beats; index++)
              port.fillColor(index < count ? color : UI.colors.border, start + index * 20, 6, 12, 4)
          }
        },
      })
      const pad = new Container(null, {
        name: 'rhythmPad',
        left: 8,
        right: 8,
        top: 60,
        height: 70,
        skin: styles.surface,
        contents: [face],
        Behavior: class extends Behavior {
          pressedAt: number | undefined
          touchId: number | undefined
          x = 0
          y = 0
          onTouchBegan(_container: PiuContainer, id: number, x: number, y: number) {
            if (this.touchId !== undefined) return
            this.touchId = id
            this.pressedAt = options.now()
            this.x = x
            this.y = y
          }
          onTouchMoved(_container: PiuContainer, id: number, x: number, y: number) {
            if (id === this.touchId && (Math.abs(x - this.x) > 8 || Math.abs(y - this.y) > 8))
              this.pressedAt = undefined
          }
          onTouchCancelled() {
            this.pressedAt = undefined
            this.touchId = undefined
          }
          onTouchEnded(_container: PiuContainer, id: number) {
            if (id !== this.touchId) return
            const at = this.pressedAt
            this.onTouchCancelled()
            if (at !== undefined && options.now() - at <= RHYTHM_TAP_MAX_DURATION) game.tap(at)
          }
        },
      })
      const action = new ActionButton(
        { name: 'rhythmAction', icon: 'play', label: localize('rhythm.start'), onTap: () => game.start() },
        { left: 8, top: 138, width: 96, height: 44 },
      )
      const replay = new ActionButton(
        { name: 'rhythmReplay', icon: 'play', label: localize('rhythm.replay'), onTap: () => game.replay() },
        { left: 112, top: 138, width: 96, height: 44 },
      )
      const sound = new ActionButton(
        {
          name: 'rhythmSound',
          icon: 'settings',
          label: localize('rhythm.soundOn'),
          onTap: () => game.setSound(!game.snapshot().sound),
        },
        { left: 216, top: 138, width: 96, height: 44 },
      )
      const content = new Container(null, {
        name: 'rhythmGame',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: styles.screen,
        contents: [
          status,
          progress,
          prompt,
          pad,
          action,
          replay,
          sound,
          new Label(null, {
            left: 8,
            right: 8,
            top: 184,
            height: 12,
            style: styles.bodyMuted,
            string: localize('rhythm.closeHint'),
          }),
        ],
      })
      const unsubscribe = game.subscribe((state) => {
        status.string = localize(`rhythm.phase.${state.phase}`)
        progress.string = `${localize('rhythm.round')} ${state.round}/${RHYTHM_GAME_ROUNDS}    ${state.phase === 'showing' ? state.cue : state.matched}/${state.beats}`
        prompt.string = localize(
          state.reason ? `rhythm.reason.${state.reason}` : state.muted ? 'rhythm.muted' : 'rhythm.hint',
        )
        pad.active = state.phase === 'input'
        if (!pad.active) (pad.behavior as { onTouchCancelled(): void }).onTouchCancelled()
        pad.skin =
          state.phase === 'won' || state.phase === 'complete'
            ? styles.success
            : state.phase === 'lost'
              ? styles.danger
              : state.pulse
                ? styles.accent
                : styles.surface
        if (faceDisplayed) (face as PiuPort).invalidate()
        const controls = action.behavior as ActionButtonBehavior
        controls.setEnabled(action, ['ready', 'lost', 'won', 'complete'].includes(state.phase))
        controls.setLabel(
          action,
          localize(state.phase === 'won' ? 'rhythm.next' : state.phase === 'ready' ? 'rhythm.start' : 'rhythm.retry'),
        )
        ;(replay.behavior as ActionButtonBehavior).setEnabled(replay, state.phase === 'input' || state.phase === 'lost')
        ;(sound.behavior as ActionButtonBehavior).setLabel(
          sound,
          localize(state.sound ? 'rhythm.soundOn' : 'rhythm.soundOff'),
        )
        ;(sound.behavior as ActionButtonBehavior).setSelected(sound, state.sound)
      })
      return {
        content,
        dispose() {
          unsubscribeTap?.()
          unsubscribe()
          game.close()
          releaseIdle()
        },
      }
    },
  }
}
