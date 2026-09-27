import 'piu/MC'
import { petTendency } from 'pet-state'
import Timer from 'timer'

const background = new Skin({ fill: '#f7f3df' })
const friendBackground = new Skin({ fill: '#e7f6ee' })
const buttonSkin = new Skin({ fill: ['#df795b', '#bd6047'] })
const ink = new Style({ font: '16px Open Sans', color: '#29323c', horizontal: 'left', vertical: 'middle' })
const buttonText = new Style({ font: '16px Open Sans', color: '#ffffff', horizontal: 'center', vertical: 'middle' })

class TapBehavior extends Behavior {
  onCreate(_content, data) {
    this.action = data.action
  }

  onTouchBegan(content) {
    content.state = 1
  }

  onTouchCancelled(content) {
    content.state = 0
  }

  onTouchEnded(content) {
    content.state = 0
    this.action?.()
  }
}

function button(label, left, action) {
  return new Container(
    { action },
    {
      left,
      bottom: 7,
      width: 136,
      height: 34,
      active: true,
      skin: buttonSkin,
      Behavior: TapBehavior,
      contents: [new Label(null, { left: 0, right: 0, top: 0, bottom: 0, string: label, style: buttonText })],
    },
  )
}

function statLine(top) {
  return new Label(null, { left: 16, right: 8, top, height: 22, style: ink })
}

export function createPetStatusApp(getState, dispatch) {
  return {
    id: 'stackchan.pet-status',
    title: 'PET STATUS',
    icon: 'play',
    create() {
      const title = statLine(5)
      const bond = statLine(29)
      const energy = statLine(53)
      const curiosity = statLine(77)
      const experience = statLine(101)
      const record = statLine(125)
      const refresh = (message = '') => {
        const state = getState()
        content.skin = state.level >= 5 ? friendBackground : background
        title.string = `STACK-CHAN Lv.${state.level}${state.level >= 5 ? ' [FRIEND]' : ''} ${message}`
        bond.string = `BOND       ${state.bond}/100`
        energy.string = `ENERGY     ${state.energy}/100`
        curiosity.string = `CURIOSITY  ${state.curiosity}/100`
        experience.string = `XP         ${state.xp}`
        record.string = `PET ${state.pettings}  PLAY ${state.games}  ${petTendency(state).toUpperCase()}`
      }
      let open = true
      let gameTimer
      let score = -1
      const play = () => {
        if (score < 0) {
          score = 0
          title.string = 'Tap PLAY for 6 seconds!'
          gameTimer = Timer.set(() => {
            gameTimer = undefined
            if (!open) return
            const result = score
            score = -1
            dispatch({ type: 'gameFinished', score: result })
            refresh(`SCORE ${result}`)
          }, 6000)
          return
        }
        score += 1
        title.string = `SCORE ${score}  Keep going!`
      }
      const content = new Container(null, {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: background,
        contents: [
          title,
          bond,
          energy,
          curiosity,
          experience,
          record,
          button('PET', 16, () => {
            const result = dispatch({ type: 'tap' })
            refresh(result?.changed ? 'Hehe!' : 'Wait a moment')
          }),
          button('PLAY', 168, play),
        ],
      })
      refresh()
      return {
        content,
        dispose() {
          open = false
          if (gameTimer !== undefined) Timer.clear(gameTimer)
        },
      }
    },
  }
}
