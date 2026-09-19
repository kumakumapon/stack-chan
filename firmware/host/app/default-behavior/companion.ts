import type { StackchanAppBehavior } from 'app-behavior'
import Modules from 'modules'
import Timer from 'timer'

/** Low-frequency character actions; the head panel remains dedicated to petting. */
export const installCompanion: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot, options) => {
  const settings = options?.config?.companion ?? {}
  const remote = robot.conversation.remoteSession
  const controller = (
    robot.ui.application as
      | {
          behavior?: {
            readonly companionIdle?: boolean
            onCompanionTap?: () => void
          }
        }
      | undefined
  )?.behavior
  let closed = false
  let lastAction = Date.now()
  let lastIdle = ''
  const isFree = () =>
    !closed &&
    controller?.companionIdle !== false &&
    !Modules.has('mod') &&
    !robot.audio.isActive &&
    !robot.reaction.status().active &&
    !robot.performance.status().active &&
    (!remote || remote.state === 'standby' || remote.state === 'blocked')
  const play = (name: 'greeting' | 'sing-twinkle' | 'happy-dance' | 'cheer') => {
    lastAction = Date.now()
    if (remote?.activationState === 'active') remote.deactivate()
    robot.ui.closeDrawer()
    robot.ui.showFace()
    const result = robot.performance.play(name)
    if (!result.ok) trace('[companion] performance refused\n')
  }
  for (const [name, label] of [
    ['greeting', '挨拶'],
    ['sing-twinkle', '歌う'],
    ['happy-dance', '踊る'],
    ['cheer', '応援'],
  ] as const)
    robot.drawer.addDrawerButton({ key: `companion-${name}`, label, group: '遊ぶ', callback: () => play(name) })
  robot.drawer.addDrawerButton({
    key: 'companion-janken',
    label: 'じゃんけん',
    group: '遊ぶ',
    callback: () => {
      lastAction = Date.now()
      robot.ui.closeDrawer()
      robot.ui.setHandAnimation('rock-paper-scissors')
    },
  })
  const start = () => {
    lastAction = Date.now()
    robot.performance.cancel()
    robot.reaction.cancel()
    robot.ui.closeDrawer()
    robot.ui.showFace()
    if (!remote) {
      robot.showBalloon('会話はWeb設定でGatewayまたはUSBを選んでね')
      return
    }
    if (remote.activationState === 'active') remote.deactivate()
    remote.activate()
    remote.requestStart()
  }
  robot.drawer.addDrawerButton({ key: 'companion-start', label: '会話を開始', group: '会話', callback: start })
  robot.drawer.addDrawerButton({
    key: 'companion-stop',
    label: '会話を停止',
    group: '会話',
    callback: () => {
      lastAction = Date.now()
      remote?.deactivate()
      robot.ui.closeDrawer()
    },
  })
  if (controller)
    controller.onCompanionTap = () => {
      lastAction = Date.now()
      if (remote) {
        if (remote.activationState === 'active' && remote.state !== 'standby' && remote.state !== 'blocked') {
          if (remote.interrupt && (remote.state === 'speaking' || remote.state === 'recognizing')) remote.interrupt()
          else remote.deactivate()
        } else start()
      } else if (isFree()) play(Math.random() < 0.5 ? 'greeting' : 'cheer')
    }
  const unsubscribe = remote?.subscribe((state, error) => {
    lastAction = Date.now()
    if (state === 'standby') {
      robot.hideBalloon()
      return
    }
    if (state === 'blocked') robot.showBalloon(error ?? '会話に接続できません')
    else
      robot.showBalloon(
        { connecting: '接続中…', listening: 'きいているよ', recognizing: '考え中…', speaking: 'おはなし中' }[state],
      )
    if (!robot.performance.status().active && !robot.reaction.status().active) {
      if (state === 'recognizing') robot.reaction.play('thinking', { intensity: 0.25 })
      if (state === 'blocked') robot.reaction.play('failure', { intensity: 0.25 })
    }
  })
  const boot = Timer.set(() => {
    if (settings.greetingOnBoot !== 0 && settings.greetingOnBoot !== false && isFree()) {
      // Legacy local TTS accepts resource keys, not arbitrary Japanese text.
      // Targets without a synthesizer still greet visibly without missing-resource errors.
      if ((options?.config?.tts?.type ?? 'local') === 'local') robot.reaction.play('greeting', { intensity: 0.3 })
      else play('greeting')
    }
  }, 800)
  let idle: ReturnType<typeof Timer.set> | undefined
  const removeTouch = robot.touchPanel?.subscribe(() => {
    lastAction = Date.now()
  })
  const schedule = () => {
    idle = Timer.set(
      () => {
        if (
          settings.idleReactions !== 0 &&
          settings.idleReactions !== false &&
          Date.now() - lastAction >= 30000 &&
          isFree()
        ) {
          const names = (['yes', 'thinking', 'sleepy-yawn'] as const).filter((name) => name !== lastIdle)
          const name = names[Math.floor(Math.random() * names.length)]
          lastIdle = name
          lastAction = Date.now()
          robot.reaction.play(name, { intensity: 0.2 })
        }
        if (!closed) schedule()
      },
      30000 + Math.floor(Math.random() * 60000),
    )
  }
  schedule()
  robot.lifecycle.onClose?.(() => {
    closed = true
    Timer.clear(boot)
    if (idle) Timer.clear(idle)
    unsubscribe?.()
    removeTouch?.()
    if (controller) controller.onCompanionTap = undefined
  })
}
