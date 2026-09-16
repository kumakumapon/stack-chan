import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  IMU_ORIENTATIONS,
  clientPointFromTouch,
  createHostAudioInBridge,
  createHostAudioOutBridge,
  createHostButtonBridge,
  createHostCameraBridge,
  createHostDriverBridge,
  createHostImuBridge,
  createHostTouchPanelBridge,
  installModArchiveIntoWasm,
  summarizeImageData,
} from './bridge.mjs'

// Reimplemented from firmware/host/modules/input/touch-panel-gesture.ts GestureRecognizer.getPosition,
// which is the ground truth the touch panel bridge's setPosition() must round-trip against.
function getPosition(sample) {
  const left = sample[0] ?? 0
  const center = sample[1] ?? 0
  const right = sample[2] ?? 0
  const total = left + center + right
  if (total === 0) return 0
  return Math.trunc((left * -100 + center * 0 + right * 100) / total)
}

// Reimplemented from firmware/host/modules/input/imu-motion.ts detectPosture, the ground truth
// the IMU bridge's orientation vectors must classify against.
function detectPosture(accelerometer, threshold = 0.75) {
  const magnitude = Math.sqrt(accelerometer.x ** 2 + accelerometer.y ** 2 + accelerometer.z ** 2)
  if (magnitude === 0) return 'unknown'
  const x = accelerometer.x / magnitude
  const y = accelerometer.y / magnitude
  const z = accelerometer.z / magnitude
  if (y >= threshold) return 'upright'
  if (y <= -threshold) return 'upsideDown'
  if (Math.abs(x) >= Math.abs(z) && Math.abs(x) >= threshold) return x >= 0 ? 'fallenLeft' : 'fallenRight'
  if (Math.abs(z) >= threshold) return z < 0 ? 'fallenForward' : 'fallenBackward'
  return 'unknown'
}

function createFakeTimers() {
  const scheduled = []
  const cleared = new Set()
  let nextId = 1
  return {
    scheduled,
    cleared,
    setTimeoutFn: (callback, delay) => {
      const id = nextId++
      scheduled.push({ id, callback, delay })
      return id
    },
    clearTimeoutFn: (id) => {
      cleared.add(id)
    },
    // Runs every not-yet-cleared timer in the order it was scheduled (they are pushed here in
    // non-decreasing delay order, matching how each bridge schedules its own sequence).
    runAll: () => {
      for (const timer of scheduled) {
        if (!cleared.has(timer.id)) timer.callback()
      }
    },
  }
}

