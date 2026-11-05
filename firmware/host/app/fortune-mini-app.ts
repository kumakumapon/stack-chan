import { FORTUNE_APP_ID, type FortuneColor, type FortuneOptions, type FortuneSnapshot, FortuneTeller } from 'fortune'
import type { MiniAppDefinition } from 'mini-app'
import { Container, Content, Label, type Port as PiuPort, Port, Skin, Style } from 'piu/MC'
import { drawMiniFace } from 'play-pack-drawing'
import { playText } from 'play-pack-text'
import { ActionButton, type ActionButtonBehavior } from 'ui-controls'
import { UI, uiFont, uiStyles } from 'ui-theme'

export { FORTUNE_APP_ID }
export type FortuneAppOptions = FortuneOptions & { suppressIdle(): () => void }

const SWATCHES: Readonly<Record<FortuneColor, string>> = {
  red: '#ef4444',
  blue: '#3b82f6',
  yellow: '#facc15',
  green: '#22c55e',
  purple: '#a855f7',
  pink: '#f472b6',
  white: '#f8fafc',
  orange: '#fb923c',
}
const SLIP_PAPER = '#fdf6e3'
const SLIP_INK = '#202428'
const SHRINE_RED = '#d9483b'

function promptKey(state: FortuneSnapshot): string {
  if (state.saveFailed) return 'fortune.saveFailed'
  if (state.phase === 'shaking') return 'fortune.shakingHint'
  if (state.phase === 'revealed') {
    if (!state.dated) return 'fortune.unsyncedAgain'
    return state.repeat ? 'fortune.alreadyDrawn' : 'fortune.tomorrow'
  }
  return state.dated ? 'fortune.oncePerDay' : 'fortune.unsynced'
}

export function createFortuneApp(options: FortuneAppOptions): MiniAppDefinition {
  return {
    id: FORTUNE_APP_ID,
    title: playText('fortune.title'),
    icon: 'play',
    create() {
      const styles = uiStyles()
      const font = uiFont()
      const ink = new Style({ font, color: SLIP_INK, horizontal: 'center', vertical: 'middle' })
      const swatchSkins = new Map<FortuneColor, Skin>()
      const teller = new FortuneTeller(options)
      const releaseIdle = options.suppressIdle()
      const status = new Label(null, {
        name: 'fortuneStatus',
        left: 8,
        right: 8,
        top: 0,
        height: 20,
        style: styles.title,
      })
      const prompt = new Label(null, {
        name: 'fortunePrompt',
        left: 8,
        right: 8,
        top: 20,
        height: 18,
        style: styles.bodyMuted,
      })
      let stageDisplayed = false
      const stage = new Port(null, {
        name: 'fortuneStage',
        left: 8,
        right: 8,
        top: 40,
        height: 88,
        Behavior: class extends Behavior {
          onDisplaying() {
            stageDisplayed = true
          }
          onUndisplaying() {
            stageDisplayed = false
          }
          onDraw(port: PiuPort) {
            const state = teller.snapshot()
            if (state.phase === 'revealed') {
              // Stack-chan below the lucky details, pleased with whatever the slip says.
              drawMiniFace(port, port.width - 44, 66, UI.colors.text, { mood: 'happy' })
              return
            }
            const shaking = state.phase === 'shaking'
            const dx = shaking ? (state.shake % 2 === 0 ? -5 : 5) : 0
            const cx = port.width / 2 + dx
            port.fillColor(SHRINE_RED, cx - 18, 16, 36, 64)
            port.fillColor(UI.colors.text, cx - 18, 38, 36, 10)
            port.fillColor(UI.colors.border, cx - 14, 10, 28, 6)
            if (shaking && state.shake % 2 === 1) port.fillColor(SLIP_PAPER, cx - 2, 0, 4, 10)
            drawMiniFace(port, 52, 46, UI.colors.text, { mood: shaking ? 'surprised' : 'neutral' })
          }
        },
      })
      const rank = new Label(null, { name: 'fortuneRank', left: 0, right: 0, top: 8, height: 24, style: ink })
      const slip = new Container(null, {
        name: 'fortuneSlip',
        left: 8,
        width: 72,
        top: 40,
        height: 88,
        visible: false,
        skin: new Skin({ fill: SLIP_PAPER }),
        contents: [
          new Label(null, { left: 0, right: 0, top: 54, height: 14, string: playText('fortune.slip'), style: ink }),
          rank,
        ],
      })
      const action = new Label(null, {
        name: 'fortuneAction',
        left: 0,
        right: 0,
        top: 16,
        height: 16,
        style: styles.body,
      })
      const colorName = new Label(null, {
        name: 'fortuneColor',
        left: 22,
        right: 0,
        top: 56,
        height: 16,
        style: styles.body,
      })
      const swatch = new Content(null, { left: 0, top: 56, width: 16, height: 16, skin: styles.surface })
      const details = new Container(null, {
        name: 'fortuneDetails',
        left: 92,
        right: 8,
        top: 40,
        height: 88,
        visible: false,
        contents: [
          new Label(null, {
            left: 0,
            right: 0,
            top: 0,
            height: 14,
            string: playText('fortune.luckyAction'),
            style: styles.bodyMuted,
          }),
          action,
          new Label(null, {
            left: 0,
            right: 0,
            top: 40,
            height: 14,
            string: playText('fortune.luckyColor'),
            style: styles.bodyMuted,
          }),
          swatch,
          colorName,
        ],
      })
      const message = new Label(null, {
        name: 'fortuneMessage',
        left: 8,
        right: 8,
        top: 130,
        height: 16,
        style: styles.body,
      })
      const draw = new ActionButton(
        { name: 'fortuneDraw', icon: 'play', label: playText('fortune.draw'), onTap: () => teller.draw() },
        { left: 8, right: 8, top: 150, height: 44 },
      )
      const content = new Container(null, {
        name: 'fortune',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: styles.screen,
        contents: [status, prompt, stage, slip, details, message, draw],
      })
      const unsubscribe = teller.subscribe((state) => {
        const revealed = state.phase === 'revealed' && state.draw !== null
        status.string = playText(
          revealed
            ? 'fortune.phase.revealed'
            : state.phase === 'shaking'
              ? 'fortune.phase.shaking'
              : 'fortune.phase.ready',
        )
        prompt.string = playText(promptKey(state))
        slip.visible = revealed
        details.visible = revealed
        if (state.draw) {
          rank.string = playText(`fortune.rank.${state.draw.rank}`)
          action.string = playText(`fortune.action.${state.draw.action}`)
          colorName.string = playText(`fortune.color.${state.draw.color}`)
          let skin = swatchSkins.get(state.draw.color)
          if (!skin) {
            skin = new Skin({ fill: SWATCHES[state.draw.color] })
            swatchSkins.set(state.draw.color, skin)
          }
          swatch.skin = skin
          message.string = playText(`fortune.message.${state.draw.rank}`)
        } else message.string = state.phase === 'shaking' ? '' : playText('fortune.invite')
        const controls = draw.behavior as ActionButtonBehavior
        controls.setEnabled(draw, state.canDraw)
        controls.setLabel(draw, playText(revealed ? 'fortune.drawAgain' : 'fortune.draw'))
        if (stageDisplayed) (stage as PiuPort).invalidate()
      })
      return {
        content,
        dispose() {
          unsubscribe()
          teller.close()
          releaseIdle()
        },
      }
    },
  }
}
