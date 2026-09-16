/**
 * Registry of live device sessions.
 *
 * One Stack-chan gets one session: a reconnect after an unclean disconnect must
 * evict the stale session, otherwise the old Agent session keeps its tools
 * registered and answers into a dead socket.
 */

import {
  createDeviceSession,
  type DeviceSession,
  type DeviceSessionOptions,
  type DeviceTransport,
} from './device-session.ts'

export type SessionManagerOptions = Omit<DeviceSessionOptions, 'transport'> & {
  createSession?(options: DeviceSessionOptions): DeviceSession
}

export type ManagedSession = {
  readonly session: DeviceSession
  handleFrame(payload: string): Promise<void>
  /** Call when the transport closes. Idempotent. */
  release(): Promise<void>
}

export type SessionManager = {
  readonly size: number
  accept(transport: DeviceTransport): ManagedSession
  get(deviceId: string): DeviceSession | undefined
  close(): Promise<void>
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const { createSession = createDeviceSession, ...sessionOptions } = options
  const logger = options.logger ?? (() => {})
  const live = new Set<ManagedSession>()
  const byDevice = new Map<string, ManagedSession>()
  let closed = false

  const evict = (managed: ManagedSession) => {
    live.delete(managed)
    const deviceId = managed.session.deviceId
    if (deviceId && byDevice.get(deviceId) === managed) byDevice.delete(deviceId)
  }

  return {
    get size() {
      return live.size
    },
    accept(transport) {
      if (closed) throw new Error('the session manager is closed')
      const session = createSession({ ...sessionOptions, transport })
      let released = false
      const managed: ManagedSession = {
        session,
        async handleFrame(payload) {
          await session.handleFrame(payload)
          const deviceId = session.deviceId
          if (!deviceId || byDevice.get(deviceId) === managed) return
          const previous = byDevice.get(deviceId)
          byDevice.set(deviceId, managed)
          if (previous && previous !== managed) {
            logger(`[gateway] replacing the previous session of ${deviceId}`)
            await previous.release()
          }
        },
        async release() {
          if (released) return
          released = true
          evict(managed)
          await session.close()
        },
      }
      live.add(managed)
      return managed
    },
    get(deviceId) {
      return byDevice.get(deviceId)?.session
    },
    async close() {
      if (closed) return
      closed = true
      const pending = [...live].map((managed) => managed.release())
      await Promise.all(pending)
      live.clear()
      byDevice.clear()
    },
  }
}
