import { applyPetEvent, unlockedReactions } from 'pet-state'
import { createPetStatusApp } from 'pet-status'
import { loadPetState, savePetState } from 'pet-storage'
import Timer from 'timer'

const SAVE_DELAY_MS = 1500
const PETTING_WINDOW_MS = 1500
let active

export const appendDefaultContextCreated = true

export function onContextCreated(context, options) {
  active?.close()
  let state = loadPetState()
  let saveTimer
  let balloonTimer
  let closed = false
  let speaking = false
  let ownedReaction = null
  const persist = () => {
    saveTimer = undefined
    try {
      savePetState(state)
    } catch (error) {
      trace(`[stackchan_pet] save failed: ${String(error)}\n`)
    }
  }
  const scheduleSave = () => {
    if (saveTimer !== undefined) Timer.clear(saveTimer)
    saveTimer = Timer.set(persist, SAVE_DELAY_MS)
  }
  const dispatch = (event) => {
    if (closed) return
    const result = applyPetEvent(state, { ...event, now: Date.now() })
    state = result.state
    if (result.changed) scheduleSave()
    if (result.reaction && !event.handledByDefault) {
      const unlocks = unlockedReactions(state.level)
      const name = result.reaction === 'delighted' && !unlocks.delighted ? 'greeting' : result.reaction
      const played = context.reaction.play(name, { intensity: 0.3 })
      if (played.ok) ownedReaction = name
    }
    if (result.speech && !event.handledByDefault) {
      if ((options?.config?.tts?.type ?? 'local') === 'local') {
        context.ui.showBalloon(result.speech)
        if (balloonTimer !== undefined) Timer.clear(balloonTimer)
        balloonTimer = Timer.set(() => {
          balloonTimer = undefined
          if (!closed) context.ui.hideBalloon()
        }, 2200)
      } else {
        speaking = true
        void context.audio.say(result.speech).then(
          () => {
            speaking = false
          },
          (error) => {
            speaking = false
            trace(`[stackchan_pet] speech failed: ${String(error)}\n`)
          },
        )
      }
    }
    return result
  }

  const unregister = context.ui.miniApps.register(createPetStatusApp(() => state, dispatch))
  const unsubscribeResults = context.ui.miniApps.subscribeResult(({ id, score }) => {
    if (id === 'sample.stackchan-jump' || id === 'sample.stackchan-catch') {
      dispatch({ type: 'gameFinished', score })
    }
  })
  let lastForwardSwipe
  let lastBackwardSwipe
  const unsubscribeTouch = context.input.touchPanel?.subscribe((event) => {
    if (event.gesture === 'forwardSwipe') lastForwardSwipe = event.ticks
    else if (event.gesture === 'backwardSwipe') lastBackwardSwipe = event.ticks
    else return
    if (
      lastForwardSwipe !== undefined &&
      lastBackwardSwipe !== undefined &&
      Math.abs(lastForwardSwipe - lastBackwardSwipe) <= PETTING_WINDOW_MS
    ) {
      lastForwardSwipe = undefined
      lastBackwardSwipe = undefined
      // Default behavior owns the gesture animation; the MOD only records growth.
      dispatch({ type: 'petted', handledByDefault: true })
    }
  })
  const close = () => {
    if (closed) return
    closed = true
    if (saveTimer !== undefined) {
      Timer.clear(saveTimer)
      persist()
    }
    if (balloonTimer !== undefined) Timer.clear(balloonTimer)
    context.ui.hideBalloon()
    if (speaking) context.audio.tts?.cancel?.()
    unsubscribeTouch?.()
    unsubscribeResults()
    unregister()
    if (ownedReaction && context.reaction.status().active === ownedReaction) context.reaction.cancel()
    if (active?.close === close) active = undefined
  }
  active = { close }
  context.lifecycle.onClose?.(close)
  // Companion boot greetings are disabled while a MOD is installed.
  dispatch({ type: 'boot' })
}
