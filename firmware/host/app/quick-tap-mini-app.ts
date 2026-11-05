import type { MiniAppDefinition } from 'mini-app'
import { Container, Label, type Port as PiuPort, Port } from 'piu/MC'
import { drawMiniFace, type PlayMood } from 'play-pack-drawing'
import { playText } from 'play-pack-text'
import {
  QUICK_TAP_APP_ID,
  QUICK_TAP_ROUNDS,
  QuickTapGame,
  type QuickTapGameOptions,
  type QuickTapSnapshot,
  quickTapRank,
} from 'quick-tap-game'
import { ActionButton, type ActionButtonBehavior } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export { QUICK_TAP_APP_ID }
export type QuickTapAppOptions = QuickTapGameOptions & {
  suppressIdle(): () => void
  /** Head touch presses, stamped with the host clock at delivery. */
  subscribeTap?(listener: (pressedAt: number) => void): () => void
}

const MOODS: Readonly<Record<QuickTapSnapshot['phase'], PlayMood>> = {
  ready: 'neutral',
  waiting: 'neutral',
  go: 'surprised',
  hit: 'happy',
  early: 'sad',
  slow: 'sleepy',
  complete: 'happy',
  closed: 'neutral',
}

function statusText(state: QuickTapSnapshot): string {
  if (state.phase === 'hit' && state.lastMs !== null)
    return `${state.lastMs} ms  ${playText(`quicktap.rank.${quickTapRank(state.lastMs)}`)}`
  return playText(`quicktap.phase.${state.phase}`)
}

function promptKey(state: QuickTapSnapshot): string {
  if (state.saveFailed) return 'quicktap.saveFailed'
  if (state.muted) return 'quicktap.muted'
  if (state.phase === 'complete')
    return state.newRecord ? 'quicktap.newRecord' : state.hits > 0 ? 'quicktap.finished' : 'quicktap.noHits'
  if (state.phase === 'waiting') return 'quicktap.wait'
  if (state.phase === 'go') return 'quicktap.tapNow'
  return 'quicktap.hint'
}

function ms(value: number | null): string {
  return value === null ? '-' : `${value}`
}

export function createQuickTapApp(options: QuickTapAppOptions): MiniAppDefinition {
  return {
    id: QUICK_TAP_APP_ID,
    title: playText('quicktap.title'),
    icon: 'play',
    create({ reportResult }) {
      const styles = uiStyles()
      const game = new QuickTapGame({
        ...options,
        onResult(score) {
          reportResult(score)
          options.onResult?.(score)
        },
      })
      const releaseIdle = options.suppressIdle()
      const unsubscribeTap = options.subscribeTap?.((at) => game.tap(at))
      const status = new Label(null, {
        name: 'quickTapStatus',
        left: 8,
        right: 8,
        top: 0,
        height: 20,
        style: styles.title,
      })
      const progress = new Label(null, {
        name: 'quickTapProgress',
        left: 8,
        right: 8,
        top: 20,
        height: 18,
        style: styles.bodyMuted,
      })
      const prompt = new Label(null, {
        name: 'quickTapPrompt',
        left: 8,
        right: 8,
        top: 38,
        height: 18,
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
            drawMiniFace(port, port.width / 2, port.height / 2 - 2, UI.colors.text, { mood: MOODS[state.phase] })
          }
        },
      })
      const pad = new Container(null, {
        name: 'quickTapPad',
        left: 8,
        right: 8,
        top: 58,
        height: 72,
        active: false,
        skin: styles.surface,
        contents: [face],
        Behavior: class extends Behavior {
          onTouchBegan() {
            // Judge the contact edge: reaction time ends when the finger lands.
            game.tap(options.now())
          }
        },
      })
      const action = new ActionButton(
        { name: 'quickTapAction', icon: 'play', label: playText('quicktap.start'), onTap: () => game.start() },
        { left: 8, top: 136, width: 148, height: 44 },
      )
      const sound = new ActionButton(
        {
          name: 'quickTapSound',
          icon: 'volume',
          label: playText('quicktap.soundOn'),
          onTap: () => game.setSound(!game.snapshot().sound),
        },
        { left: 164, top: 136, width: 148, height: 44 },
      )
      const content = new Container(null, {
        name: 'quickTapGame',
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
          sound,
          new Label(null, {
            left: 8,
            right: 8,
            top: 182,
            height: 14,
            string: playText('quicktap.closeHint', { rounds: QUICK_TAP_ROUNDS }),
            style: styles.bodyMuted,
          }),
        ],
      })
      const unsubscribe = game.subscribe((state) => {
        status.string = statusText(state)
        progress.string = `${playText('quicktap.round')} ${state.round}/${QUICK_TAP_ROUNDS}   ${playText('quicktap.best')} ${ms(state.bestMs)}   ${playText('quicktap.record')} ${ms(state.recordMs)}`
        prompt.string = playText(promptKey(state))
        pad.active = state.phase === 'waiting' || state.phase === 'go'
        pad.skin =
          state.phase === 'go'
            ? styles.success
            : state.phase === 'early'
              ? styles.danger
              : state.phase === 'hit' || (state.phase === 'complete' && state.newRecord)
                ? styles.accent
                : styles.surface
        if (faceDisplayed) (face as PiuPort).invalidate()
        const controls = action.behavior as ActionButtonBehavior
        controls.setEnabled(action, state.phase === 'ready' || state.phase === 'complete')
        controls.setLabel(action, playText(state.phase === 'complete' ? 'quicktap.again' : 'quicktap.start'))
        const soundControls = sound.behavior as ActionButtonBehavior
        soundControls.setLabel(sound, playText(state.sound ? 'quicktap.soundOn' : 'quicktap.soundOff'))
        soundControls.setSelected(sound, state.sound)
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
