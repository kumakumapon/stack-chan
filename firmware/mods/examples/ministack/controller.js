export const SERVICE = 'io.github.kumakumapon.ministack'
export const TYPES = [
  'capabilities.get',
  'state.get',
  'servo.diag',
  'events.ack',
  'events.since',
  'transfer.read',
  'transfer.release',
  'config.set',
  'head.set',
  'face.set',
  'reaction.play',
  'speech.say',
  'conversation.listen',
  'photo.capture',
  'stop',
]
/** Settings the PC may change, with the range each one is clamped to. */
export const CONFIG_KEYS = {
  speechVolume: { min: 0, max: 100 },
  longPressMs: { min: 300, max: 2000 },
  faceMotion: { boolean: true },
}
const FACE_COLOR_KEYS = ['primary', 'secondary']
const failure = (code) => {
  throw new Error(code)
}

// Platform-independent arbitration. The injected executor owns platform resources.
export function createController({
  execute,
  capabilities,
  now,
  sessionId,
  readDiagnostics,
  events,
  transfers,
  applyConfig,
}) {
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
    // A reply can be lost; the event carries the same outcome under an id the PC
    // deduplicates, so a finished command is never reported twice nor missed.
    events?.emit(ok ? 'command.finished' : 'command.rejected', {
      requestId: item.payload.requestId,
      type: item.type,
      ...(ok ? { result } : { code: result }),
    })
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
      transfers?.closeAll()
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
      if (type === 'state.get')
        return response(id, true, {
          running: running?.type ?? null,
          queued: queue.length,
          nextEventId: events?.nextEventId ?? null,
          pendingEvents: events?.pending.length ?? 0,
        })
      if (type === 'events.ack') {
        if (!events) return response(id, false, 'unsupported')
        return events.ack(payload.lastEventId)
          ? response(id, true, { lastEventId: payload.lastEventId })
          : response(id, false, 'invalid-ack')
      }
      if (type === 'events.since') {
        if (!events) return response(id, false, 'unsupported')
        const replay = events.since(payload.afterEventId)
        // A gap means an event is gone for good. Saying so is what stops the PC
        // reading "no completion yet" from a completion it will never receive.
        return replay.invalid
          ? response(id, false, 'invalid-event-cursor')
          : response(id, true, { events: replay.events, gap: replay.gap })
      }
      if (type === 'transfer.read') {
        if (!transfers) return response(id, false, 'unsupported')
        const chunk = transfers.read(payload.transferId, payload.offset, payload.length)
        return chunk.error ? response(id, false, chunk.error) : response(id, true, chunk)
      }
      if (type === 'transfer.release') {
        if (!transfers) return response(id, false, 'unsupported')
        return transfers.release(payload.transferId)
          ? response(id, true, { released: true })
          : response(id, false, 'unknown-transfer')
      }
      // Settings must not queue behind motion: they decide how the next motion
      // or speech behaves, so waiting for the queue would apply them too late.
      if (type === 'config.set') {
        if (typeof applyConfig !== 'function') return response(id, false, 'unsupported')
        const settings = {}
        for (const [key, value] of Object.entries(payload)) {
          if (['v', 'sessionId', 'requestId'].includes(key)) continue
          const spec = CONFIG_KEYS[key]
          if (!spec) return response(id, false, 'unknown-setting')
          if (spec.boolean) {
            if (typeof value !== 'boolean') return response(id, false, 'invalid-setting')
          } else if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
            return response(id, false, 'invalid-setting')
          }
          settings[key] = value
        }
        if (Object.keys(settings).length === 0) return response(id, false, 'invalid-setting')
        try {
          applyConfig(settings)
        } catch (error) {
          globalThis.trace?.(`[ministack] config failed: ${String(error)}\n`)
          return response(id, false, 'config-failed')
        }
        return response(id, true, { applied: settings })
      }
      // Diagnostics answer "was the command issued, acknowledged and executed?"
      // without reflashing, so they must stay readable while the queue is busy.
      if (type === 'servo.diag') {
        if (typeof readDiagnostics !== 'function') return response(id, false, 'unsupported')
        try {
          return response(id, true, await readDiagnostics())
        } catch (error) {
          globalThis.trace?.(`[ministack] diagnostics failed: ${String(error)}\n`)
          return response(id, false, 'diagnostics-failed')
        }
      }
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
              (payload.interrupt !== undefined && typeof payload.interrupt !== 'boolean'))
          )
            failure('invalid-speech')
          if (type === 'face.set') {
            const { emotion, color } = payload
            if (emotion === undefined && color === undefined) failure('invalid-face')
            if (emotion !== undefined && !capabilities.emotions.includes(emotion)) failure('invalid-face')
            if (color !== undefined) {
              const channels = [color?.r, color?.g, color?.b]
              if (
                !FACE_COLOR_KEYS.includes(color?.key) ||
                channels.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
              )
                failure('invalid-face')
            }
          }
          if (type === 'conversation.listen') {
            if (capabilities.listen !== true) failure('unsupported')
            if (!Number.isInteger(payload.timeoutMs) || payload.timeoutMs < 500 || payload.timeoutMs > 15000)
              failure('invalid-listen')
          }
          if (type === 'photo.capture' && capabilities.photo !== true) failure('unsupported')
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
/**
 * Collects one servo diagnostic snapshot.
 *
 * The measured rotation is read first so the servo counters that follow include
 * that read; "commanded" and "measured" together are what separates a command
 * that was accepted from one that actually moved the head. Driver diagnostics
 * reuse their object, so the snapshot is copied before it is handed back.
 */
