import {
  type HoiDirection,
  JANKEN_APP_ID,
  JANKEN_HANDS,
  JANKEN_TARGET_POINTS,
  JankenGame,
  type JankenGameOptions,
  type JankenHand,
  type JankenSnapshot,
} from 'janken-game'
import type { MiniAppDefinition } from 'mini-app'
import { Container, Label, type Container as PiuContainer, type Port as PiuPort, Port } from 'piu/MC'
import { drawArrow, drawHand, drawMiniFace, type PlayMood } from 'play-pack-drawing'
import { playText } from 'play-pack-text'
import { ActionButton, type ActionButtonBehavior } from 'ui-controls'
import { UI, uiStyles } from 'ui-theme'

export { JANKEN_APP_ID }
export type JankenAppOptions = JankenGameOptions & { suppressIdle(): () => void }

/** Pads read left to right like the arrows they show. */
const DIRECTION_PADS: readonly HoiDirection[] = ['left', 'up', 'down', 'right']
const HOI_PHASES: readonly JankenSnapshot['phase'][] = ['hoi-call', 'hoi', 'hoi-reveal']
const IDLE_PHASES: readonly JankenSnapshot['phase'][] = ['ready', 'won', 'lost']

function statusKey(state: JankenSnapshot): string {
  if (state.phase === 'choose' && state.draws > 0) return 'janken.phase.aiko'
  if (state.phase === 'reveal') return `janken.outcome.${state.outcome}`
  if (state.phase === 'hoi-reveal') {
    if (state.timedOut) return 'janken.hoi.timeout'
    if (!state.hit) return 'janken.hoi.safe'
    return state.attacker === 'player' ? 'janken.hoi.playerPoint' : 'janken.hoi.robotPoint'
  }
  return `janken.phase.${state.phase}`
}

function promptKey(state: JankenSnapshot): string {
  // Who points matters most while a hoi is on; a paused head is secondary information.
  if (HOI_PHASES.includes(state.phase)) return state.attacker === 'player' ? 'janken.attack' : 'janken.defend'
  if (state.motionBlockReason) return `janken.motionBlocked.${state.motionBlockReason}`
  if (state.phase === 'won' || state.phase === 'lost') return 'janken.again'
  return state.phase === 'ready' ? 'janken.rules' : 'janken.chooseHint'
}

function robotMood(state: JankenSnapshot): PlayMood {
  if (state.phase === 'won') return 'sad'
  if (state.phase === 'lost') return 'happy'
  if (state.phase === 'reveal')
    return state.outcome === 'lose' ? 'happy' : state.outcome === 'win' ? 'sad' : 'surprised'
  if (state.phase === 'hoi-reveal' && state.hit) return state.attacker === 'robot' ? 'happy' : 'surprised'
  return 'neutral'
}

function pad(
  name: string,
  label: string,
  layout: { left: number; width: number },
  onTap: () => void,
  styles: ReturnType<typeof uiStyles>,
): PiuContainer {
  return new Container(null, {
    name,
    left: layout.left,
    top: 132,
    width: layout.width,
    height: 44,
    active: false,
    skin: styles.surface,
    contents: [new Label(null, { left: 0, right: 0, top: 0, bottom: 0, string: label, style: styles.button })],
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
        if (pressed) onTap()
      }
    },
  })
}

