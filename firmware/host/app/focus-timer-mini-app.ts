import type { FocusTimerPreset } from 'focus-timer-model'
import type { FocusTimerService, FocusTimerViewState } from 'focus-timer-service'
import { localize } from 'localization'
import type { MiniAppDefinition, MiniAppRegistryCapability } from 'mini-app'
import { Container, Label } from 'piu/MC'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'

export const FOCUS_TIMER_APP_ID = 'stackchan.focus-timer'

export function registerFocusTimerApp(
  service: FocusTimerService,
  miniApps: MiniAppRegistryCapability,
  onClose: (handler: () => void) => void,
): void {
  let unregister: () => void = () => undefined
  let unsubscribe: () => void = () => undefined
  const close = () => {
    unsubscribe()
    unregister()
    service.close()
  }
  onClose(close)
  try {
    unregister = miniApps.register(createFocusTimerApp(service))
    unsubscribe = service.subscribe((snapshot) =>
      miniApps.setStatus?.(FOCUS_TIMER_APP_ID, focusTimerMenuStatus(snapshot)),
    )
  } catch (error) {
    close()
    throw error
  }
}

export function focusTimerMenuStatus(snapshot: FocusTimerViewState): string | undefined {
  const state = snapshot.state === 'idle' ? undefined : localize(`focus.${snapshot.state}`)
  if (snapshot.storageFailed) {
    const error = localize('focus.saveFailedShort')
    return state ? `${state} / ${error}` : error
  }
  return state
}

function remainingTime(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}

export function createFocusTimerApp(service: FocusTimerService): MiniAppDefinition {
  return {
    id: FOCUS_TIMER_APP_ID,
    title: localize('focus.title'),
    icon: 'play',
    create() {
      const styles = uiStyles()
      const hint = new Label(null, {
        left: 8,
        right: 8,
        top: 0,
        height: 18,
        string: localize('focus.closeHint'),
        style: styles.bodyMuted,
      })
      const warning = new Label(null, { left: 8, right: 8, top: 18, height: 18, style: styles.body })
      const state = new Label(null, { left: 8, right: 8, top: 36, height: 20, style: styles.title })
      const countdown = new Label(null, { left: 8, right: 8, top: 62, height: 32, style: styles.brand })
      const note = new Label(null, { left: 8, right: 8, top: 100, height: 24, style: styles.bodyMuted })
      const controls = new Container(null, { left: 0, right: 0, top: 0, bottom: 0 })
      const content = new Container(null, {
        name: 'focusTimer',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: styles.screen,
        contents: [hint, warning, state, countdown, note, controls],
      })
      const addButton = (
        name: string,
        label: string,
        onTap: () => void,
        left: number,
        top: number,
        width: number,
        selected = false,
      ) => {
        controls.add(
          new ActionButton(
            { name, icon: name === 'focusCancel' || name === 'focusEnd' ? 'close' : 'play', label, onTap, selected },
            { left, top, width, height: 44 },
          ),
        )
      }
      let previousControls = ''
      const unsubscribe = service.subscribe((snapshot) => {
        const idle = snapshot.state === 'idle'
        state.string = `${localize(`focus.phase.${snapshot.phase}`)} / ${localize(`focus.${snapshot.state}`)}`
        warning.string = snapshot.storageFailed ? localize('focus.saveFailed') : ''
        countdown.visible = !idle
        countdown.style = snapshot.remainingMs === null ? styles.body : styles.brand
        countdown.string =
          snapshot.remainingMs === null
            ? localize(`focus.preset.${snapshot.preset}`)
            : remainingTime(snapshot.remainingMs)
        note.visible = !idle
        note.string =
          snapshot.state === 'interrupted'
            ? localize(snapshot.interruptionReason === 'clock' ? 'focus.clockInterrupted' : 'focus.rebootInterrupted')
            : snapshot.state === 'paused' && snapshot.pauseReason === 'hidden'
              ? localize('focus.hiddenPaused')
              : snapshot.state === 'completed'
                ? localize('focus.manualNext')
                : ''
        const key = `${snapshot.state}/${snapshot.preset}`
        if (key === previousControls) return
        previousControls = key
        controls.empty()
        if (idle) {
          const presets: FocusTimerPreset[] = ['focus-5', 'focus-15', 'focus-25', 'break-5']
          for (let index = 0; index < presets.length; index++) {
            const preset = presets[index]
            addButton(
              `focusPreset:${preset}`,
              localize(`focus.preset.${preset}`),
              () => service.select(preset),
              index % 2 === 0 ? 8 : 164,
              index < 2 ? 54 : 100,
              148,
              snapshot.preset === preset,
            )
          }
          addButton('focusStart', localize('focus.start'), () => service.start(), 8, 146, 304)
        } else if (snapshot.state === 'running' || snapshot.state === 'paused') {
          const running = snapshot.state === 'running'
          addButton(
            running ? 'focusPause' : 'focusResume',
            localize(running ? 'focus.pause' : 'focus.resume'),
            () => (running ? service.pause() : service.resume()),
            8,
            142,
            148,
          )
          addButton('focusCancel', localize('focus.cancel'), () => service.cancel(), 164, 142, 148)
        } else if (snapshot.state === 'completed') {
          addButton('focusAgain', localize('focus.again'), () => service.start(), 4, 142, 102)
          addButton('focusBreak', localize('focus.shortBreak'), () => service.start('break-5'), 109, 142, 102)
          addButton('focusEnd', localize('focus.end'), () => service.acknowledge(), 214, 142, 102)
        } else {
          addButton('focusRestart', localize('focus.restart'), () => service.start(), 8, 142, 148)
          addButton('focusEnd', localize('focus.end'), () => service.acknowledge(), 164, 142, 148)
        }
      })
      // The host owns the timer. Leaving the screen releases only this view's subscription.
      return { content, dispose: unsubscribe }
    },
  }
}
