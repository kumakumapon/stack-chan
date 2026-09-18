const BUTTON_NAMES = ['a', 'b', 'c']
const MOD_INSTALL_HOOKS = ['_fxMainSetModArchive', '_wasmModInstallArchive']
const DEFAULT_CAMERA_WIDTH = 96
const DEFAULT_CAMERA_HEIGHT = 96
const DEFAULT_CAMERA_IMAGE_TYPE = 'rgb565le'
const HAVE_CURRENT_DATA = 2

function normalizeDimension(value, fallback) {
  if (value === undefined) return fallback
  const normalized = value | 0
  return normalized > 0 ? normalized : fallback
}

function writeRgb565Le(view, width, height) {
  let offset = 0
  const widthScale = Math.max(1, width - 1)
  const heightScale = Math.max(1, height - 1)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = (x * 31) / widthScale
      const green = ((x + y) * 63) / Math.max(1, width + height - 2)
      const blue = (y * 31) / heightScale
      const pixel = ((red & 0x1f) << 11) | ((green & 0x3f) << 5) | (blue & 0x1f)

      view[offset] = pixel & 0xff
      view[offset + 1] = (pixel >> 8) & 0xff
      offset += 2
    }
  }
}

export function createHostDriverBridge({ onRotation = () => {}, onTorque = () => {} } = {}) {
  let rotation = { y: 0, p: 0, r: 0 }
  let torque = true

  return {
    applyRotation(message = {}) {
      rotation = { ...rotation, ...(message.rotation ?? {}) }
      onRotation(rotation, message.time)
    },
    getRotation() {
      return rotation
    },
    setTorque(nextTorque) {
      torque = Boolean(nextTorque)
      onTorque(torque)
    },
    getTorque() {
      return torque
    },
  }
}

export function createHostButtonBridge({
  logger = console.log,
  setTimeoutFn = globalThis.setTimeout,
  resetDelayMs = 120,
} = {}) {
  // Moddable's Button driver normalizes read() to 1 while pressed and 0 while
  // released, regardless of the physical pin's active-low wiring. Host.Button
  // must expose that normalized contract because SimButton passes read()
  // directly to StackchanRuntimeInput.
  const states = Object.fromEntries(BUTTON_NAMES.map((name) => [name, { pressed: 0, firmwareCallbacks: new Set() }]))

  const Button = Object.fromEntries(
    BUTTON_NAMES.map((name) => [
      name,
      class HtmlBridgeButton {
        constructor({ onPush } = {}) {
          if (onPush) states[name].firmwareCallbacks.add(onPush)
        }

        read() {
          return states[name].pressed
        }
      },
    ])
  )
  Object.defineProperty(Button, 'read', {
    value: (name) => states[name]?.pressed,
  })

  return {
    Button,
    push(name) {
      const state = states[name]
      if (!state) return
      logger(`[bridge] Host.Button.${name} pushed`)
      state.pressed = 1
      const currentGeneration = (state.generation = (state.generation ?? 0) + 1)
      for (const callback of state.firmwareCallbacks) callback()
      setTimeoutFn(() => {
        if (state.generation !== currentGeneration) return
        state.pressed = 0
        for (const callback of state.firmwareCallbacks) callback()
      }, resetDelayMs)
    },
    read(name) {
      return states[name]?.pressed
    },
  }
}

