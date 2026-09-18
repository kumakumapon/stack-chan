import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildStatusPayload,
  dispatchCommand,
  isPerformanceBridgeActive,
  type PerformanceBridgeContext,
  parseCommand,
  serializeStatus,
} from './performance-command.js'

function createContext(overrides: Partial<PerformanceBridgeContext> = {}): PerformanceBridgeContext {
  return {
    reaction: {
      names: ['yes', 'no', 'greeting'],
      play: () => ({ ok: true }),
      cancel: () => true,
      status: () => ({ active: null, startedAt: null }),
    },
    performance: {
      names: ['greeting', 'happy-dance'],
      play: () => ({ ok: true }),
      cancel: () => true,
      status: () => ({ active: null, startedAt: null, nextCue: 0 }),
    },
    ...overrides,
  } as PerformanceBridgeContext
}

// --- parseCommand ------------------------------------------------------------

test('parseCommand parses a well-formed play command', () => {
  const command = parseCommand(JSON.stringify({ target: 'reaction', action: 'play', name: 'yes' }))
  assert.deepEqual(command, { target: 'reaction', action: 'play', name: 'yes' })
})

test('parseCommand parses a well-formed cancel command with no name', () => {
  const command = parseCommand(JSON.stringify({ target: 'performance', action: 'cancel' }))
  assert.deepEqual(command, { target: 'performance', action: 'cancel' })
})

test('parseCommand keeps only recognized option fields and coerces nothing else', () => {
  const command = parseCommand(
    JSON.stringify({
      target: 'reaction',
      action: 'play',
      name: 'yes',
      options: { intensity: 0.5, restore: false, bogus: 'nope' },
    }),
  )
  assert.deepEqual(command, {
    target: 'reaction',
    action: 'play',
    name: 'yes',
    options: { intensity: 0.5, restore: false },
  })
})

test('parseCommand drops an options field that has the wrong types', () => {
  const command = parseCommand(
    JSON.stringify({ target: 'reaction', action: 'play', name: 'yes', options: { intensity: 'loud' } }),
  )
  assert.deepEqual(command, { target: 'reaction', action: 'play', name: 'yes', options: {} })
})

test('parseCommand returns undefined for invalid JSON', () => {
  assert.equal(parseCommand('{not json'), undefined)
})

test('parseCommand returns undefined for an empty string', () => {
  assert.equal(parseCommand(''), undefined)
})

test('parseCommand returns undefined for a non-object payload', () => {
  assert.equal(parseCommand(JSON.stringify('reaction')), undefined)
  assert.equal(parseCommand(JSON.stringify(null)), undefined)
  assert.equal(parseCommand(JSON.stringify(42)), undefined)
})

test('parseCommand returns undefined for an unknown target', () => {
  assert.equal(parseCommand(JSON.stringify({ target: 'motion', action: 'play', name: 'nod' })), undefined)
})

test('parseCommand returns undefined for an unknown action', () => {
  assert.equal(parseCommand(JSON.stringify({ target: 'reaction', action: 'stop' })), undefined)
})

test('parseCommand returns undefined when name is not a string', () => {
  assert.equal(parseCommand(JSON.stringify({ target: 'reaction', action: 'play', name: 7 })), undefined)
})

// --- dispatchCommand ---------------------------------------------------------

test('dispatchCommand plays a known reaction name with its options', () => {
  const calls: unknown[] = []
  const context = createContext({
    reaction: {
      names: ['yes', 'no'],
      play: (name, options) => {
        calls.push([name, options])
        return { ok: true }
      },
      cancel: () => false,
      status: () => ({ active: null, startedAt: null }),
    },
  })

  const result = dispatchCommand(
    { target: 'reaction', action: 'play', name: 'yes', options: { intensity: 0.5 } },
    context,
  )

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [['yes', { intensity: 0.5 }]])
})

test('dispatchCommand plays a known performance name', () => {
  const calls: unknown[] = []
  const context = createContext({
    performance: {
      names: ['greeting', 'happy-dance'],
      play: (name, options) => {
        calls.push([name, options])
        return { ok: true }
      },
      cancel: () => false,
      status: () => ({ active: null, startedAt: null, nextCue: 0 }),
    },
  })

  const result = dispatchCommand({ target: 'performance', action: 'play', name: 'happy-dance' }, context)

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(calls, [['happy-dance', undefined]])
})

test('dispatchCommand rejects a play whose name the capability does not own', () => {
  const context = createContext()
  const result = dispatchCommand({ target: 'reaction', action: 'play', name: 'unknown-reaction' }, context)
  assert.deepEqual(result, { ok: false, error: 'unknown reaction name: unknown-reaction' })
})

test('dispatchCommand rejects a play with no name', () => {
  const context = createContext()
  const result = dispatchCommand({ target: 'reaction', action: 'play' }, context)
  assert.deepEqual(result, { ok: false, error: 'play requires a name' })
})

test('dispatchCommand forwards a capability play() failure result unchanged', () => {
  const context = createContext({
    reaction: {
      names: ['yes'],
      play: () => ({ ok: false, error: 'stage busy' }),
      cancel: () => false,
      status: () => ({ active: null, startedAt: null }),
    },
  })

  const result = dispatchCommand({ target: 'reaction', action: 'play', name: 'yes' }, context)

  assert.deepEqual(result, { ok: false, error: 'stage busy' })
})

test('dispatchCommand cancels and reports whether anything was playing', () => {
  const context = createContext({
    performance: {
      names: ['greeting'],
      play: () => ({ ok: true }),
      cancel: () => true,
      status: () => ({ active: 'greeting', startedAt: 0, nextCue: 1 }),
    },
  })

  const result = dispatchCommand({ target: 'performance', action: 'cancel' }, context)

  assert.deepEqual(result, { ok: true, cancelled: true })
})

// --- buildStatusPayload / serializeStatus ------------------------------------

test('buildStatusPayload combines both capabilities current status', () => {
  const context = createContext({
    reaction: {
      names: [],
      play: () => ({ ok: true }),
      cancel: () => false,
      status: () => ({ active: 'yes', startedAt: 10 }),
    },
    performance: {
      names: [],
      play: () => ({ ok: true }),
      cancel: () => false,
      status: () => ({ active: null, startedAt: null, nextCue: 0 }),
    },
  })

  assert.deepEqual(buildStatusPayload(context), {
    reaction: { active: 'yes', startedAt: 10 },
    performance: { active: null, startedAt: null, nextCue: 0 },
  })
})

test('serializeStatus JSON-encodes the same payload buildStatusPayload returns', () => {
  const context = createContext()
  assert.equal(serializeStatus(context), JSON.stringify(buildStatusPayload(context)))
})

// --- isPerformanceBridgeActive ------------------------------------------------

test('isPerformanceBridgeActive is false when neither capability is active', () => {
  assert.equal(isPerformanceBridgeActive(createContext()), false)
})

test('isPerformanceBridgeActive is true while a reaction is active', () => {
  const context = createContext({
    reaction: {
      names: [],
      play: () => ({ ok: true }),
      cancel: () => false,
      status: () => ({ active: 'yes', startedAt: 0 }),
    },
  })
  assert.equal(isPerformanceBridgeActive(context), true)
})

test('isPerformanceBridgeActive is true while a performance is active', () => {
  const context = createContext({
    performance: {
      names: [],
      play: () => ({ ok: true }),
      cancel: () => false,
      status: () => ({ active: 'greeting', startedAt: 0, nextCue: 2 }),
    },
  })
  assert.equal(isPerformanceBridgeActive(context), true)
})
