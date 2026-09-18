import { EmotionNames, emotionFromName } from 'face-state'
import sharedKey from 'ministack-config'
import {
  applyHeadPose,
  createController,
  createEventOutbox,
  createEventPump,
  createHeartbeatWatchdog,
  createTransferRegistry,
  readServoDiagnostics,
  SERVICE,
} from 'ministack-controller'
import Preference from 'preference'
import Timer from 'timer'

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * XS has no `btoa`. Encodes raw bytes as standard base64 with `=` padding.
 * `TRANSFER_CHUNK_MAX` (1024) is not a multiple of 3, so the final chunk of a
 * real photo or recording routinely exercises the 1- and 2-byte remainder tails.
 */
function encodeBase64(bytes) {
  let out = ''
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + BASE64_CHARS[(n >> 6) & 63] + BASE64_CHARS[n & 63]
  }
  const remainder = bytes.length - i
  if (remainder === 1) {
    const n = bytes[i] << 16
    out += `${BASE64_CHARS[(n >> 18) & 63]}${BASE64_CHARS[(n >> 12) & 63]}==`
  } else if (remainder === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += `${BASE64_CHARS[(n >> 18) & 63]}${BASE64_CHARS[(n >> 12) & 63]}${BASE64_CHARS[(n >> 6) & 63]}=`
  }
  return out
}

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
  // Created before the rest of setup so a failure below still has somewhere to record itself.
  const events = createEventOutbox({ now: () => Date.now() })
  try {
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

    const transfers = createTransferRegistry({ now: () => Date.now(), encode: encodeBase64 })

    let closed = false
    let peer
    const pump = createEventPump({
      events,
      send: (event) => session.send(peer, 'event', event),
      // No peer yet means nowhere to send: the backlog waits rather than failing.
      isClosed: () => closed || !peer,
    })
    const pumpEvents = () => pump.pump()
    function emit(kind, data) {
      events.emit(kind, data)
      pumpEvents()
    }

    // Settings applied via config.set; read by the handlers below.
    let speechVolume = 100
    let longPressMs = 600

    // Recording state the long-press stop-button reaches into.
    let recording = false

    const controller = createController({
      now: () => Date.now(),
      sessionId,
      capabilities: {
        modVersion: '0.2.0',
        firmwareVersion: 'unknown',
        sessionId,
        emotions: [...EmotionNames],
        yawLimitRad: 0.25,
        pitchLimitRad: 0.15,
        immediateStop: false,
        listen: Boolean(robot.audio?.microphone),
        photo: Boolean(robot.camera) && robot.camera.available !== false,
        touch: Boolean(robot.input?.touchPanel),
        diagnostics: true,
        events: true,
        transfers: true,
      },
      readDiagnostics: () => readServoDiagnostics(robot.motion, commanded),
      events,
      transfers,
      applyConfig(settings) {
        if (settings.speechVolume !== undefined) speechVolume = settings.speechVolume
        if (settings.longPressMs !== undefined) longPressMs = settings.longPressMs
        if (settings.faceMotion !== undefined) robot.ui.setFaceMotionEnabled?.(settings.faceMotion)
      },
      async execute(type, p, cancelled) {
        if (cancelled()) throw new Error('cancelled')
        if (type === 'head.set') {
          await pose(p.yawRad, p.pitchRad, p.durationMs, cancelled)
          return { yawRad: clamp(p.yawRad, 0.25), pitchRad: clamp(p.pitchRad, 0.15) }
        }
        if (type === 'face.set') {
          if (p.emotion !== undefined) robot.face.setEmotion(emotionFromName(p.emotion))
          if (p.color !== undefined) robot.face.setColor(p.color.key, p.color.r, p.color.g, p.color.b)
        }
        if (type === 'speech.say') {
          emit('speech.started', { requestId: p.requestId })
          // audio.say's volume is a 0..1 fraction (see tts-playback-lifecycle's 0..256 fixed
          // point scaling), while the protocol's speechVolume setting is 0..100.
          const result = await robot.audio.say(p.text, speechVolume / 100)
          emit('speech.finished', { requestId: p.requestId, ok: result?.success !== false })
          if (result?.success === false) throw new Error('speech-failed')
          // The firmware exposes no way to interrupt an utterance already streaming to the
          // speaker (TTS only offers stream/streamKoe with no stop), so a requested interrupt
          // is accepted but never actually acted on; say so rather than pretending it worked.
          return p.interrupt === true ? { interruptHonoured: false } : {}
        }
        if (type === 'reaction.play') {
          if (p.name === 'nod') {
            await pose(0, 0.08, 700, cancelled)
            if (!cancelled()) await pose(0, 0, 700, cancelled)
          } else robot.face.setEmotion(emotionFromName(p.name.toUpperCase()))
        }
        if (type === 'conversation.listen') {
          emit('listen.started', { requestId: p.requestId })
          // The issue requires recording to be visible for its whole duration, not just announced.
          robot.ui.showBalloon('MiniStack: listening...')
          recording = true
          try {
            const buffer = await robot.audio.record(p.timeoutMs)
            const offer = transfers.offer('audio', new Uint8Array(buffer), {})
            emit('listen.finished', { requestId: p.requestId, ...offer })
            return offer
          } finally {
            recording = false
            robot.ui.hideBalloon()
          }
        }
        if (type === 'photo.capture') {
          if (!robot.camera || robot.camera.available === false) throw new Error('camera-unavailable')
          robot.ui.showBalloon('MiniStack: taking photo...')
          try {
            const frame = await robot.camera.capture({ imageType: 'jpeg' })
            if (!frame) throw new Error('camera-unavailable')
            try {
              const offer = transfers.offer(
                'photo',
                new Uint8Array(frame.buffer),
                { width: frame.width, height: frame.height, imageType: frame.imageType },
                frame.close,
              )
              emit('photo.ready', { requestId: p.requestId, ...offer })
              return offer
            } catch (error) {
              frame.close?.()
              throw error
            }
          } finally {
            robot.ui.hideBalloon()
            try {
              await robot.camera.stop()
            } catch (error) {
              // Releasing the camera failing must not turn a captured photo into a failed
              // command: the bytes are already registered and readable.
              trace(`[ministack] camera stop failed: ${String(error)}\n`)
            }
          }
        }
        return {}
      },
    })

    const liveness = createHeartbeatWatchdog(() => Date.now())
    const unsubscribeSession = session.subscribe('*', (message) => {
      // peer.secure alone also becomes true after earlier authenticated traffic.
      if (message.authenticated !== true || closed) return
      if (peer && peer !== message.peer.id) return
      const firstPeer = !peer
      peer = message.peer.id
      liveness.received(
        message.type !== 'capabilities.get' && message.payload?.v === 1 && message.payload?.sessionId === sessionId,
      )
      trace(`[ministack] received ${message.type}\n`)
      // Events queued before any peer authenticated (e.g. the boot 'ready') can now go out.
      if (firstPeer) pumpEvents()
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

    // Long-press classification: armed on press, cleared on release. Classifying only at
    // release would leave a long press inert until the finger lifts, defeating its purpose
    // as an immediate stop button.
    let longPressTimer
    let pressDown = false
    let longPressFired = false
    function stopForLongPress() {
      // Not routed through receive('stop', ...): that records a request ID, and a physical
      // button pressed a few hundred times would fill the session's bounded history and
      // start refusing the PC's own commands.
      controller.cancel()
      // Best effort: AudioCapability's documented surface exposes no cancel for an in-flight
      // record(). The concrete device Microphone does implement stop(), which aborts and
      // rejects the pending record() promise; a stub driver (e.g. wasm) has none, hence the
      // optional chain rather than a hard call.
      if (recording) robot.audio.microphone?.stop?.()
    }
    function clearLongPressTimer() {
      if (longPressTimer === undefined) return
      Timer.clear(longPressTimer)
      longPressTimer = undefined
    }
    function handleTouch(event) {
      if (event.gesture === 'press') {
        pressDown = true
        longPressFired = false
        clearLongPressTimer()
        longPressTimer = Timer.set(() => {
          longPressTimer = undefined
          if (!pressDown) return
          longPressFired = true
          emit('touch', { press: 'long', gesture: event.gesture, position: event.position })
          // A long press stops things itself; deciding what a short press means is the PC's job.
          stopForLongPress()
        }, longPressMs)
      } else if (event.gesture === 'release') {
        pressDown = false
        clearLongPressTimer()
        if (!longPressFired) emit('touch', { press: 'short', gesture: event.gesture, position: event.position })
      }
    }
    const touchPanel = robot.input?.touchPanel
    let unsubscribeTouch
    if (touchPanel) {
      if (typeof touchPanel.subscribe === 'function') unsubscribeTouch = touchPanel.subscribe(handleTouch)
      else touchPanel.onEvent = handleTouch
    }

    const watchdog = Timer.repeat(() => {
      if (liveness.expired()) close('heartbeat timeout')
      else pumpEvents()
    }, 500)
    function close(reason = 'manual stop') {
      if (closed) return
      closed = true
      trace(`[ministack] stopped: ${reason}\n`)
      clearLongPressTimer()
      if (unsubscribeTouch) unsubscribeTouch()
      else if (touchPanel) touchPanel.onEvent = undefined
      controller.close() // also releases outstanding transfers
      unsubscribeSession()
      Timer.clear(watchdog)
      session.close()
      if (robot.camera) {
        try {
          Promise.resolve(robot.camera.stop()).catch((error) => {
            trace(`[ministack] camera stop failed: ${String(error)}\n`)
          })
        } catch (error) {
          trace(`[ministack] camera stop failed: ${String(error)}\n`)
        }
      }
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
    emit('ready')
  } catch (error) {
    // Best effort: a peer may not be authenticated yet, in which case this simply waits
    // in the outbox for one that never comes before the session below is torn down.
    events.emit('error', { message: String(error) })
    session.close()
    throw error
  }
}
