export const SERVICE = 'io.github.kumakumapon.ministack'
export const TYPES = ['capabilities.get', 'state.get', 'head.set', 'face.set', 'reaction.play', 'speech.say', 'stop']
const failure = (code) => {
  throw new Error(code)
}

// Platform-independent arbitration. The injected executor owns platform resources.
export function createController({ execute, capabilities, now, sessionId }) {
  const records = new Map()
  let queue = []
  let running
  let closed = false
  let generation = 0
  const response = (requestId, ok, value) => ({
    v: 1,
    sessionId,
    requestId,
    ok,
    ...(ok ? { result: value } : { error: { code: value } }),
  })
  const finish = (item, ok, result) => {
    if (item.done) return
    item.done = true
    item.resolve(response(item.payload.requestId, ok, result))
  }
  async function drain() {
    if (running || closed) return
    const item = queue.shift()
    if (!item) return
    running = item
    const revision = generation
    try {
      if (now() >= item.expires) failure('expired')
      const result = await execute(
        item.type,
        item.payload,
        () => closed || revision !== generation || now() >= item.expires,
      )
      if (revision !== generation || closed) failure('cancelled')
      finish(item, true, result ?? {})
    } catch (error) {
      finish(
        item,
        false,
        error.message === 'expired' || error.message === 'cancelled'
          ? error.message
          : error.protocol === 'scservo' && Number.isFinite(error.timeoutMs)
            ? 'servo-timeout'
            : 'execution-failed',
      )
    } finally {
      running = undefined
      void drain()
    }
  }
  function cancel() {
    generation++
    for (const item of queue) finish(item, false, 'cancelled')
    queue = []
    if (running) finish(running, false, 'cancelled')
  }
  return {
    close() {
      closed = true
      cancel()
    },
    async receive(type, payload) {
      const id = payload?.requestId
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return response('', false, 'invalid-request-id')
      if (closed) return response(id, false, 'closed')
      if (payload.v !== 1) return response(id, false, 'unsupported-version')
      if (type !== 'capabilities.get' && payload.sessionId !== sessionId) return response(id, false, 'stale-session')
      const fingerprint = JSON.stringify({ type, payload })
      const previous = records.get(id)
      if (previous)
        return previous.fingerprint === fingerprint ? previous.promise : response(id, false, 'request-id-conflict')
      // Read-only snapshots do not consume the bounded action replay history.
      // Repeated reads return current state; an existing action ID still conflicts above.
      if (type === 'capabilities.get') return response(id, true, capabilities)
      if (type === 'state.get') return response(id, true, { running: running?.type ?? null, queued: queue.length })
      // Do not evict IDs and accidentally execute an old request again.
      if (records.size >= 256 && type !== 'stop') return response(id, false, 'session-full')
      let resolve
      const promise = new Promise((done) => {
        resolve = done
      })
      const item = { type, payload, resolve, promise, fingerprint, done: false }
      if (records.size < 256) records.set(id, item)
      try {
        if (!TYPES.includes(type)) failure('unsupported')
        if (type === 'stop') {
          if (payload.scope !== 'queue' && payload.scope !== 'all') failure('invalid-scope')
          cancel()
          finish(item, true, { queueCleared: true, activeOperationMayFinish: true, physicalImmediateStop: false })
        } else {
          if (!Number.isInteger(payload.ttlMs) || payload.ttlMs < 100 || payload.ttlMs > 10000) failure('invalid-ttl')
          if (!Number.isInteger(payload.priority) || payload.priority < 0 || payload.priority > 3)
            failure('invalid-priority')
          if (queue.length >= 8) failure('queue-full')
          if (
            type === 'head.set' &&
            (!Number.isFinite(payload.yawRad) ||
              !Number.isFinite(payload.pitchRad) ||
              !Number.isInteger(payload.durationMs) ||
              payload.durationMs < 500 ||
              payload.durationMs > 3000)
          )
            failure('invalid-head')
          if (
            type === 'speech.say' &&
            (typeof payload.text !== 'string' ||
              !payload.text.trim() ||
              payload.text.length > 200 ||
              payload.interrupt === true)
          )
            failure('invalid-speech')
          if (type === 'face.set' && (!capabilities.emotions.includes(payload.emotion) || payload.color !== undefined))
            failure('invalid-face')
          if (type === 'reaction.play' && !['happy', 'neutral', 'nod'].includes(payload.name))
            failure('invalid-reaction')
          item.expires = now() + payload.ttlMs
          queue.push(item)
          queue.sort((a, b) => b.payload.priority - a.payload.priority)
          void drain()
        }
      } catch (error) {
        finish(item, false, error.message)
      }
      return promise
    },
  }
}

// Initial capability transfer has a separate, bounded deadline. Once the PC
// proves it has the boot session ID, enforce the normal inactivity timeout.
export function createHeartbeatWatchdog(now) {
  let started
  let lastSeen
  let established = false
  return {
    received(validSession) {
      const time = now()
      if (started === undefined) started = time
      if (validSession) {
        established = true
        lastSeen = time
      }
    },
    expired() {
      if (started === undefined) return false
      return established ? now() - lastSeen >= 3000 : now() - started >= 12000
    },
  }
}
export async function applyHeadPose(motion, pose, durationSeconds, cancelled) {
  if (cancelled()) throw new Error('cancelled')
  await motion.setTorque(true)
  if (cancelled()) throw new Error('cancelled')
  await motion.setPose(pose, durationSeconds)
}