export function createHostTouchPanelBridge({
  channels = 3,
  touchIntensity = 32,
  // 60ms per swipe step is deliberately longer than the CoreS3 manifest's 50ms touchIntervalMs
  // poll, so the firmware's GestureRecognizer observes every scripted position.
  swipeStepMs = 60,
  swipeSteps = 8,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  logger = () => {},
} = {}) {
  // Si12T reports three intensity zones (left/center/right at channels 0/1/2); GestureRecognizer
  // derives a -100..100 centroid from them as (left*-100 + center*0 + right*100) / total.
  const state = new Array(channels).fill(0)
  let pendingTimers = []
  let swiping = false

  const clampPosition = (position) => Math.max(-100, Math.min(100, position))

  const clearState = () => state.fill(0)

  const applyPosition = (position) => {
    clearState()
    const clamped = clampPosition(position)
    // Map the requested centroid to a continuous channel index in [0, 2] (left=0, center=1,
    // right=2) and split touchIntensity across its two neighbours by the fractional part, so
    // GestureRecognizer.getPosition() recovers `clamped` (within rounding) from the result.
    const index = (clamped + 100) / 100
    const lower = Math.floor(index)
    const upper = Math.ceil(index)
    if (lower === upper) {
      if (lower >= 0 && lower < channels) state[lower] = touchIntensity
      return
    }
    const fraction = index - lower
    if (lower >= 0 && lower < channels) state[lower] = Math.round(touchIntensity * (1 - fraction))
    if (upper >= 0 && upper < channels) state[upper] = Math.round(touchIntensity * fraction)
  }

  const clearPendingTimers = () => {
    for (const timer of pendingTimers) clearTimeoutFn(timer)
    pendingTimers = []
  }

  return {
    TouchPanel: { read: (channel) => state[channel] ?? 0 },
    read(channel) {
      return state[channel] ?? 0
    },
    sample() {
      return [...state]
    },
    setPosition(position) {
      applyPosition(position)
    },
    release() {
      clearState()
    },
    // Scripts press -> swipeSteps interpolated positions -> release, each held swipeStepMs.
    // Forward runs -80 -> +80 and backward +80 -> -80, both clearing the 60-point swipeThreshold
    // with margin. Returns a Promise that resolves once the release step has run, for tests
    // that want to await a full gesture; callers that don't care may ignore it.
    swipe(direction) {
      clearPendingTimers()
      const start = direction === 'backward' ? 80 : -80
      const end = direction === 'backward' ? -80 : 80
      swiping = true
      logger(`[bridge] Host.TouchPanel swipe ${direction}`)
      applyPosition(start)
      return new Promise((resolve) => {
        for (let step = 1; step <= swipeSteps; step += 1) {
          const position = start + ((end - start) * step) / swipeSteps
          pendingTimers.push(setTimeoutFn(() => applyPosition(position), step * swipeStepMs))
        }
        pendingTimers.push(
          setTimeoutFn(() => {
            clearState()
            swiping = false
            resolve()
          }, (swipeSteps + 1) * swipeStepMs)
        )
      })
    },
    isSwiping() {
      return swiping
    },
    cancel() {
      clearPendingTimers()
      swiping = false
      clearState()
    },
  }
}

export const IMU_ORIENTATIONS = Object.freeze({
  upright: Object.freeze({ x: 0, y: 1, z: 0 }),
  upsideDown: Object.freeze({ x: 0, y: -1, z: 0 }),
  fallenForward: Object.freeze({ x: 0, y: 0, z: -1 }),
  fallenBackward: Object.freeze({ x: 0, y: 0, z: 1 }),
  fallenLeft: Object.freeze({ x: 1, y: 0, z: 0 }),
  fallenRight: Object.freeze({ x: -1, y: 0, z: 0 }),
})

function imuVectorMagnitude(vector) {
  return Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z)
}

function scaleImuVector(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor, z: vector.z * factor }
}

