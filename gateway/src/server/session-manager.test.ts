import assert from 'node:assert/strict'
import test from 'node:test'
import { createEchoBackend } from '../agent/echo-backend.ts'
import { createNullStt } from '../audio/stt.ts'
import { createNullTts } from '../audio/tts.ts'
import type { DeviceSession, DeviceSessionOptions } from './device-session.ts'
import { createSessionManager } from './session-manager.ts'

function fakeSession(deviceId: string | undefined, closed: string[]): DeviceSession {
  let seen = false
  return {
    get deviceId() {
      return seen ? deviceId : undefined
    },
    sessionId: deviceId,
    get ready() {
      return seen
    },
    async handleFrame() {
      seen = true
    },
    async close() {
      closed.push(deviceId ?? 'anonymous')
    },
  }
}

function manager(createSession: (options: DeviceSessionOptions) => DeviceSession) {
  return createSessionManager({
    backend: createEchoBackend(),
    stt: createNullStt(),
    tts: createNullTts(),
    authenticate: () => true,
    logger: () => {},
    createSession,
  })
}

const transport = { send: () => {}, close: () => {} }

test('a reconnect evicts the previous session of the same device', async () => {
  const closed: string[] = []
  const sessions = manager(() => fakeSession('stackchan-01', closed))
  const first = sessions.accept(transport)
  await first.handleFrame('hello')
  assert.equal(sessions.size, 1)

  const second = sessions.accept(transport)
  await second.handleFrame('hello')
  assert.deepEqual(closed, ['stackchan-01'], 'the stale session was not closed')
  assert.equal(sessions.get('stackchan-01'), second.session)
  assert.equal(sessions.size, 1)
  await sessions.close()
})

test('release is idempotent and deregisters the device', async () => {
  const closed: string[] = []
  const sessions = manager(() => fakeSession('stackchan-01', closed))
  const managed = sessions.accept(transport)
  await managed.handleFrame('hello')
  await managed.release()
  await managed.release()
  assert.deepEqual(closed, ['stackchan-01'])
  assert.equal(sessions.get('stackchan-01'), undefined)
  assert.equal(sessions.size, 0)
  await sessions.close()
})

test('close releases every live session, including ones that never handshook', async () => {
  const closed: string[] = []
  const sessions = manager(() => fakeSession(undefined, closed))
  sessions.accept(transport)
  sessions.accept(transport)
  assert.equal(sessions.size, 2)
  await sessions.close()
  assert.equal(closed.length, 2)
  assert.equal(sessions.size, 0)
  assert.throws(() => sessions.accept(transport), /closed/)
})
