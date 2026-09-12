import { EmotionNames, emotionFromName } from 'face-state'
import sharedKey from 'ministack-config'
import { createController, SERVICE } from 'ministack-controller'
import Preference from 'preference'
import Timer from 'timer'

let active
export function onContextCreated(robot) {
  active?.close()
  const key = sharedKey
  if (typeof key !== 'string' || key.length < 16) {
    robot.ui.showBalloon('MiniStack: sharedKey (16+ characters) required')
    return
  }
  void start(robot, key).catch(() => robot.ui.showBalloon('MiniStack: start failed'))
}

async function start(robot, key) {
  const session = await robot.connectivity.localPeer.open({
    transport: 'ble',
    service: SERVICE,
    displayName: 'MiniStack',
    sharedKey: key,
  })
  // Monotonic per-boot counter persists through restart; no secret in the session ID.
  const boot = (Preference.get('ministack', 'boot') ?? 0) + 1
  Preference.set('ministack', 'boot', boot)
  const sessionId = `${robot.connectivity.localPeer.id}-${boot}`
  const clamp = (n, limit) => Math.max(-limit, Math.min(limit, n))
  const pose = (yaw, pitch, duration) =>
    robot.motion.setPose(
      { position: { x: 0, y: 0, z: 0 }, rotation: { y: clamp(yaw, 0.25), p: clamp(pitch, 0.15), r: 0 } },
      duration / 1000,
    )
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
    },
    async execute(type, p, cancelled) {
      if (cancelled()) throw new Error('cancelled')
      if (type === 'head.set') {
        await pose(p.yawRad, p.pitchRad, p.durationMs)
        return { yawRad: clamp(p.yawRad, 0.25), pitchRad: clamp(p.pitchRad, 0.15) }
      }
      if (type === 'face.set') robot.face.setEmotion(emotionFromName(p.emotion))
      if (type === 'speech.say') {
        const result = await robot.audio.say(p.text)
        if (result?.success === false) throw new Error('speech-failed')
      }
      if (type === 'reaction.play') {
        if (p.name === 'nod') {
          await pose(0, 0.08, 700)
          if (!cancelled()) await pose(0, 0, 700)
        } else robot.face.setEmotion(emotionFromName(p.name.toUpperCase()))
      }
      return {}
    },
  })
  let closed = false
  let lastSeen = Date.now()
  let peer
  const unsubscribe = session.subscribe('*', (message) => {
    // peer.secure alone also becomes true after earlier authenticated traffic.
    if (message.authenticated !== true || closed) return
    if (peer && peer !== message.peer.id) return
    peer = message.peer.id
    lastSeen = Date.now()
    void controller
      .receive(message.type, message.payload)
      .then((reply) => {
        if (!closed) return session.send(message.peer.id, 'response', reply)
      })
      .catch(() => close())
  })
  const watchdog = Timer.repeat(() => {
    if (peer && Date.now() - lastSeen > 3000) close()
  }, 500)
  function close() {
    if (closed) return
    closed = true
    controller.close()
    unsubscribe()
    Timer.clear(watchdog)
    session.close()
    robot.ui.drawer.removeDrawerButton('ministack-stop')
    robot.ui.showBalloon('MiniStack: stopped; restart MOD to reconnect')
  }
  active = { close }
  robot.ui.drawer.addDrawerButton({ key: 'ministack-stop', label: 'Stop MiniStack', callback: close })
  robot.ui.showBalloon('MiniStack: ready')
}