export function createHostImuBridge({
  // 1500ms comfortably covers the firmware's 10 consecutive 100ms IMU-poll samples (1000ms)
  // plus margin for scheduling jitter.
  shakeDurationMs = 1500,
  // Alternating +/-amplitude around the resting magnitude gives ~2x this as the delta between
  // consecutive samples, clearing MotionRecognizer's 1.2g accelerationDeltaThreshold with margin.
  shakeAmplitude = 1.6,
  gravity = 1,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  logger = () => {},
} = {}) {
  let orientationName = 'upright'
  let baseVector = scaleImuVector(IMU_ORIENTATIONS.upright, gravity)
  let accelerometer = baseVector
  const gyroscope = { x: 0, y: 0, z: 0 }
  let shaking = false
  let shakeTimer
  let shakePhaseSign = -1

  const shakeFactor = () => {
    const magnitude = imuVectorMagnitude(baseVector) || gravity || 1
    return (magnitude + shakePhaseSign * shakeAmplitude) / magnitude
  }

  const recomputeAccelerometer = () => {
    accelerometer = shaking ? scaleImuVector(baseVector, shakeFactor()) : baseVector
  }

  const clearShakeTimer = () => {
    if (shakeTimer !== undefined) clearTimeoutFn(shakeTimer)
    shakeTimer = undefined
  }

  const stopShake = () => {
    shaking = false
    shakePhaseSign = -1
    recomputeAccelerometer()
  }

  const read = (axis) => {
    if (axis === 0 && shaking) {
      // Sample-boundary contract: the firmware IMU driver always reads axis 0 first within one
      // sample(), so advancing the shake waveform here (never on a wall-clock timer) guarantees
      // every firmware sample sees a genuinely different magnitude, regardless of poll rate.
      shakePhaseSign = -shakePhaseSign
      recomputeAccelerometer()
    }
    switch (axis) {
      case 0:
        return accelerometer.x
      case 1:
        return accelerometer.y
      case 2:
        return accelerometer.z
      case 3:
        return gyroscope.x
      case 4:
        return gyroscope.y
      case 5:
        return gyroscope.z
      default:
        return 0
    }
  }

  return {
    IMU: { read },
    read,
    sample() {
      // Built from the same accelerometer/gyroscope state read(axis) serves, so the two can
      // never disagree; does not itself advance the shake phase.
      return { accelerometer: { ...accelerometer }, gyroscope: { ...gyroscope } }
    },
    orientation() {
      return orientationName
    },
    setOrientation(name) {
      const vector = IMU_ORIENTATIONS[name]
      if (!vector) return
      orientationName = name
      baseVector = scaleImuVector(vector, gravity)
      recomputeAccelerometer()
      logger(`[bridge] Host.IMU orientation ${name}`)
    },
    setAccelerometer(vector = {}) {
      orientationName = 'custom'
      baseVector = { x: vector.x ?? 0, y: vector.y ?? 0, z: vector.z ?? 0 }
      recomputeAccelerometer()
    },
    shake({ durationMs = shakeDurationMs } = {}) {
      clearShakeTimer()
      shaking = true
      shakePhaseSign = -1
      logger('[bridge] Host.IMU shake')
      shakeTimer = setTimeoutFn(() => {
        shakeTimer = undefined
        stopShake()
      }, durationMs)
    },
    isShaking() {
      return shaking
    },
    cancel() {
      clearShakeTimer()
      stopShake()
    },
  }
}

const DEFAULT_PERFORMANCE_STATUS = Object.freeze({
  reaction: Object.freeze({ active: null, startedAt: null }),
  performance: Object.freeze({ active: null, startedAt: null, nextCue: 0 }),
})