describe('Host.Button bridge', () => {
  it('emits normalized press and release edges for button-aware MOD compatibility', () => {
    const scheduled = []
    const events = []
    const bridge = createHostButtonBridge({
      logger: (message) => events.push(message),
      setTimeoutFn: (callback, delay) => {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
    })
    const firmwareButton = new bridge.Button.a({ onPush: () => events.push('firmware:a') })

    assert.equal(bridge.Button.read('a'), 0)
    assert.equal(firmwareButton.read(), 0)
    assert.equal(bridge.read('a'), 0)
    bridge.push('a')

    assert.equal(firmwareButton.read(), 1)
    assert.equal(bridge.Button.read('a'), 1)
    assert.equal(bridge.read('a'), 1)
    assert.deepEqual(events, ['[bridge] Host.Button.a pushed', 'firmware:a'])
    assert.equal(scheduled[0].delay, 120)

    scheduled[0].callback()
    assert.equal(firmwareButton.read(), 0)
    assert.equal(bridge.read('a'), 0)
    assert.deepEqual(events, ['[bridge] Host.Button.a pushed', 'firmware:a', 'firmware:a'])
  })

  it('ignores unknown button names without throwing', () => {
    const bridge = createHostButtonBridge({ logger: () => {} })
    assert.doesNotThrow(() => bridge.push('x'))
    assert.equal(bridge.read('x'), undefined)
  })

  it('keeps a repeated push pressed until the latest release timeout', () => {
    const scheduled = []
    const edges = []
    const bridge = createHostButtonBridge({
      logger: () => {},
      setTimeoutFn: (callback) => scheduled.push(callback),
    })
    new bridge.Button.a({ onPush: () => edges.push(bridge.read('a')) })

    bridge.push('a')
    bridge.push('a')
    scheduled[0]()
    assert.equal(bridge.read('a'), 1)
    assert.deepEqual(edges, [1, 1])

    scheduled[1]()
    assert.equal(bridge.read('a'), 0)
    assert.deepEqual(edges, [1, 1, 0])
  })
})

describe('WASM screen diagnostics', () => {
  it('summarizes sampled image data so blank alpha buffers are visible in diagnostics', () => {
    const stats = summarizeImageData(new Uint8ClampedArray([0, 0, 0, 0, 12, 0, 0, 255]))

    assert.equal(stats.samples, 2)
    assert.equal(stats.nonZeroAlpha, 1)
    assert.equal(stats.nonZeroRgb, 1)
    assert.deepEqual(stats.firstPixel, [0, 0, 0, 0])
  })
})
describe('Host.Driver bridge', () => {
  it('records firmware rotation messages and notifies the simulator scene', () => {
    const events = []
    const bridge = createHostDriverBridge({
      onRotation: (rotation, time) => events.push({ rotation, time }),
      onTorque: (torque) => events.push({ torque }),
    })

    bridge.applyRotation({ rotation: { y: 0.2, p: -0.1, r: 0.03 }, time: 0.5 })
    bridge.setTorque(false)

    assert.deepEqual(bridge.getRotation(), { y: 0.2, p: -0.1, r: 0.03 })
    assert.deepEqual(events, [{ rotation: { y: 0.2, p: -0.1, r: 0.03 }, time: 0.5 }, { torque: false }])
  })
})

describe('Host.Audio bridge', () => {
  it('resolves tone playback only after the oscillator ends and closes the context', async () => {
    const events = []
    let oscillator
    const context = {
      currentTime: 2,
      closed: false,
      createOscillator() {
        oscillator = {
          frequency: { value: 0 },
          onended: undefined,
          connect(node) {
            events.push(['osc-connect', node.kind])
          },
          start(time) {
            events.push(['start', time, this.frequency.value])
          },
          stop(time) {
            events.push(['stop', time])
          },
        }
        return oscillator
      },
      createGain() {
        return {
          kind: 'gain',
          gain: { value: 0 },
          connect(node) {
            events.push(['gain-connect', node])
          },
        }
      },
      destination: 'destination',
      state: 'suspended',
      async resume() {
        this.state = 'running'
        events.push(['resume'])
      },
      close() {
        this.closed = true
        events.push(['close'])
      },
    }
    const bridge = createHostAudioOutBridge({ createAudioContext: () => context })

    let resolved = false
    const tone = bridge.tone({ hz: 880, duration: 500, volume: 0.25 }).then(() => {
      resolved = true
    })

    await Promise.resolve()
    assert.equal(resolved, false)
    oscillator.onended()
    await tone
    bridge.close()

    assert.deepEqual(events, [
      ['resume'],
      ['osc-connect', 'gain'],
      ['gain-connect', 'destination'],
      ['start', 2, 880],
      ['stop', 2.5],
      ['close'],
    ])
    assert.equal(context.closed, true)
  })

  it('clamps non-finite hz/volume so AudioParam is never set to NaN', async () => {
    // real AudioParam throws when set to a non-finite value; the wasm bridge
    // sends a NaN volume when a MOD calls tone() without one.
    const makeParam = () => {
      let stored = 0
      return {
        get value() {
          return stored
        },
        set value(next) {
          if (!Number.isFinite(next)) throw new TypeError('non-finite AudioParam value')
          stored = next
        },
      }
    }
    let oscillator
    let gain
    const context = {
      currentTime: 0,
      createOscillator() {
        oscillator = { frequency: makeParam(), onended: undefined, connect() {}, start() {}, stop() {} }
        return oscillator
      },
      createGain() {
        gain = { kind: 'gain', gain: makeParam(), connect() {} }
        return gain
      },
      destination: 'destination',
      state: 'running',
    }
    const bridge = createHostAudioOutBridge({
      createAudioContext: () => context,
      setTimeoutFn: (fn) => {
        fn()
        return 0
      },
      clearTimeoutFn: () => {},
    })

    await bridge.tone({ hz: 440, duration: 300, volume: Number.NaN })
    assert.equal(oscillator.frequency.value, 440)
    assert.equal(gain.gain.value, 1) // NaN volume falls back to full volume

    await bridge.tone({ hz: Number.NaN, duration: Number.NaN, volume: 2 })
    assert.equal(oscillator.frequency.value, 440) // NaN hz falls back to 440
    assert.equal(gain.gain.value, 1) // volume clamped to [0, 1]
  })

  it('resolves tone playback with a duration fallback when onended does not fire', async () => {
    const scheduled = []
    const context = {
      currentTime: 0,
      createOscillator() {
        return {
          frequency: { value: 0 },
          onended: undefined,
          connect() {},
          start() {},
          stop() {},
        }
      },
      createGain() {
        return {
          gain: { value: 0 },
          connect() {},
        }
      },
      destination: 'destination',
      state: 'running',
    }
    const bridge = createHostAudioOutBridge({
      createAudioContext: () => context,
      setTimeoutFn(callback, delay) {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
      clearTimeoutFn() {},
    })

    let resolved = false
    const tone = bridge.tone({ hz: 440, duration: 300, volume: 0.5 }).then(() => {
      resolved = true
    })

    assert.equal(resolved, false)
    assert.equal(scheduled[0].delay, 550)
    scheduled[0].callback()
    await tone
    assert.equal(resolved, true)
  })

  it('decodes and plays recorded microphone audio through AudioContext', async () => {
    const events = []
    let source
    const context = {
      destination: 'destination',
      state: 'suspended',
      async resume() {
        this.state = 'running'
        events.push(['resume'])
      },
      async decodeAudioData(buffer) {
        events.push(['decode', buffer.byteLength])
        return { kind: 'audio-buffer' }
      },
      createBufferSource() {
        source = {
          buffer: undefined,
          onended: undefined,
          connect(node) {
            events.push(['source-connect', node])
          },
          start(time) {
            events.push(['source-start', time, this.buffer.kind])
          },
        }
        return source
      },
    }
    const bridge = createHostAudioOutBridge({ createAudioContext: () => context })
    const recorded = new Uint8Array([1, 2, 3, 4]).buffer

    let resolved = false
    const playback = bridge.play(recorded).then((played) => {
      resolved = played
    })

    while (!source) await Promise.resolve()
    assert.equal(resolved, false)
    source.onended()
    await playback

    assert.equal(resolved, true)
    assert.deepEqual(events, [
      ['resume'],
      ['decode', 4],
      ['source-connect', 'destination'],
      ['source-start', 0, 'audio-buffer'],
    ])
  })

  it('skips playback for an empty recording buffer', async () => {
    const bridge = createHostAudioOutBridge({
      createAudioContext() {
        throw new Error('AudioContext should not be created for empty playback')
      },
    })

    assert.equal(await bridge.play(new ArrayBuffer(0)), false)
  })

  it('records WebM/Opus microphone audio when the browser supports it', async () => {
    const stopped = []
    const recorderOptions = []
    const webmHeader = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])
    class FakeMediaRecorder {
      static isTypeSupported(type) {
        return type === 'audio/webm;codecs=opus'
      }

      constructor(stream, options) {
        this.stream = stream
        recorderOptions.push(options)
      }
      start() {
        this.ondataavailable?.({ data: webmHeader.buffer })
      }
      stop() {
        this.onstop?.()
      }
    }
    const bridge = createHostAudioInBridge({
      mediaDevices: {
        async getUserMedia(request) {
          assert.deepEqual(request, { audio: true })
          return { getTracks: () => [{ stop: () => stopped.push('track') }] }
        },
      },
      MediaRecorder: FakeMediaRecorder,
      setTimeoutFn(fn) {
        fn()
      },
    })

    const buffer = await bridge.record(100)

    assert.deepEqual(Array.from(new Uint8Array(buffer)), Array.from(webmHeader))
    assert.equal(buffer.mimeType, 'audio/webm;codecs=opus')
    assert.equal(buffer.filename, 'speak.webm')
    assert.deepEqual(recorderOptions, [{ mimeType: 'audio/webm;codecs=opus' }])
    assert.deepEqual(stopped, ['track'])
  })

  it('records WAV-compatible microphone audio when WAV is the supported browser format', async () => {
    const stopped = []
    const recorderOptions = []
    const wavHeader = new TextEncoder().encode('RIFFxxxxWAVE')
    class FakeMediaRecorder {
      static isTypeSupported(type) {
        return type === 'audio/wav'
      }

      constructor(stream, options) {
        this.stream = stream
        recorderOptions.push(options)
      }
      start() {
        this.ondataavailable?.({ data: wavHeader.buffer })
      }
      stop() {
        this.onstop?.()
      }
    }
    const bridge = createHostAudioInBridge({
      mediaDevices: {
        async getUserMedia(request) {
          assert.deepEqual(request, { audio: true })
          return { getTracks: () => [{ stop: () => stopped.push('track') }] }
        },
      },
      MediaRecorder: FakeMediaRecorder,
      setTimeoutFn(fn) {
        fn()
      },
    })

    const buffer = await bridge.record(100)

    assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), 'RIFF')
    assert.equal(new TextDecoder().decode(buffer.slice(8, 12)), 'WAVE')
    assert.equal(buffer.mimeType, 'audio/wav')
    assert.equal(buffer.filename, 'speak.wav')
    assert.deepEqual(recorderOptions, [{ mimeType: 'audio/wav' }])
    assert.deepEqual(stopped, ['track'])
  })

  it('returns an empty microphone buffer when no supported recording format is available', async () => {
    let requested = false
    class FakeMediaRecorder {
      static isTypeSupported() {
        return false
      }
    }
    const bridge = createHostAudioInBridge({
      mediaDevices: {
        async getUserMedia() {
          requested = true
          throw new Error('should not request microphone without WAV support')
        },
      },
      MediaRecorder: FakeMediaRecorder,
    })

    const buffer = await bridge.record(100)

    assert.equal(buffer.byteLength, 0)
    assert.equal(requested, false)
  })
})

