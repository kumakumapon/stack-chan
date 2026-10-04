import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DeviceCredential } from '../config.ts'

export const MESSAGE_PRESETS = { thanks: 'ありがとう', rest: 'おつかれさま', hello: 'こんにちは' } as const
type Preset = keyof typeof MESSAGE_PRESETS
type Entry = {
  id: string
  kind: 'build' | 'message'
  text: string
  sender: string
  expiresAt: number
  read: boolean
  reply?: 'thanks'
  deleted?: boolean
}
type Device = {
  entries: Entry[]
  seen: Map<string, number>
  lastPoll: number
  pair?: { code: string; expiresAt: number; attempts: number }
  senders: Map<string, string>
}
type Options = { devices: DeviceCredential[]; sharedToken?: string; now?: () => number; random?: () => string }
const idPattern = /^[a-zA-Z0-9_-]{1,64}$/

/** Isolated from conversation sessions: polling never starts an Agent or a microphone. */
export function createInbox(options: Options) {
  const now = options.now ?? Date.now
  const random = options.random ?? (() => randomBytes(24).toString('hex'))
  const states = new Map<string, Device>()
  const credentials = new Map(options.devices.map((item) => [item.deviceId, item.token ?? options.sharedToken]))
  const equal = (a: unknown, b: string | undefined) =>
    typeof a === 'string' &&
    !!b &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  const state = (id: string): Device => {
    if (!idPattern.test(id) || !credentials.get(id)) throw new Error('unauthorized')
    let value = states.get(id)
    if (!value) {
      if (states.size >= 32) throw new Error('capacity')
      value = { entries: [], seen: new Map(), lastPoll: 0, senders: new Map() }
      states.set(id, value)
    }
    const time = now()
    value.entries = value.entries.filter((entry) => entry.expiresAt > time)
    for (const [id, expiry] of value.seen) if (expiry <= time) value.seen.delete(id)
    return value
  }
  const authenticate = (id: string, token: unknown) => {
    if (!equal(token, credentials.get(id))) throw new Error('unauthorized')
    return state(id)
  }
  const add = (device: Device, entry: Entry) => {
    if (device.seen.has(entry.id)) return false
    if (device.entries.length >= 16 || device.seen.size >= 128) throw new Error('capacity')
    device.entries.push(entry)
    // Tombstones outlive messages, including user deletion, to reject retries.
    device.seen.set(entry.id, now() + 86400000)
    return true
  }
  return {
    device(id: string, token: unknown, action: string, input: Record<string, unknown> = {}) {
      const device = authenticate(id, token)
      if (action === 'poll') {
        device.lastPoll = now()
        return {
          entries: device.entries
            .filter((entry) => !entry.deleted)
            .map((entry) => ({ ...entry, remainingMs: entry.expiresAt - now() })),
        }
      }
      if (action === 'pair') {
        const code = random().slice(0, 12)
        device.pair = { code, expiresAt: now() + 120000, attempts: 0 }
        return { code, expiresIn: 120 }
      }
      if (action === 'revoke') {
        device.senders.clear()
        device.pair = undefined
        return { ok: true }
      }
      const entry = device.entries.find((entry) => entry.id === input.id && !entry.deleted)
      if (!entry) throw new Error('not-found')
      if (action === 'read') entry.read = true
      else if (action === 'reply' && entry.kind === 'message') {
        entry.read = true
        entry.reply = 'thanks'
      } else if (action === 'delete') {
        entry.text = ''
        entry.deleted = true
      } else throw new Error('invalid')
      return { ok: true }
    },
    claim(id: string, code: unknown, name: unknown) {
      const device = state(id)
      const pair = device.pair
      if (!pair || pair.expiresAt <= now() || pair.attempts++ >= 5 || !equal(code, pair.code))
        throw new Error('unauthorized')
      if (typeof name !== 'string' || name.trim().length === 0 || name.length > 24) throw new Error('invalid')
      if (device.senders.size >= 8) throw new Error('capacity')
      device.pair = undefined
      const token = random()
      device.senders.set(token, name.trim())
      return { token }
    },
    send(id: string, token: unknown, eventId: unknown, preset: unknown) {
      const device = state(id)
      const sender = typeof token === 'string' ? device.senders.get(token) : undefined
      if (!sender || typeof token !== 'string') throw new Error('unauthorized')
      if (
        typeof eventId !== 'string' ||
        !idPattern.test(eventId) ||
        typeof preset !== 'string' ||
        !Object.hasOwn(MESSAGE_PRESETS, preset)
      )
        throw new Error('invalid')
      // Include the sender identity so one phone cannot reserve another phone's IDs.
      const idKey = `${token.slice(0, 12)}:${eventId}`
      const accepted = add(device, {
        id: idKey,
        kind: 'message',
        text: MESSAGE_PRESETS[preset as Preset],
        sender,
        expiresAt: now() + 3600000,
        read: false,
      })
      return { accepted, id: idKey }
    },
    build(id: string, token: unknown, eventId: unknown) {
      const device = authenticate(id, token)
      if (typeof eventId !== 'string' || !idPattern.test(eventId)) throw new Error('invalid')
      return {
        accepted: add(device, {
          id: `build:${eventId}`,
          kind: 'build',
          text: 'Build succeeded',
          sender: 'Build',
          expiresAt: now() + 600000,
          read: false,
        }),
      }
    },
    status(id: string, token: unknown) {
      const device = state(id)
      if (typeof token !== 'string' || !device.senders.has(token)) throw new Error('unauthorized')
      return {
        connected: device.lastPoll > 0 && now() - device.lastPoll < 20000,
        entries: device.entries
          .filter((entry) => entry.id.startsWith(`${token.slice(0, 12)}:`))
          .map(({ id, read, reply, deleted }) => ({ id, read, reply, deleted })),
      }
    },
  }
}

