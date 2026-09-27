import 'piu/MC'
import Timer from 'timer'

const background = new Skin({ fill: '#f7f3df' })
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
    title: 'ｽﾀｯｸﾁｬﾝ 育成',
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
        title.string = `ｽﾀｯｸﾁｬﾝ Lv.${state.level} ${message}`
        bond.string = `なつき  ${state.bond}/100`
        energy.string = `元気    ${state.energy}/100`
        curiosity.string = `好奇心  ${state.curiosity}/100`
        experience.string = `経験値  ${state.xp}`
        record.string = `きろく: なで ${state.pettings}回 / あそび ${state.games}回`
      }
      let open = true
      let gameTimer
      let score = -1
      const play = () => {
        if (score < 0) {
          score = 0
          title.string = '6秒で「あそぶ」を何回タップできる？'
          gameTimer = Timer.set(() => {
            gameTimer = undefined
            if (!open) return
            const result = score
            score = -1
            dispatch({ type: 'gameFinished', score: result })
            refresh(`スコア ${result}`)
          }, 6000)
          return
        }
        score += 1
        title.string = `スコア ${score}  あと少し！`
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
          button('なでる', 16, () => {
            const result = dispatch({ type: 'tap' })
            refresh(result?.changed ? 'えへへ！' : 'ちょっとまってね')
          }),
          button('あそぶ', 168, play),
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