export async function readServoDiagnostics(motion, commanded) {
  const measured = typeof motion?.getRotation === 'function' ? await motion.getRotation() : undefined
  const driver = typeof motion?.getDriverDiagnostics === 'function' ? motion.getDriverDiagnostics() : undefined
  return {
    commanded: commanded ?? null,
    measured: measured?.success === true ? { yawRad: measured.value.y, pitchRad: measured.value.p } : null,
    measuredError: measured?.success === false ? (measured.reason ?? 'unavailable') : null,
    servo: driver === undefined ? null : JSON.parse(JSON.stringify(driver)),
  }
}

export async function applyHeadPose(motion, pose, durationSeconds, cancelled) {
  if (cancelled()) throw new Error('cancelled')
  await motion.setTorque(true)
  if (cancelled()) throw new Error('cancelled')
  await motion.setPose(pose, durationSeconds)
}

/**
 * Event kinds the MOD may emit. Listing them keeps a typo from becoming a kind
 * the PC silently never matches.
 */
export const EVENT_KINDS = [
  'ready',
  'connection.changed',
  'error',
  'touch',
  'speech.started',
  'speech.finished',
  'listen.started',
  'listen.finished',
  'photo.ready',
  'command.finished',
  'command.rejected',
]

export const EVENT_BUFFER = 32
/** Raw bytes per transfer chunk; base64 of this still fits the 2 KiB envelope. */
export const TRANSFER_CHUNK_MAX = 1024

/**
 * Buffers events for a PC that is not guaranteed to be listening.
 *
 * The MOD delivers at least once and the PC deduplicates on `eventId`, which is
 * what makes "notify a finished job exactly once" hold across a dropped reply:
 * a redelivered event carries the id the PC already saw. Ids are monotonic
 * within a session and a restart changes the session, so the PC can drop an
 * older session's ids outright rather than reasoning about which are stale.
 *
 * When the buffer overflows, the oldest event is dropped rather than the newest
 * — the newest is the one a decision is waiting on. The drop is recorded, and
 * `since()` reports it as a gap so the PC resynchronises with `state.get`
 * instead of quietly missing a completion it will never see again.
 */