export function createJankenApp(options: JankenAppOptions): MiniAppDefinition {
  return {
    id: JANKEN_APP_ID,
    title: playText('janken.title'),
    icon: 'play',
    create({ reportResult }) {
      const styles = uiStyles()
      const game = new JankenGame({
        ...options,
        onResult(score) {
          reportResult(score)
          options.onResult?.(score)
        },
      })
      const releaseIdle = options.suppressIdle()
      const status = new Label(null, {
        name: 'jankenStatus',
        left: 8,
        right: 8,
        top: 0,
        height: 20,
        style: styles.title,
      })
      const score = new Label(null, {
        name: 'jankenScore',
        left: 8,
        right: 8,
        top: 20,
        height: 18,
        style: styles.bodyMuted,
      })
      const prompt = new Label(null, {
        name: 'jankenPrompt',
        left: 8,
        right: 8,
        top: 38,
        height: 18,
        style: styles.body,
      })
      let stageDisplayed = false
      const stage = new Port(null, {
        name: 'jankenStage',
        left: 8,
        right: 8,
        top: 58,
        height: 70,
        skin: styles.surface,
        Behavior: class extends Behavior {
          onDisplaying() {
            stageDisplayed = true
          }
          onUndisplaying() {
            stageDisplayed = false
          }
          onDraw(port: PiuPort) {
            const state = game.snapshot()
            const cy = 38
            const center = port.width / 2
            const playerX = 52
            const robotX = port.width - 52
            const hoi = HOI_PHASES.includes(state.phase)
            const gaze = state.phase === 'hoi-reveal' ? state.robotDirection : null
            drawMiniFace(port, center, cy - 2, UI.colors.text, { gaze, mood: robotMood(state) })
            if (hoi) {
              if (state.phase === 'hoi-reveal' && state.playerDirection)
                drawArrow(port, state.playerDirection, playerX, cy, UI.colors.text)
              // The robot only points when attacking; defending, its face turns (gaze above).
              if (state.phase === 'hoi-reveal' && state.robotDirection && state.attacker === 'robot')
                drawArrow(port, state.robotDirection, robotX, cy, UI.colors.accent)
            } else {
              if (state.playerHand) drawHand(port, state.playerHand, playerX, cy, UI.colors.text, UI.colors.surface)
              if (state.robotHand) drawHand(port, state.robotHand, robotX, cy, UI.colors.accent, UI.colors.surface)
            }
          }
        },
      })
      const stageLabels = [
        new Label(null, {
          left: 12,
          width: 96,
          top: 60,
          height: 14,
          string: playText('janken.you'),
          style: styles.bodyMuted,
        }),
        new Label(null, {
          right: 12,
          width: 96,
          top: 60,
          height: 14,
          string: playText('janken.robot'),
          style: styles.bodyMuted,
        }),
      ]
      const handPads = JANKEN_HANDS.map((hand: JankenHand, index) =>
        pad(
          `janken:${hand}`,
          playText(`janken.hand.${hand}`),
          { left: 8 + index * 104, width: 96 },
          () => game.choose(hand),
          styles,
        ),
      )
      const directionPads = DIRECTION_PADS.map((direction, index) =>
        pad(
          `janken:${direction}`,
          playText(`janken.direction.${direction}`),
          { left: 8 + index * 78, width: 72 },
          () => game.look(direction),
          styles,
        ),
      )
      const action = new ActionButton(
        { name: 'jankenAction', icon: 'play', label: playText('janken.start'), onTap: () => game.start() },
        { left: 8, top: 132, width: 148, height: 44 },
      )
      const motion = new ActionButton(
        {
          name: 'jankenMotion',
          icon: 'settings',
          label: playText('janken.motionOff'),
          onTap: () => game.setMotion(!game.snapshot().motion),
        },
        { left: 164, top: 132, width: 148, height: 44 },
      )
      const content = new Container(null, {
        name: 'jankenGame',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: styles.screen,
        contents: [
          status,
          score,
          prompt,
          stage,
          ...stageLabels,
          ...handPads,
          ...directionPads,
          action,
          motion,
          new Label(null, {
            left: 8,
            right: 8,
            top: 180,
            height: 14,
            string: playText('janken.closeHint'),
            style: styles.bodyMuted,
          }),
        ],
      })
      const unsubscribe = game.subscribe((state) => {
        status.string = playText(statusKey(state))
        score.string = `${playText('janken.you')} ${state.playerPoints} - ${state.robotPoints} ${playText('janken.robot')}    ${playText('janken.target', { points: JANKEN_TARGET_POINTS })}`
        prompt.string = playText(promptKey(state))
        const idle = IDLE_PHASES.includes(state.phase)
        const hoi = HOI_PHASES.includes(state.phase)
        for (const [index, hand] of JANKEN_HANDS.entries()) {
          const target = handPads[index]
          target.visible = !idle && !hoi
          target.active = state.phase === 'choose'
          if (!target.active) (target.behavior as { onTouchCancelled(): void }).onTouchCancelled()
          target.skin = state.playerHand === hand ? styles.accent : styles.surface
        }
        for (const [index, direction] of DIRECTION_PADS.entries()) {
          const target = directionPads[index]
          target.visible = hoi
          target.active = state.phase === 'hoi'
          if (!target.active) (target.behavior as { onTouchCancelled(): void }).onTouchCancelled()
          target.skin =
            state.phase === 'hoi'
              ? styles.accent
              : state.playerDirection === direction
                ? state.hit
                  ? state.attacker === 'player'
                    ? styles.success
                    : styles.danger
                  : styles.accent
                : styles.surface
        }
        action.visible = idle
        motion.visible = idle
        const actionControls = action.behavior as ActionButtonBehavior
        actionControls.setEnabled(action, idle)
        actionControls.setLabel(action, playText(state.phase === 'ready' ? 'janken.start' : 'janken.rematch'))
        const motionControls = motion.behavior as ActionButtonBehavior
        motionControls.setEnabled(motion, idle)
        motionControls.setLabel(
          motion,
          playText(
            state.motionBlockReason ? 'janken.motionWaiting' : state.motion ? 'janken.motionOn' : 'janken.motionOff',
          ),
        )
        motionControls.setSelected(motion, state.motion)
        if (stageDisplayed) (stage as PiuPort).invalidate()
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