describe('Host.Camera bridge', () => {
  it('returns deterministic RGB565LE frames sized to capture options', () => {
    const bridge = createHostCameraBridge()

    const first = bridge.capture({ width: 4, height: 3, imageType: 'rgb565le' })
    const second = bridge.capture({ width: 4, height: 3, imageType: 'rgb565le' })

    assert.ok(first)
    assert.ok(second)
    assert.equal(first.width, 4)
    assert.equal(first.height, 3)
    assert.equal(first.imageType, 'rgb565le')
    assert.equal(first.buffer.byteLength, 4 * 3 * 2)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('tracks start and stop without requiring browser media devices', async () => {
    const bridge = createHostCameraBridge()

    await bridge.start({ width: 2, height: 2 })
    assert.equal(bridge.isStarted(), true)

    bridge.stop()
    bridge.stop()
    assert.equal(bridge.isStarted(), false)
  })

  it('captures ready browser video frames as RGB565LE through canvas', async () => {
    const calls = []
    const stream = { getTracks: () => [{ stop: () => calls.push('stop') }] }
    const video = {
      readyState: 2,
      videoWidth: 16,
      videoHeight: 16,
      play: async () => calls.push('play'),
    }
    const canvas = {
      getContext: () => ({
        drawImage: (...args) => calls.push(['drawImage', ...args.slice(1)]),
        getImageData: () => ({
          data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
        }),
      }),
    }
    const bridge = createHostCameraBridge({
      canvasElement: canvas,
      navigatorObj: {
        mediaDevices: {
          async getUserMedia(constraints) {
            calls.push(['getUserMedia', constraints])
            return stream
          },
        },
      },
      videoElement: video,
    })

    await bridge.start({ useBrowserCamera: true })
    const frame = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isStarted(), true)
    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.deepEqual(calls.slice(0, 3), [['getUserMedia', { video: true }], 'play', ['drawImage', 0, 0, 2, 2]])
    assert.equal(video.srcObject, stream)
    assert.equal(canvas.width, 2)
    assert.equal(canvas.height, 2)
    assert.equal(frame.width, 2)
    assert.equal(frame.height, 2)
    assert.equal(frame.imageType, 'rgb565le')
    assert.equal(frame.buffer.byteLength, 2 * 2 * 2)
    assert.deepEqual(new Uint8Array(frame.buffer), new Uint8Array([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 0xff, 0xff]))

    bridge.stop()
    assert.equal(video.srcObject, null)
    assert.equal(calls.at(-1), 'stop')
  })

  it('falls back to synthetic RGB565LE when browser media APIs are absent', async () => {
    const bridge = createHostCameraBridge({ navigatorObj: {}, documentObj: undefined })

    await bridge.start({ useBrowserCamera: true })
    const first = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })
    const second = createHostCameraBridge().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('falls back to synthetic RGB565LE when browser permission is denied', async () => {
    const warnings = []
    const bridge = createHostCameraBridge({
      logger: { warn: (...args) => warnings.push(args) },
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            throw new Error('denied')
          },
        },
      },
      videoElement: { srcObject: undefined },
    })

    await assert.doesNotReject(() => bridge.start({ useBrowserCamera: true }))
    const frame = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.equal(frame.buffer.byteLength, 2 * 2 * 2)
    assert.match(warnings[0][0], /browser camera unavailable/)
  })

  it('falls back to synthetic RGB565LE when browser video is not ready', async () => {
    const bridge = createHostCameraBridge({
      canvasElement: {
        getContext: () => {
          throw new Error('canvas should not be read before video is ready')
        },
      },
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            return { getTracks: () => [] }
          },
        },
      },
      videoElement: { readyState: 1, videoWidth: 0, videoHeight: 0 },
    })

    await bridge.start({ useBrowserCamera: true })
    const first = bridge.capture({ width: 2, height: 2, imageType: 'rgb565le' })
    const second = createHostCameraBridge().capture({ width: 2, height: 2, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.deepEqual(new Uint8Array(first.buffer), new Uint8Array(second.buffer))
  })

  it('keeps an already-started browser camera stream when firmware starts camera preview', async () => {
    const calls = []
    const stream = { getTracks: () => [{ stop: () => calls.push('stop') }] }
    const video = {
      readyState: 2,
      videoWidth: 16,
      videoHeight: 16,
      play: async () => calls.push('play'),
    }
    const bridge = createHostCameraBridge({
      navigatorObj: {
        mediaDevices: {
          async getUserMedia(constraints) {
            calls.push(['getUserMedia', constraints])
            return stream
          },
        },
      },
      videoElement: video,
    })

    await bridge.start({ useBrowserCamera: true })
    await bridge.start({ width: 200, height: 120, imageType: 'rgb565le' })

    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.equal(video.srcObject, stream)
    assert.deepEqual(calls, [['getUserMedia', { video: true }], 'play'])
  })

  it('starts a fresh browser stream for a second firmware camera preview', async () => {
    const calls = []
    const streams = [0, 1].map((index) => ({
      getTracks: () => [{ stop: () => calls.push(['stop', index]) }],
    }))
    const secondStream = streams[1]
    const video = {
      readyState: 2,
      videoWidth: 16,
      videoHeight: 16,
      play: async () => calls.push('play'),
    }
    const bridge = createHostCameraBridge({
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            const stream = streams.shift()
            calls.push('getUserMedia')
            return stream
          },
        },
      },
      videoElement: video,
    })

    await bridge.start({ useBrowserCamera: true })
    bridge.stop()
    await bridge.start({ useBrowserCamera: true })

    assert.equal(bridge.isBrowserCameraStarted(), true)
    assert.equal(video.srcObject, secondStream)
    assert.deepEqual(calls, ['getUserMedia', 'play', ['stop', 0], 'getUserMedia', 'play'])
  })

  it('allows an explicit non-browser camera start to stop an active browser stream', async () => {
    const calls = []
    const stream = { getTracks: () => [{ stop: () => calls.push('stop') }] }
    const video = { readyState: 2, videoWidth: 16, videoHeight: 16, play: async () => calls.push('play') }
    const bridge = createHostCameraBridge({
      navigatorObj: {
        mediaDevices: {
          async getUserMedia() {
            return stream
          },
        },
      },
      videoElement: video,
    })

    await bridge.start({ useBrowserCamera: true })
    await bridge.start({ useBrowserCamera: false })

    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.equal(video.srcObject, null)
    assert.deepEqual(calls, ['play', 'stop'])
  })

  it('stops late-resolving browser streams when camera was stopped during permission prompt', async () => {
    let resolveStream
    const stopped = []
    const stream = { getTracks: () => [{ stop: () => stopped.push('stop') }] }
    const video = { srcObject: undefined, play: async () => {} }
    const bridge = createHostCameraBridge({
      navigatorObj: {
        mediaDevices: {
          getUserMedia() {
            return new Promise((resolve) => {
              resolveStream = resolve
            })
          },
        },
      },
      videoElement: video,
    })

    const startPromise = bridge.start({ useBrowserCamera: true })
    bridge.stop()
    resolveStream(stream)
    await startPromise

    assert.equal(bridge.isStarted(), false)
    assert.equal(bridge.isBrowserCameraStarted(), false)
    assert.equal(video.srcObject, null)
    assert.deepEqual(stopped, ['stop'])
  })

  it('keeps unsupported camera formats out of the simulator bridge', () => {
    const bridge = createHostCameraBridge()

    assert.equal(bridge.capture({ imageType: 'jpeg' }), undefined)
    assert.equal('captureJpeg' in bridge, false)
  })
})

