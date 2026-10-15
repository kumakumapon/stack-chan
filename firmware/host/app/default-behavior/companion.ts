import type { StackchanAppBehavior } from 'app-behavior'
import { createCompanionBattery } from 'companion-battery'
import { isCompanionIdleSuppressed } from 'companion-idle'
import { CompanionInteraction } from 'companion-interaction'
import {
  DEFAULT_QUIET_END_MINUTE,
  DEFAULT_QUIET_START_MINUTE,
  dayPeriod,
  isClockSynced,
  isQuietHours,
  normalizeQuietMinute,
} from 'companion-time'
import { localize } from 'localization'
import Modules from 'modules'
import type { PerformanceName } from 'performance-types'
import { isReactionName, REACTION_NAMES, type ReactionName } from 'reaction-types'
import Time from 'time'
import Timer from 'timer'
import { getTimezonePreset } from 'timezone-model'

/** Character actions and touch play, coordinated with conversation and legacy petting. */
export const installCompanion: NonNullable<StackchanAppBehavior['onContextCreated']> = (robot, options) => {
  const settings = options?.config?.companion ?? {}
  const remote = robot.conversation.remoteSession
  const controller = (
    robot.ui.application as
      | {
          behavior?: {
            readonly companionIdle?: boolean
            onCompanionTap?: () => void
            onCompanionPetting?: () => boolean
            onCompanionMotion?: () => boolean
          }
        }
      | undefined
  )?.behavior
  const timeContext = () => {
    const epochMs = Date.now()
    if (!isClockSynced(epochMs)) return undefined
    const utcOffsetMinutes = getTimezonePreset(options?.config?.time?.timezone).offsetMinutes
    const quiet =
      (settings.quietHours === 1 || settings.quietHours === true) &&
      isQuietHours({
        epochMs,
        utcOffsetMinutes,
        startMinute: normalizeQuietMinute(settings.quietStart, DEFAULT_QUIET_START_MINUTE),
        endMinute: normalizeQuietMinute(settings.quietEnd, DEFAULT_QUIET_END_MINUTE),
      })
    return { period: dayPeriod(epochMs, utcOffsetMinutes), quiet }
  }
  let closed = false
  let lastAction = Date.now()
  let lastIdle = ''
  let noticeBalloon = false // true only while our own low-battery balloon is on screen
  let interaction: CompanionInteraction | undefined
  const isFree = (allowReaction = false) =>
    !closed &&
    controller?.companionIdle !== false &&
    !Modules.has('mod') &&
    !robot.audio.isActive &&
    (allowReaction || !robot.reaction.status().active) &&
    !robot.performance.status().active &&
    (!remote || remote.state === 'standby' || remote.state === 'blocked')
  const play = (name: PerformanceName) => {
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
    ['morning-stretch', '朝の体操'],
    ['curiosity-tour', '探検'],
    ['celebrate', 'お祝い'],
    ['shy-hello', '照れながら挨拶'],
    ['thinking-hard', 'ひらめき'],
    ['sleepy-bedtime', 'おやすみ'],
    ['thank-you', 'ありがとう'],
    ['goodbye', 'またね'],
  ] as const)
    robot.drawer.addDrawerButton({ key: `companion-${name}`, label, group: '遊ぶ', callback: () => play(name) })
  const reactionLabels: Record<ReactionName, string> = {
    yes: 'うん',
    no: 'いやいや',
    greeting: '挨拶',
    thinking: '考える',
    delighted: '大喜び',
    'sleepy-yawn': 'あくび',
    success: '成功',
    failure: 'しょんぼり',
    surprised: 'びっくり',
    curious: '好奇心',
    shy: '照れる',
    laugh: '笑う',
    wink: 'ウインク',
    love: '大好き',
    proud: '得意げ',
    worried: '心配',
    apologize: 'ごめんね',
    relieved: 'ほっとする',
    listening: '耳を傾ける',
    'look-around': 'きょろきょろ',
    stretch: '伸び',
    doze: 'うとうと',
    'wake-up': '目覚める',
    goodbye: 'またね',
    'head-hello': '気づいたよ',
    'nose-boop': 'つんつん',
    tickled: 'くすぐったい',
    'head-cuddle': '甘える',
    'look-touch-left': '左を気にする',
    'look-touch-right': '右を気にする',
    'happy-sparkle': 'きらきら喜ぶ',
    bashful: 'はにかむ',
  }
  robot.drawer.addDrawerButton({
    key: 'companion-reaction',
    label: 'リアクション',
    group: '遊ぶ',
    kind: 'choice',
    value: 'greeting',
    options: REACTION_NAMES.map((name) => ({ value: name, label: reactionLabels[name] })),
    callback: (_target, value) => {
      if (!isReactionName(value)) return
      lastAction = Date.now()
      if (remote?.activationState === 'active') remote.deactivate()
      robot.performance.cancel()
      robot.ui.closeDrawer()
      robot.ui.showFace()
      robot.reaction.play(value)
    },
  })
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
    interaction?.cancel()
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
      } else interaction?.faceTap()
    }
  const unsubscribe = remote?.subscribe((state, error) => {
    interaction?.cancel()
    lastAction = Date.now()
    noticeBalloon = false
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
      // Without a synced clock keep the original greeting path (no retry).
      const time = timeContext()
      if (time?.quiet) {
        robot.reaction.play('greeting', { intensity: 0.1 })
        return
      }
      if (time) {
        const intensity = time.period === 'morning' ? 0.4 : time.period === 'day' ? 0.3 : 0.2
        if ((options?.config?.tts?.type ?? 'local') === 'local') robot.reaction.play('greeting', { intensity })
        else play('greeting')
        return
      }
      // Legacy local TTS accepts resource keys, not arbitrary Japanese text.
      // Targets without a synthesizer still greet visibly without missing-resource errors.
      if ((options?.config?.tts?.type ?? 'local') === 'local') robot.reaction.play('greeting', { intensity: 0.3 })
      else play('greeting')
    }
  }, 800)
  let idle: ReturnType<typeof Timer.set> | undefined
  const removeTouch = robot.touchPanel?.subscribe((event) => {
    lastAction = Date.now()
    interaction?.touch(event)
  })
  const loadBatteryReader = (): (() => number | undefined) | undefined => {
    if (settings.lowBatteryNotice === 0 || settings.lowBatteryNotice === false) return undefined
    if (!Modules.has('battery-status')) return undefined
    try {
      return Modules.importNow('battery-status') as () => number | undefined
    } catch (error) {
      trace(`[companion] battery status unavailable: ${String(error)}
`)
      return undefined
    }
  }
  let noticeTimer: ReturnType<typeof Timer.set> | undefined
  const battery = createCompanionBattery({
    readLevel: loadBatteryReader(),
    timer: Timer,
    onLow: () => {
      if (!isFree() || (remote && remote.state !== 'standby')) return false
      robot.reaction.play('sleepy-yawn', { intensity: 0.2 })
      robot.showBalloon(localize('companion.lowBattery'))
      noticeBalloon = true
      if (noticeTimer) Timer.clear(noticeTimer)
      noticeTimer = Timer.set(() => {
        noticeTimer = undefined
        if (noticeBalloon) robot.hideBalloon()
        noticeBalloon = false
      }, 5000)
      return true
    },
  })
  interaction = new CompanionInteraction({
    now: () => (Number.isFinite(Time.ticks) ? Time.ticks : Date.now()),
    available: () =>
      isFree(true) && !isCompanionIdleSuppressed(robot) && !battery?.isLow() && remote?.activationState !== 'active',
    intensity: () => (timeContext()?.quiet ? 0 : 0.25),
    timer: {
      set: (callback, delay) => Timer.set(callback, delay),
      clear: (handle) => Timer.clear(handle as ReturnType<typeof Timer.set>),
    },
    reaction: robot.reaction,
    trace: (message) => trace(message),
  })
  if (controller) {
    // Preserve existing MOD-owned petting/IMU behavior. Additional touch play
    // stays out of MODs, conversations and Mini Apps.
    controller.onCompanionPetting = controller.onCompanionMotion = () =>
      Modules.has('mod') || interaction?.reserveLegacy() === true
  }
  // Low battery stretches idle gaps and keeps only the calmest reaction.
  const getIdlePlan = () =>
    battery?.isLow()
      ? { gapScale: 3, candidates: ['sleepy-yawn'] as const }
      : {
          gapScale: 1,
          candidates: [
            'yes',
            'thinking',
            'sleepy-yawn',
            'curious',
            'shy',
            'wink',
            'relieved',
            'listening',
            'look-around',
            'stretch',
            'doze',
          ] as const,
        }
  const schedule = () => {
    idle = Timer.set(
      () => {
        if (
          settings.idleReactions !== 0 &&
          settings.idleReactions !== false &&
          !isCompanionIdleSuppressed(robot) &&
          Date.now() - lastAction >= 30000 &&
          isFree()
        ) {
          const quiet = timeContext()?.quiet === true
          const { candidates } = getIdlePlan()
          const fresh = candidates.filter((name) => name !== lastIdle)
          // Quiet hours keep only the calmest reaction; low battery already narrows the candidates.
          const names = quiet ? (['sleepy-yawn'] as const) : fresh.length > 0 ? fresh : candidates
          const name = names[Math.floor(Math.random() * names.length)]
          lastIdle = name
          lastAction = Date.now()
          robot.reaction.play(name, { intensity: quiet ? 0.1 : 0.2 })
        }
        if (!closed) schedule()
      },
      getIdlePlan().gapScale * (30000 + Math.floor(Math.random() * 60000)),
    )
  }
  schedule()
  robot.lifecycle.onClose?.(() => {
    closed = true
    interaction?.close()
    Timer.clear(boot)
    if (idle) Timer.clear(idle)
    battery?.close()
    if (noticeTimer) Timer.clear(noticeTimer)
    unsubscribe?.()
    removeTouch?.()
    if (controller) {
      controller.onCompanionTap = undefined
      controller.onCompanionPetting = undefined
      controller.onCompanionMotion = undefined
    }
  })
}