export function createEventOutbox({ now, capacity = EVENT_BUFFER }) {
  let nextId = 1
  let events = []
  // Highest id the PC confirmed, and highest id overflow threw away unconfirmed.
  // Keeping them apart is what tells a stale cursor from a lossy one: an acked
  // id behind the cursor is nothing to report, a dropped one is a gap.
  let ackedThrough = 0
  let droppedThrough = 0
  return {
    emit(kind, data = {}) {
      if (!EVENT_KINDS.includes(kind)) throw new Error(`unknown-event-kind:${kind}`)
      const event = { eventId: nextId++, occurredAt: now(), kind, data }
      events.push(event)
      while (events.length > capacity) droppedThrough = events.shift().eventId
      return event
    },
    /**
     * Forgets everything the PC has confirmed. An ack beyond what was ever
     * emitted is refused instead of advancing: honouring it would discard
     * events that are still the only record of a finished command.
     */
    ack(lastEventId) {
      if (!Number.isInteger(lastEventId) || lastEventId < 0 || lastEventId >= nextId) return false
      ackedThrough = Math.max(ackedThrough, lastEventId)
      events = events.filter((event) => event.eventId > lastEventId)
      return true
    },
    /** Replays what is still retained after `afterEventId`, and whether anything in between was lost. */
    since(afterEventId) {
      if (!Number.isInteger(afterEventId) || afterEventId < 0 || afterEventId >= nextId)
        return { events: [], gap: false, invalid: true }
      return {
        events: events.filter((event) => event.eventId > afterEventId),
        gap: afterEventId < droppedThrough,
        invalid: false,
      }
    },
    get pending() {
      return events.slice()
    },
    get nextEventId() {
      return nextId
    },
    get ackedThrough() {
      return ackedThrough
    },
  }
}

/**
 * Holds a captured photo or recording until the PC has read it out in chunks.
 *
 * Bytes this large never fit the 2 KiB Local Peer envelope, so the PC pulls
 * them a chunk at a time over the same authenticated channel rather than over a
 * second, unauthenticated one. Reads are idempotent by offset, so a lost reply
 * costs a re-read rather than the whole transfer.
 *
 * One entry per kind: a new capture releases the previous one. Camera frames own
 * hardware buffers, so releasing runs the frame's own `close()` — dropping the
 * reference instead would leak the buffer for the life of the session.
 */
export function createTransferRegistry({ now, encode, ttlMs = 60000 }) {
  const entries = new Map()
  let counter = 0
  const release = (transferId) => {
    const entry = entries.get(transferId)
    if (!entry) return false
    entries.delete(transferId)
    try {
      entry.close?.()
    } catch (error) {
      globalThis.trace?.(`[ministack] transfer close failed: ${String(error)}\n`)
    }
    return true
  }
  const sweep = () => {
    for (const [id, entry] of entries) if (now() >= entry.expires) release(id)
  }
  return {
    /** Registers bytes under a fresh one-shot id, replacing any previous transfer of the same kind. */
    offer(kind, bytes, meta = {}, close) {
      sweep()
      for (const [id, entry] of entries) if (entry.kind === kind) release(id)
      const transferId = `${kind}-${++counter}`
      entries.set(transferId, { kind, bytes, meta, close, expires: now() + ttlMs })
      return { transferId, byteLength: bytes.byteLength, ...meta }
    },
    read(transferId, offset, length) {
      sweep()
      const entry = entries.get(transferId)
      if (!entry) return { error: 'unknown-transfer' }
      if (!Number.isInteger(offset) || offset < 0 || offset > entry.bytes.byteLength) return { error: 'invalid-offset' }
      if (!Number.isInteger(length) || length <= 0 || length > TRANSFER_CHUNK_MAX) return { error: 'invalid-length' }
      const end = Math.min(offset + length, entry.bytes.byteLength)
      return {
        transferId,
        offset,
        byteLength: entry.bytes.byteLength,
        chunk: encode(entry.bytes.subarray(offset, end)),
        eof: end >= entry.bytes.byteLength,
      }
    },
    release,
    closeAll() {
      for (const id of [...entries.keys()]) release(id)
    },
    get size() {
      return entries.size
    },
  }
}
