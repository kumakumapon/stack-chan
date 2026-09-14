import { EmotionNames, emotionFromName } from 'face-state'
import sharedKey from 'ministack-config'
import {
  applyHeadPose,
  createController,
  createHeartbeatWatchdog,
  readServoDiagnostics,
  SERVICE,
} from 'ministack-controller'
import Preference from 'preference'
import Timer from 'timer'

let active
export function onContextCreated(robot) {
  trace('[ministack] context created\n')
  active?.close()
  const key = sharedKey
  if (typeof key !== 'string' || key.length < 16) {
    robot.ui.showBalloon('MiniStack: sharedKey (16+ characters) required')
    return
  }
  void start(robot, key).catch((error) => {
    trace(`[ministack] start failed: ${String(error)}\n`)
    robot.ui.showBalloon('MiniStack: start failed')
  })
}

async function start(robot, key) {
  const session = await robot.connectivity.localPeer.open({
    transport: 'ble',
    service: SERVICE,
    displayName: 'MiniStack',
    sharedKey: key,
  })
  trace('[ministack] BLE session opened\n')
  // Monotonic per-boot counter persists through restart; no secret in the session ID.
  const boot = (Preference.get('ministack', 'boot') ?? 0) + 1
  Preference.set('ministack', 'boot', boot)
  const sessionId = `${robot.connectivity.localPeer.id}-${boot}`
  const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n))
  // Last head target actually issued, reported next to the measured rotation.
  let commanded = null
  const pose = (yaw, pitch, duration, cancelled) => {
    commanded = { yawRad: clamp(yaw, 0.25), pitchRad: clamp(pitch, 0.15), durationMs: duration }
    return applyHeadPose(
      robot.motion,
      { position: { x: 0, y: 0, z: 0 }, rotation: { y: clamp(yaw, 0.25), p: clamp(pitch, 0.15), r: 0 } },
      duration / 1000,
      cancelled,
    )
  }
  const controller = createController({
    now: () => Date.now(),
    sessionId,
    capabilities: {
      modVersion: '0.1.0',
      firmwareVersion: 'unknown',
      sessionId,
      emotions: [...EmotionNames],
      yawLimitRad: 0.25,
      pitchLimitRad: 0.15,
      immediateStop: false,
      listen: false,
      photo: false,
      diagnostics: true,
    },
    readDiagnostics: () => readServoDiagnostics(robot.motion, commanded),
    async execute(type, p, cancelled) {
      if (cancelled()) throw new Error('cancelled')
      if (type === 'head.set') {
        await pose(p.yawRad, p.pitchRad, p.durationMs, cancelled)
        return { yawRad: clamp(p.yawRad, 0.25), pitchRad: clamp(p.pitchRad, 0.15) }
      }
      if (type === 'face.set') robot.face.setEmotion(emotionFromName(p.emotion))
      if (type === 'speech.say') {
        const result = await robot.audio.say(p.text)
        if (result?.success === false) throw new Error('speech-failed')
      }
      if (type === 'reaction.play') {
        if (p.name === 'nod') {
          await pose(0, 0.08, 700, cancelled)
          if (!cancelled()) await pose(0, 0, 700, cancelled)
        } else robot.face.setEmotion(emotionFromName(p.name.toUpperCase()))
      }
      return {}
    },
  })
  let closed = false
  const liveness = createHeartbeatWatchdog(() => Date.now())
  let peer
  const unsubscribe = session.subscribe('*', (message) => {
    // peer.secure alone also becomes true after earlier authenticated traffic.
    if (message.authenticated !== true || closed) return
    if (peer && peer !== message.peer.id) return
    peer = message.peer.id
    liveness.received(
      message.type !== 'capabilities.get' && message.payload?.v === 1 && message.payload?.sessionId === sessionId,
    )
    trace(`[ministack] received ${message.type}\n`)
    void controller
      .receive(message.type, message.payload)
      .then((reply) => {
        if (!closed) return session.send(message.peer.id, 'response', reply)
      })
      .catch((error) => {
        trace(`[ministack] response failed: ${String(error)}\n`)
        // A lost reply ACK does not prove the peer is gone. Keep accepting
        // requests; the heartbeat watchdog still closes an inactive session.
      })
  })
  const watchdog = Timer.repeat(() => {
    if (liveness.expired()) close('heartbeat timeout')
  }, 500)
  function close(reason = 'manual stop') {
    if (closed) return
    closed = true
    trace(`[ministack] stopped: ${reason}\n`)
    controller.close()
    unsubscribe()
    Timer.clear(watchdog)
    session.close()
    robot.ui.drawer.removeDrawerButton('ministack-stop')
    robot.ui.showBalloon(`MiniStack: ${reason}; restart to reconnect`)
  }
  active = { close }
  robot.ui.drawer.addDrawerButton({
    key: 'ministack-stop',
    label: 'Stop MiniStack',
    callback: () => close('manual stop'),
  })
  trace('[ministack] ready\n')
  robot.ui.showBalloon('MiniStack: ready')
}