// Browser half of the reaction/performance simulator bridge: queues UI-issued
// play()/cancel() commands for the firmware to drain (see
// firmware/host/modules/performance/wasm/performance-bridge.js, which polls
// take() and calls setStatus() back), and holds the latest status the
// firmware reported so the UI can show what is active. Installed whole as
// stackchanRuntime.host.Performance (unlike Button/TouchPanel/IMU, its take()
// and setStatus() are meant to be called directly on the object the firmware
// sees, so there is no separate reader sub-object to split out).
export function createHostPerformanceBridge({ logger = () => {}, onStatus } = {}) {
  const queue = []
  let status = DEFAULT_PERFORMANCE_STATUS
  const statusListeners = new Set()
  if (onStatus) statusListeners.add(onStatus)

  const notifyStatus = () => {
    for (const listener of statusListeners) listener(status)
  }

  return {
    // UI -> firmware: queued in call order, drained one at a time by take().
    enqueue(command) {
      if (!command || typeof command !== 'object' || !command.target || !command.action) return
      queue.push(command)
      const label = command.name ? `${command.target}.${command.action} ${command.name}` : `${command.target}.${command.action}`
      logger(`[bridge] Host.Performance enqueue ${label}`)
    },
    // Called by the firmware bridge; JSON so it crosses the XS/WebAssembly string boundary
    // the same way take()'s counterpart setStatus() does. Empty string signals an empty queue.
    take() {
      const command = queue.shift()
      return command ? JSON.stringify(command) : ''
    },
    pending() {
      return queue.length
    },
    // Called by the firmware bridge with a JSON status snapshot; parse failures are logged and
    // otherwise ignored rather than corrupting the last-known-good status the UI is showing.
    setStatus(json) {
      let parsed
      try {
        parsed = JSON.parse(json)
      } catch (error) {
        logger(`[bridge] Host.Performance setStatus: invalid JSON (${error instanceof Error ? error.message : error})`)
        return
      }
      if (!parsed || typeof parsed !== 'object') return
      status = parsed
      notifyStatus()
    },
    getStatus() {
      return status
    },
    // EventTarget-like subscription for React, in addition to the onStatus constructor callback.
    addEventListener(type, listener) {
      if (type !== 'status' || typeof listener !== 'function') return
      statusListeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type !== 'status') return
      statusListeners.delete(listener)
    },
  }
}

export function installModArchiveIntoWasm(wasmModule, installedMod) {
  if (!installedMod) return { status: 'empty' }

  const bytes = installedMod.bytes instanceof Uint8Array ? installedMod.bytes : new Uint8Array(installedMod.bytes ?? [])
  const size = installedMod.size ?? bytes.byteLength
  const hookName = MOD_INSTALL_HOOKS.find((name) => typeof wasmModule?.[name] === 'function')

  if (typeof wasmModule?._malloc !== 'function' || !wasmModule.HEAPU8) {
    return { status: 'unsupported', name: installedMod.name, size }
  }

  const pointer = wasmModule._malloc(bytes.byteLength)
  wasmModule.HEAPU8.set(bytes, pointer)

  if (!hookName) return { status: 'prepared', pointer, name: installedMod.name, size }

  try {
    const result = wasmModule[hookName](pointer, bytes.byteLength)
    return { status: 'installed', hook: hookName, name: installedMod.name, size, result }
  } finally {
    wasmModule._free?.(pointer)
  }
}

export function createHostAudioOutBridge({
  createAudioContext = defaultAudioContextFactory,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let context

  return {
    async tone({ hz, duration, volume } = {}) {
      // Guard against non-finite values: the wasm audio bridge always passes a
      // volume argument, so an omitted volume arrives as NaN (not undefined) and
      // a destructuring default would not apply. Setting an AudioParam to a
      // non-finite value throws.
      const frequency = Number.isFinite(hz) ? hz : 440
      const durationMs = Number.isFinite(duration) ? Math.max(0, duration) : 100
      const level = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1
      context ??= createAudioContext()
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        await context.resume()
      }
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = frequency
      gain.gain.value = level
      oscillator.connect(gain)
      gain.connect(context.destination)
      const startTime = context.currentTime
      await new Promise((resolve, reject) => {
        let fallback
        const finish = () => {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          resolve()
        }
        oscillator.onended = finish
        try {
          oscillator.start(startTime)
          oscillator.stop(startTime + durationMs / 1000)
          fallback = setTimeoutFn?.(finish, durationMs + 250)
        } catch (error) {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          reject(error)
        }
      })
    },
    async play(buffer) {
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return false
      context ??= createAudioContext()
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        await context.resume()
      }
      if (typeof context.decodeAudioData !== 'function') return false

      const audioBuffer = await decodeAudioData(context, buffer)
      const source = context.createBufferSource()
      source.buffer = audioBuffer
      source.connect(context.destination)
      await new Promise((resolve, reject) => {
        let fallback
        const durationMilliSec = Number.isFinite(audioBuffer.duration) ? audioBuffer.duration * 1000 : 0
        const finish = () => {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          resolve()
        }
        source.onended = finish
        try {
          source.start(0)
          if (durationMilliSec > 0) {
            fallback = setTimeoutFn?.(finish, durationMilliSec + 250)
          }
        } catch (error) {
          if (fallback !== undefined) clearTimeoutFn?.(fallback)
          reject(error)
        }
      })
      return true
    },
    close() {
      context?.close?.()
      context = undefined
    },
  }
}

