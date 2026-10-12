import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { AgentEvent } from '../agent/agent-backend.ts'
import { createStackchanToolSchemas } from '../tools/stackchan-tools.ts'
import { createDesktopBackend } from './backend.ts'
import type { ModelRequest } from './model.ts'
import { parseReply, replyTools } from './reply.ts'
import { openDesktopStore } from './store.ts'

const reply = JSON.stringify({ text: 'こんにちは。', emotion: 'happy', gesture: 'yes', gaze: 'front' })

test('one active conversation uses changed provider and shared history on the next turn', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-backend-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await openDesktopStore(directory)
  const requests: ModelRequest[] = []
  const events: AgentEvent[] = []
  const backend = createDesktopBackend(store, async (request) => {
    requests.push(request)
    return reply
  })
  const session = await backend.createSession({
    deviceId: 'stackchan-01',
    tools: [],
    inputSampleRate: 16000,
    onEvent: (event) => events.push(event),
  })
  await session.inputText('はじめまして')
  const settings = store.settings()
  settings.provider = 'claude'
  settings.name = 'まめ'
  await store.update(settings)
  await session.inputText('さっきの話を覚えてる？')
  assert.equal(requests[1]?.settings.provider, 'claude')
  assert.equal(requests[1]?.settings.name, 'まめ')
  assert.equal(requests[1]?.history[0]?.user, 'はじめまして')
  assert.equal(events.filter((event) => event.type === 'text').length, 2)
  assert.equal(store.history('stackchan-01').length, 2)
  await session.close()
})

test('cancelled late model output cannot speak, move, or write memory into the replacement turn', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-cancel-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await openDesktopStore(directory)
  let resolveOld!: (reply: string) => void
  let count = 0
  const events: AgentEvent[] = []
  const backend = createDesktopBackend(store, async () =>
    ++count === 1
      ? new Promise<string>((resolve) => {
          resolveOld = resolve
        })
      : reply,
  )
  const session = await backend.createSession({
    deviceId: 'stackchan-01',
    tools: [],
    inputSampleRate: 16000,
    onEvent: (event) => events.push(event),
  })
  const old = session.inputText('古い質問')
  await session.cancel()
  await session.inputText('新しい質問')
  resolveOld(reply)
  await old
  assert.equal(events.filter((event) => event.type === 'text').length, 1)
  assert.deepEqual(
    store.history('stackchan-01').map((turn) => turn.user),
    ['新しい質問'],
  )
  await session.close()
})

test('validated replies invoke only advertised bounded body tools and await their results', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-tools-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await openDesktopStore(directory)
  const events: AgentEvent[] = []
  const backend = createDesktopBackend(store, async () => reply)
  const session = await backend.createSession({
    deviceId: 'stackchan-01',
    tools: createStackchanToolSchemas(),
    inputSampleRate: 16000,
    onEvent(event) {
      events.push(event)
      if (event.type === 'tool.call') queueMicrotask(() => void session.toolResult(event.callId, { ok: true }))
    },
  })
  await session.inputText('こんにちは')
  assert.deepEqual(
    events.filter((event) => event.type === 'tool.call').map((event) => event.name),
    ['stackchan.face.setEmotion', 'stackchan.motion.lookAt', 'stackchan.react'],
  )
  assert.equal(events.at(-2)?.type, 'text')
  assert.deepEqual(replyTools(parseReply(reply), []), [])
  assert.throws(() => parseReply('{"text":"はい","emotion":"happy","gesture":"shell","gaze":"front"}'))
  await session.close()
})

test('malformed responses report a recoverable error without history or body actions', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'stackchan-invalid-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = await openDesktopStore(directory)
  const events: AgentEvent[] = []
  const session = await createDesktopBackend(store, async () => 'これはJSONではありません').createSession({
    deviceId: 'stackchan-01',
    tools: createStackchanToolSchemas(),
    inputSampleRate: 16000,
    onEvent: (event) => events.push(event),
  })
  await session.inputText('こんにちは')
  assert.deepEqual(
    events.map((event) => event.type),
    ['error', 'turn.done'],
  )
  assert.deepEqual(store.history('stackchan-01'), [])
  await session.close()
})