describe('touch coordinate bridge', () => {
  it('uses viewport-relative client coordinates for hidden-canvas touch forwarding', () => {
    const point = clientPointFromTouch({ clientX: 42, clientY: 24, pageX: 1042, pageY: 2024 })

    assert.deepEqual(point, { x: 42, y: 24 })
  })
})

describe('MOD archive bridge', () => {
  it('reports empty when no archive is installed', () => {
    assert.deepEqual(installModArchiveIntoWasm({}, null), { status: 'empty' })
  })

  it('copies archive bytes into wasm memory, calls the install hook, and frees memory', () => {
    const heap = new Uint8Array(32)
    const calls = []
    const wasmModule = {
      HEAPU8: heap,
      _malloc(size) {
        calls.push(['malloc', size])
        return 8
      },
      _free(pointer) {
        calls.push(['free', pointer])
      },
      _wasmModInstallArchive(pointer, size) {
        calls.push(['hook', pointer, size, Array.from(heap.slice(pointer, pointer + size))])
        return 0
      },
    }

    const result = installModArchiveIntoWasm(wasmModule, {
      name: 'mod.xsa',
      bytes: new Uint8Array([10, 20, 30]),
      size: 3,
    })

    assert.deepEqual(result, {
      status: 'installed',
      hook: '_wasmModInstallArchive',
      name: 'mod.xsa',
      size: 3,
      result: 0,
    })
    assert.deepEqual(calls, [
      ['malloc', 3],
      ['hook', 8, 3, [10, 20, 30]],
      ['free', 8],
    ])
  })

  it('prepares archive bytes as a launch archive when no explicit install hook exists', () => {
    const heap = new Uint8Array(16)
    const calls = []
    const result = installModArchiveIntoWasm(
      {
        HEAPU8: heap,
        _malloc(size) {
          calls.push(['malloc', size])
          return 4
        },
        _free(pointer) {
          calls.push(['free', pointer])
        },
      },
      { name: 'mod.xsa', bytes: new Uint8Array([1, 2]) }
    )

    assert.deepEqual(result, { status: 'prepared', pointer: 4, name: 'mod.xsa', size: 2 })
    assert.deepEqual(Array.from(heap.slice(4, 6)), [1, 2])
    assert.deepEqual(calls, [['malloc', 2]])
  })
})