function writeImageDataRgb565Le(view, imageData) {
  let offset = 0
  const data = imageData.data

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index] >> 3
    const green = data[index + 1] >> 2
    const blue = data[index + 2] >> 3
    const pixel = (red << 11) | (green << 5) | blue

    view[offset] = pixel & 0xff
    view[offset + 1] = (pixel >> 8) & 0xff
    offset += 2
  }
}

function createSyntheticCameraFrame(options = {}) {
  const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
  if (imageType !== 'rgb565le') return undefined

  const width = normalizeDimension(options.width, DEFAULT_CAMERA_WIDTH)
  const height = normalizeDimension(options.height, DEFAULT_CAMERA_HEIGHT)
  const buffer = new ArrayBuffer(width * height * 2)
  writeRgb565Le(new Uint8Array(buffer), width, height)

  return { width, height, imageType, buffer }
}

// W3C MediaTrackConstraints facing modes: 'user' is the selfie camera, 'environment' the
// rear one. Keep these names as-is in the bridge; a 'front'/'back' label belongs in the UI.
export const CAMERA_FACING_MODES = Object.freeze(['user', 'environment'])

export function createHostCameraBridge({
  documentObj = globalThis.document,
  logger = console,
  navigatorObj = globalThis.navigator,
  videoElement,
  canvasElement,
} = {}) {
  let started = false
  let browserCameraRequested = false
  let browserCameraStarted = false
  let mediaStream
  let mediaVideo = videoElement
  let mediaCanvas = canvasElement
  let browserStartGeneration = 0
  let currentFacingMode

  const logWarning = (message, error) => {
    if (error) {
      logger?.warn?.(message, error)
    } else {
      logger?.warn?.(message)
    }
  }

  const ensureVideoElement = () => {
    if (mediaVideo) return mediaVideo
    if (!documentObj?.createElement) return undefined

    mediaVideo = documentObj.createElement('video')
    mediaVideo.muted = true
    mediaVideo.playsInline = true
    return mediaVideo
  }

  const ensureCanvasElement = () => {
    if (mediaCanvas) return mediaCanvas
    if (!documentObj?.createElement) return undefined

    mediaCanvas = documentObj.createElement('canvas')
    return mediaCanvas
  }

  const stopBrowserCamera = () => {
    browserStartGeneration += 1
    for (const track of mediaStream?.getTracks?.() ?? []) track.stop?.()
    mediaStream = undefined
    browserCameraStarted = false
    currentFacingMode = undefined
    if (mediaVideo) mediaVideo.srcObject = null
  }

  // options.video, when given, always wins over facingMode: it lets a caller hand getUserMedia
  // a full custom constraint, and facingMode only ever fills in the plain default case.
  const resolveVideoConstraint = (options) => {
    if (options.video !== undefined && options.video !== null) {
      return { constraint: options.video, facingMode: undefined }
    }

    const requestedFacingMode = options.facingMode
    if (requestedFacingMode === undefined) return { constraint: true, facingMode: undefined }

    if (!CAMERA_FACING_MODES.includes(requestedFacingMode)) {
      logWarning(`[bridge] ignoring unknown Host.Camera facingMode "${requestedFacingMode}"`)
      return { constraint: true, facingMode: undefined }
    }

    // 'ideal', not 'exact': a phone with only one camera, or a desktop webcam with none of
    // the requested facing, must still start rather than getUserMedia rejecting the request.
    return { constraint: { facingMode: { ideal: requestedFacingMode } }, facingMode: requestedFacingMode }
  }

  const startBrowserCamera = async (options = {}) => {
    const { constraint, facingMode: requestedFacingMode } = resolveVideoConstraint(options)

    if (
      browserCameraStarted &&
      mediaStream &&
      mediaVideo?.srcObject === mediaStream &&
      requestedFacingMode === currentFacingMode
    ) {
      return true
    }

    // A phone will not hand out both cameras at once, and leaving the old stream running
    // leaks tracks and keeps the camera light on, so always tear down before re-acquiring.
    stopBrowserCamera()

    const getUserMedia = navigatorObj?.mediaDevices?.getUserMedia?.bind(navigatorObj.mediaDevices)
    if (!getUserMedia) {
      browserCameraStarted = false
      return false
    }

    const video = ensureVideoElement()
    if (!video) {
      browserCameraStarted = false
      return false
    }

    try {
      const startGeneration = browserStartGeneration
      const stream = await getUserMedia({ video: constraint })
      if (startGeneration !== browserStartGeneration || !started || !browserCameraRequested) {
        for (const track of stream?.getTracks?.() ?? []) track.stop?.()
        return false
      }

      mediaStream = stream
      video.srcObject = mediaStream
      if (typeof video.play === 'function') await video.play()
      browserCameraStarted = true
      currentFacingMode = requestedFacingMode
      return true
    } catch (error) {
      stopBrowserCamera()
      logWarning('[bridge] browser camera unavailable; using synthetic Host.Camera fallback', error)
      return false
    }
  }

  const captureBrowserCamera = (options = {}) => {
    if (!started || !browserCameraRequested || !browserCameraStarted) return undefined
    if (!mediaVideo || mediaVideo.readyState < HAVE_CURRENT_DATA || !mediaVideo.videoWidth || !mediaVideo.videoHeight) {
      return undefined
    }

    const canvas = ensureCanvasElement()
    const context = canvas?.getContext?.('2d', { willReadFrequently: true })
    if (!canvas || !context?.drawImage || !context?.getImageData) return undefined

    const width = normalizeDimension(options.width, DEFAULT_CAMERA_WIDTH)
    const height = normalizeDimension(options.height, DEFAULT_CAMERA_HEIGHT)

    try {
      canvas.width = width
      canvas.height = height
      context.drawImage(mediaVideo, 0, 0, width, height)

      const imageData = context.getImageData(0, 0, width, height)
      if (!imageData?.data || imageData.data.length < width * height * 4) return undefined

      const buffer = new ArrayBuffer(width * height * 2)
      writeImageDataRgb565Le(new Uint8Array(buffer), imageData)

      return { width, height, imageType: 'rgb565le', buffer }
    } catch (error) {
      logWarning('[bridge] browser camera capture failed; using synthetic Host.Camera fallback', error)
      return undefined
    }
  }

  return {
    async start(options = {}) {
      started = true
      if (Object.hasOwn(options, 'useBrowserCamera')) {
        browserCameraRequested = Boolean(options.useBrowserCamera)
        if (browserCameraRequested) {
          await startBrowserCamera(options)
        } else {
          stopBrowserCamera()
        }
      }
    },
    stop() {
      started = false
      browserCameraRequested = false
      stopBrowserCamera()
    },
    isStarted() {
      return started
    },
    isBrowserCameraStarted() {
      return browserCameraStarted
    },
    facingMode() {
      return currentFacingMode
    },
    capture(options = {}) {
      const imageType = options.imageType ?? DEFAULT_CAMERA_IMAGE_TYPE
      if (imageType !== 'rgb565le') return undefined

      return captureBrowserCamera(options) ?? createSyntheticCameraFrame(options)
    },
  }
}