export type Inbox = ReturnType<typeof createInbox>

export async function handleInbox(
  request: IncomingMessage,
  response: ServerResponse,
  inbox: Inbox,
  allowedOrigins: readonly string[] = [],
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://gateway.local')
  if (!url.pathname.startsWith('/api/inbox/')) return false
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  // The phone page is served by this Gateway. No wildcard CORS or cookie authentication.
  if (request.headers.origin) {
    let origin: URL
    try {
      origin = new URL(request.headers.origin)
    } catch {
      response.writeHead(403).end('{}')
      return true
    }
    if (origin.host !== request.headers.host && !allowedOrigins.includes(origin.origin)) {
      response.writeHead(403).end('{}')
      return true
    }
    response.setHeader('Access-Control-Allow-Origin', origin.origin)
    response.setHeader('Vary', 'Origin')
  }
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'POST')
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.writeHead(204).end()
    return true
  }
  try {
    if (request.method !== 'POST') {
      response.writeHead(405).end('{}')
      return true
    }
    const chunks: Buffer[] = []
    let bytes = 0
    for await (const chunk of request) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 4096) {
        response.writeHead(413).end('{}')
        return true
      }
      chunks.push(Buffer.from(chunk))
    }
    const input: Record<string, unknown> = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.deviceId !== 'string')
      throw new Error('invalid')
    const token = request.headers.authorization?.replace(/^Bearer /, '')
    const action = url.pathname.slice('/api/inbox/'.length)
    let result: unknown
    if (action === 'claim') result = inbox.claim(input.deviceId, input.code, input.name)
    else if (action === 'send') result = inbox.send(input.deviceId, token, input.id, input.preset)
    else if (action === 'status') result = inbox.status(input.deviceId, token)
    else if (action === 'build') result = inbox.build(input.deviceId, token, input.id)
    else result = inbox.device(input.deviceId, token, action, input)
    response.end(JSON.stringify(result))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid'
    const status = message === 'unauthorized' ? 401 : message === 'capacity' ? 429 : message === 'not-found' ? 404 : 400
    response.writeHead(status).end(JSON.stringify({ error: status === 400 ? 'invalid request' : message }))
  }
  return true
}