describe('Host.TouchPanel bridge', () => {
  it('round-trips setPosition() against the real GestureRecognizer centroid formula', () => {
    const bridge = createHostTouchPanelBridge()

    for (const position of [-100, -80, -63, -37, -1, 0, 1, 37, 63, 80, 100]) {
      bridge.setPosition(position)
      const recovered = getPosition(bridge.sample())
      assert.ok(Math.abs(recovered - position) <= 1, `position ${position} recovered as ${recovered}`)
    }
  })

  it('reads channels by index and treats out-of-range channels as untouched', () => {
    const bridge = createHostTouchPanelBridge()
    bridge.setPosition(0)

    assert.equal(bridge.read(1) > 0, true)
    assert.equal(bridge.read(-1), 0)
    assert.equal(bridge.read(99), 0)
    assert.equal(bridge.TouchPanel.read(99), 0)
  })

  it('scripts a forward swipe as touch, then a swipe past the threshold, then release', () => {
    const timers = createFakeTimers()
    const bridge = createHostTouchPanelBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.swipe('forward')
    const initialSample = bridge.sample()
    const initialPosition = getPosition(initialSample)
    assert.ok(initialSample.some((intensity) => intensity > 0), 'initial sample should be touched')
    assert.equal(bridge.isSwiping(), true)

    // Run enough interpolated steps to clear the firmware's 60-point swipeThreshold.
    for (const timer of timers.scheduled.slice(0, 4)) timer.callback()
    const movedSample = bridge.sample()
    assert.ok(Math.abs(getPosition(movedSample) - initialPosition) > 60)
    assert.ok(movedSample.some((intensity) => intensity > 0), 'mid-swipe sample should still be touched')

    for (const timer of timers.scheduled.slice(4)) timer.callback()
    assert.deepEqual(bridge.sample(), [0, 0, 0])
    assert.equal(bridge.isSwiping(), false)
  })

  it('scripts a backward swipe from the opposite end', () => {
    const timers = createFakeTimers()
    const bridge = createHostTouchPanelBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.swipe('backward')
    const initialPosition = getPosition(bridge.sample())
    assert.ok(initialPosition > 60)

    timers.runAll()
    assert.deepEqual(bridge.sample(), [0, 0, 0])
  })

  it('replaces an in-flight swipe when a new one starts', () => {
    const timers = createFakeTimers()
    const bridge = createHostTouchPanelBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.swipe('forward')
    const firstRoundTimerIds = timers.scheduled.map((timer) => timer.id)
    assert.ok(getPosition(bridge.sample()) < 0)

    bridge.swipe('backward')
    for (const id of firstRoundTimerIds) assert.ok(timers.cleared.has(id), `timer ${id} from the replaced swipe should be cleared`)
    assert.ok(getPosition(bridge.sample()) > 0, 'the new swipe should have re-pressed at the opposite end')
    assert.equal(bridge.isSwiping(), true)
  })

  it('cancel() clears pending timers and releases immediately', () => {
    const timers = createFakeTimers()
    const bridge = createHostTouchPanelBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.swipe('forward')
    bridge.cancel()

    assert.equal(bridge.isSwiping(), false)
    assert.deepEqual(bridge.sample(), [0, 0, 0])
    for (const timer of timers.scheduled) assert.ok(timers.cleared.has(timer.id))
  })
})

