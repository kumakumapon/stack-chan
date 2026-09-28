import { applyPetEvent, unlockedReactions } from 'pet-state'
import { createPetStatusApp } from 'pet-status'
import { loadPetState, savePetState } from 'pet-storage'
import Timer from 'timer'

const SAVE_DELAY_MS = 1500
const PETTING_WINDOW_MS = 1500
const IDLE_POLL_MS = 30 * 60 * 1000
let active

export const appendDefaultContextCreated = true

export function onContextCreated(context, options) {
  active?.close()
  let state = loadPetState()
  let saveTimer
  let balloonTimer
  let releaseTimer
  let idleTimer
  let closed = false
  let speaking = false
  let ownsBalloon = false
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
        // Open Sans bitmap resources on embedded targets only include Latin glyphs.
        const caption = result.levelUp
          ? 'Level up!'
          : ({ boot: 'Hello!', petted: 'Hehe!', tap: 'Hehe!', gameFinished: 'Nice!' }[event.type] ?? 'Hello!')
        context.ui.showBalloon(caption)
        ownsBalloon = true
        if (balloonTimer !== undefined) Timer.clear(balloonTimer)
        balloonTimer = Timer.set(() => {
          balloonTimer = undefined
          if (!closed && ownsBalloon) {
            context.ui.hideBalloon()
            ownsBalloon = false
          }
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
  // Older installed hosts have Mini Apps but not the result capability yet.
  // Keep the offline pet loop usable until the host firmware is upgraded.
  const unsubscribeResults = context.ui.miniApps.subscribeResult?.(({ id, score }) => {
    if (id === 'sample.stackchan-jump' || id === 'sample.stackchan-catch') {
      dispatch({ type: 'gameFinished', score })
    }
  })
  let lastForwardSwipe
  let lastBackwardSwipe
  let swipedDuringTouch = false
  const unsubscribeTouch = context.input.touchPanel?.subscribe((event) => {
    if (event.gesture === 'press') {
      swipedDuringTouch = false
      return
    }
    if (event.gesture === 'release') {
      // A simple touch is a fallback when the panel cannot resolve a swipe.
      // A swipe release must not create an extra pet, even on targets that
      // report no tap metadata or have a different tap-duration threshold.
      if (swipedDuringTouch) return
      // Defer it so a paired swipe keeps its existing host-owned animation.
      if (releaseTimer !== undefined) Timer.clear(releaseTimer)
      releaseTimer = Timer.set(() => {
        releaseTimer = undefined
        dispatch({ type: 'petted' })
      }, PETTING_WINDOW_MS)
      return
    }
    if (event.gesture === 'forwardSwipe') lastForwardSwipe = event.ticks
    else if (event.gesture === 'backwardSwipe') lastBackwardSwipe = event.ticks
    else return
    swipedDuringTouch = true
    if (
      lastForwardSwipe !== undefined &&
      lastBackwardSwipe !== undefined &&
      Math.abs(lastForwardSwipe - lastBackwardSwipe) <= PETTING_WINDOW_MS
    ) {
      lastForwardSwipe = undefined
      lastBackwardSwipe = undefined
      if (releaseTimer !== undefined) {
        Timer.clear(releaseTimer)
        releaseTimer = undefined
      }
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
    if (releaseTimer !== undefined) Timer.clear(releaseTimer)
    if (idleTimer !== undefined) Timer.clear(idleTimer)
    if (ownsBalloon) context.ui.hideBalloon()
    if (speaking) context.audio.tts?.cancel?.()
    unsubscribeTouch?.()
    unsubscribeResults?.()
    unregister()
    if (ownedReaction && context.reaction.status().active === ownedReaction) context.reaction.cancel()
    if (active?.close === close) active = undefined
  }
  active = { close }
  context.lifecycle.onClose?.(close)
  idleTimer = Timer.repeat(() => dispatch({ type: 'idle' }), IDLE_POLL_MS)
  // Companion boot greetings are disabled while a MOD is installed.
  dispatch({ type: 'boot' })
}