function decodeAudioData(context, buffer) {
  return new Promise((resolve, reject) => {
    const result = context.decodeAudioData(buffer.slice(0), resolve, reject)
    if (result && typeof result.then === 'function') {
      result.then(resolve, reject)
    }
  })
}

export function createHostAudioInBridge({
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorder = globalThis.MediaRecorder,
  setTimeoutFn = globalThis.setTimeout,
} = {}) {
  return {
    async record(durationMilliSec = 3000) {
      if (!mediaDevices?.getUserMedia || !MediaRecorder) return new ArrayBuffer(0)
      const format = selectAudioRecordingFormat(MediaRecorder)
      if (!format) {
        return new ArrayBuffer(0)
      }

      const stream = await mediaDevices.getUserMedia({ audio: true })
      const chunks = []
      try {
        return await new Promise((resolve) => {
          const recorder = new MediaRecorder(stream, { mimeType: format.mimeType })
          recorder.ondataavailable = (event) => {
            if (event.data) chunks.push(event.data)
          }
          recorder.onstop = async () => {
            const buffer = await chunksToArrayBuffer(chunks)
            resolve(attachAudioMetadata(isSupportedAudioBuffer(buffer, format) ? buffer : new ArrayBuffer(0), format))
          }
          recorder.start()
          setTimeoutFn(() => recorder.stop(), durationMilliSec)
        })
      } finally {
        for (const track of stream.getTracks?.() ?? []) track.stop?.()
      }
    },
  }
}