describe('Host.IMU bridge', () => {
  it('classifies each orientation vector the way MotionRecognizer.detectPosture would', () => {
    const bridge = createHostImuBridge()

    for (const name of Object.keys(IMU_ORIENTATIONS)) {
      bridge.setOrientation(name)
      const posture = detectPosture(bridge.sample().accelerometer)
      assert.equal(posture, name)
      assert.equal(bridge.orientation(), name)
    }
  })

  it('reads accelerometer and gyroscope axes 0..5 and treats out-of-range axes as zero', () => {
    const bridge = createHostImuBridge()
    bridge.setOrientation('upright')

    assert.equal(bridge.read(0), 0)
    assert.equal(bridge.read(1), 1)
    assert.equal(bridge.read(2), 0)
    assert.equal(bridge.read(3), 0)
    assert.equal(bridge.read(4), 0)
    assert.equal(bridge.read(5), 0)
    assert.equal(bridge.read(6), 0)
    assert.equal(bridge.IMU.read(6), 0)
  })

  it('scales orientation vectors by the configured gravity', () => {
    const bridge = createHostImuBridge({ gravity: 2 })
    bridge.setOrientation('fallenForward')

    assert.deepEqual(bridge.sample().accelerometer, { x: 0, y: 0, z: -2 })
  })

  it('produces 10 consecutive shaken samples that each differ in magnitude by at least 1.2g', () => {
    const timers = createFakeTimers()
    const bridge = createHostImuBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.shake()
    const magnitudeOf = (vector) => Math.sqrt(vector.x ** 2 + vector.y ** 2 + vector.z ** 2)
    let previous = magnitudeOf(bridge.sample().accelerometer)
    for (let sampleIndex = 0; sampleIndex < 10; sampleIndex += 1) {
      bridge.read(0) // axis 0 is always read first per the sample-boundary contract
      const magnitude = magnitudeOf(bridge.sample().accelerometer)
      assert.ok(Math.abs(magnitude - previous) >= 1.2, `sample ${sampleIndex} delta too small`)
      previous = magnitude
    }
  })

  it('advances the shake phase only on read(0), not on other axes', () => {
    const timers = createFakeTimers()
    const bridge = createHostImuBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.shake()
    const baseline = bridge.sample().accelerometer
    bridge.read(1)
    bridge.read(2)
    bridge.read(4)
    assert.deepEqual(bridge.sample().accelerometer, baseline, 'non-axis-0 reads must not advance the shake phase')

    bridge.read(0)
    assert.notDeepEqual(bridge.sample().accelerometer, baseline, 'axis-0 read must advance the shake phase')
  })

  it('stops shaking on its own after durationMs elapses', () => {
    const timers = createFakeTimers()
    const bridge = createHostImuBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.shake({ durationMs: 1500 })
    assert.equal(timers.scheduled[0].delay, 1500)
    bridge.read(0)
    assert.equal(bridge.isShaking(), true)

    timers.scheduled[0].callback()
    assert.equal(bridge.isShaking(), false)
    assert.deepEqual(bridge.sample().accelerometer, { x: 0, y: 1, z: 0 })
  })

  it('cancel() stops the shake immediately and restores the resting vector', () => {
    const timers = createFakeTimers()
    const bridge = createHostImuBridge({ setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn })

    bridge.setOrientation('fallenLeft')
    bridge.shake()
    bridge.read(0)
    bridge.read(0)

    bridge.cancel()
    assert.equal(bridge.isShaking(), false)
    assert.deepEqual(bridge.sample().accelerometer, { x: 1, y: 0, z: 0 })
  })

  it('setAccelerometer() sets an arbitrary vector directly and marks orientation as custom', () => {
    const bridge = createHostImuBridge()
    bridge.setAccelerometer({ x: 0.5, y: 0.5, z: 0 })

    assert.deepEqual(bridge.sample().accelerometer, { x: 0.5, y: 0.5, z: 0 })
    assert.equal(bridge.orientation(), 'custom')
  })
})
