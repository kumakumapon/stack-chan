/** Browser transport only. Session state, tools and playback remain in the WASM firmware. */
export function createConversationBridge({ WebSocketClass = globalThis.WebSocket } = {}) {
  let config = {
    backend: 'none',
    endpoint: '',
    deviceId: 'simulator',
    clientId: 'browser',
    token: '',
    microphone: false,
  }
  let socket,
    socketId = 0,
    events = [],
    controls = [],
    pcm = []
  let status = { state: 'standby', transport: 'disconnected', activation: 'inactive' }
  let capture,
    captureGeneration = 0,
    captureError
  const stopMic = () => {
    captureGeneration++
    if (capture) {
      capture.stream.getTracks().forEach((track) => track.stop())
      capture.processor.disconnect()
      capture.source.disconnect()
      capture.gain.disconnect()
      void capture.context.close()
      capture = undefined
    }
    pcm = []
  }
  const startMic = async () => {
    if (capture || !config.microphone) return
    const generation = ++captureGeneration
    let pendingStream, pendingContext
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
        video: false,
      })
      pendingStream = stream
      if (generation !== captureGeneration) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      const context = new AudioContext({ sampleRate: 16000 })
      pendingContext = context
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(1024, 1, 1)
      const gain = context.createGain()
      gain.gain.value = 0
      capture = { stream, context, source, processor, gain }
      let position = 0,
        frame = [],
        phase = 0
      processor.onaudioprocess = (event) => {
        if (generation !== captureGeneration) return
        const samples = event.inputBuffer.getChannelData(0)
        for (const sample of samples) {
          phase += 16000
          if (phase < context.sampleRate) continue
          phase -= context.sampleRate
          const value = Math.round(Math.max(-1, Math.min(1, sample)) * 32767)
          frame[position++] = value & 255
          frame[position++] = (value >> 8) & 255
          if (position === 640) {
            if (pcm.length >= 20) {
              captureError = 'Microphone queue overflow'
              stopMic()
              return
            }
            pcm.push(btoa(String.fromCharCode(...frame)))
            frame = []
            position = 0
          }
        }
      }
      source.connect(processor)
      processor.connect(gain)
      gain.connect(context.destination)
      await context.resume()
    } catch (error) {
      if (!capture) {
        pendingStream?.getTracks().forEach((track) => track.stop())
        if (pendingContext) void pendingContext.close()
      }
      if (generation === captureGeneration) {
        captureError = String(error)
        stopMic()
      }
    }
  }
  const closeSocket = () => {
    socketId++
    socket?.close()
    socket = undefined
    events = []
    stopMic()
  }
  return {
    configure(next) {
      if (next.endpoint) {
        const url = new URL(next.endpoint)
        if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
          throw new Error('Use a ws:// or wss:// Gateway URL without credentials, query or fragment')
      }
      closeSocket()
      controls = []
      config = { ...config, ...next, backend: next.endpoint ? 'gateway' : 'none' }
    },
    command(command) {
      if (controls.length < 16) controls.push(command)
    },
    get status() {
      return { ...status }
    },
    close: closeSocket,
    exchange(request) {
      switch (request.action) {
        case 'config':
          return config
        case 'open': {
          closeSocket()
          const id = socketId
          const host = request.host.includes(':') ? '[' + request.host + ']' : request.host
          socket = new WebSocketClass((request.secure ? 'wss://' : 'ws://') + host + ':' + request.port + request.path)
          socket.onopen = () => {
            if (id === socketId) events.push({ type: 'ready' })
          }
          socket.onmessage = (event) => {
            if (id !== socketId || typeof event.data !== 'string') return
            if (events.length >= 64 || event.data.length > 262144) {
              closeSocket()
              events.push({ type: 'closed', reason: 'Gateway input overflow' })
              return
            }
            events.push({ type: 'message', data: event.data })
          }
          socket.onclose = () => {
            if (id === socketId) {
              stopMic()
              events.push({ type: 'closed' })
            }
          }
          socket.onerror = () => {
            if (id === socketId) events.push({ type: 'closed', reason: 'Gateway connection failed' })
          }
          return null
        }
        case 'write':
          if (socket?.readyState !== 1) throw new Error('Gateway disconnected')
          if (socket.bufferedAmount > 32768) throw new Error('Gateway output overflow')
          socket.send(request.data)
          return null
        case 'close':
          closeSocket()
          return null
        case 'socket':
          return events.shift() ?? null
        case 'control':
          return controls.shift() ?? null
        case 'status':
          status = request.status
          return null
        case 'mic-start':
          captureError = undefined
          void startMic()
          return null
        case 'mic-stop':
          stopMic()
          return null
        case 'mic': {
          const error = captureError
          captureError = undefined
          return error ? { error } : { payload: pcm.shift() }
        }
        default:
          throw new Error('Unknown conversation bridge action')
      }
    },
  }
}