const AUDIO_RECORDING_FORMATS = Object.freeze([
  { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
  { mimeType: 'audio/webm', extension: 'webm' },
  { mimeType: 'audio/mp4', extension: 'm4a' },
  { mimeType: 'audio/wav', extension: 'wav' },
])

function selectAudioRecordingFormat(MediaRecorder) {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return AUDIO_RECORDING_FORMATS[0]
  return AUDIO_RECORDING_FORMATS.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType))
}

function isSupportedAudioBuffer(buffer, format) {
  if (format.mimeType === 'audio/wav') return isWavBuffer(buffer)
  return buffer instanceof ArrayBuffer && buffer.byteLength > 0
}

function attachAudioMetadata(buffer, format) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) return buffer
  const metadata = {
    mimeType: format.mimeType,
    filename: `speak.${format.extension}`,
  }
  try {
    Object.defineProperties(buffer, {
      mimeType: { value: metadata.mimeType, configurable: true },
      filename: { value: metadata.filename, configurable: true },
    })
  } catch {
    buffer.mimeType = metadata.mimeType
    buffer.filename = metadata.filename
  }
  return buffer
}

function defaultAudioContextFactory() {
  const AudioContextConstructor = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!AudioContextConstructor) throw new Error('WebAudio AudioContext is not available')
  return new AudioContextConstructor()
}

async function chunksToArrayBuffer(chunks) {
  const buffers = await Promise.all(
    chunks.map(async (chunk) => {
      if (chunk instanceof ArrayBuffer) return chunk
      if (ArrayBuffer.isView(chunk)) return chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
      if (typeof chunk.arrayBuffer === 'function') return chunk.arrayBuffer()
      return new ArrayBuffer(0)
    })
  )
  const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const buffer of buffers) {
    bytes.set(new Uint8Array(buffer), offset)
    offset += buffer.byteLength
  }
  return bytes.buffer
}

function isWavBuffer(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 12) return false
  const bytes = new Uint8Array(buffer)
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  )
}

export function clientPointFromTouch(touch) {
  return { x: touch.clientX, y: touch.clientY }
}

export function summarizeImageData(imageData, { sampleLimit = 1024 } = {}) {
  const data = imageData?.data ?? imageData
  if (!data?.length) return { samples: 0, nonZeroAlpha: 0, nonZeroRgb: 0, firstPixel: [] }

  const pixels = Math.floor(data.length / 4)
  const stride = Math.max(1, Math.floor(pixels / sampleLimit))
  let samples = 0
  let nonZeroAlpha = 0
  let nonZeroRgb = 0
  for (let pixel = 0; pixel < pixels; pixel += stride) {
    const offset = pixel * 4
    samples++
    if (data[offset + 3] !== 0) nonZeroAlpha++
    if (data[offset] !== 0 || data[offset + 1] !== 0 || data[offset + 2] !== 0) nonZeroRgb++
  }

  return {
    samples,
    nonZeroAlpha,
    nonZeroRgb,
    firstPixel: Array.from(data.slice(0, 4)),
  }
}
