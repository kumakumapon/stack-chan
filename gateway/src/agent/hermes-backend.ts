/**
 * Generic HTTP+NDJSON Agent backend, for Hermes-style or other custom agent
 * servers that don't speak the OpenAI wire format.
 *
 * Expected backend contract (implement this against your own agent server):
 *
 *   Open a session
 *     POST {endpoint}/sessions
 *       body: { deviceId: string, instructions?: string, tools: ToolDefinition[], agent?: string }
 *       response: { id: string }
 *
 *   Send a turn
 *     POST {endpoint}/sessions/{id}/messages
 *       body: { type: 'text', text: string } | { type: 'tool_result', callId: string, result: unknown }
 *       response: a streamed body of newline-delimited JSON, one frame per line:
 *         { type: 'text', text: string, final?: boolean }
 *         { type: 'transcript', direction: 'input' | 'output', text: string, final?: boolean }
 *         { type: 'tool_call', callId: string, name: string, arguments?: Record<string, unknown> }
 *         { type: 'error', code?: GatewayErrorCode, message: string, fatal?: boolean }
 *         { type: 'done' }
 *       The stream may end (EOF) right after a `tool_call` frame instead of
 *       sending `done` -- that means the backend is waiting on `tool_result`.
 *       Any frame after `done` is ignored.
 *
 *   Close a session
 *     DELETE {endpoint}/sessions/{id}
 *
 * `producesAudio` is false: this backend is text-in/text-out, so the Gateway
 * runs STT/TTS around it, same as the OpenAI backend.
 */

import type { GatewayErrorCode } from '../protocol/stackchan-gateway-v1.ts'
import type { AgentBackend, AgentEvent, AgentSession, AgentSessionOptions } from './agent-backend.ts'

const VALID_ERROR_CODES: readonly GatewayErrorCode[] = [
  'unauthorized',
  'unsupportedProtocol',
  'unsupportedAudioFormat',
  'agentUnavailable',
  'sttFailure',
  'ttsFailure',
  'toolFailure',
  'internal',
]

export function createHermesBackend(options: {
  endpoint: string
  token?: string
  agent?: string
  fetchImpl?: typeof fetch
}): AgentBackend {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint.replace(/\/+$/, '')

  const headers = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (options.token) h.Authorization = `Bearer ${options.token}`
    return h
  }

  return {
    name: 'hermes',
    producesAudio: false,
    async createSession(sessionOptions: AgentSessionOptions): Promise<AgentSession> {
      const { onEvent, tools, deviceId, instructions, signal } = sessionOptions
      let sessionId: string | undefined
      let controller = new AbortController()
      let closed = false
      const pendingCallIds = new Set<string>()

      const fail = (message: string): void => {
        onEvent({ type: 'error', code: 'agentUnavailable', message, fatal: false })
        onEvent({ type: 'turn.done' })
      }

      const ensureSession = async (turn: AbortController): Promise<string | undefined> => {
        if (sessionId) return sessionId
        let response: Response
        try {
          response = await fetchImpl(`${endpoint}/sessions`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ deviceId, instructions, tools, agent: options.agent }),
            signal: signal ? AbortSignal.any([signal, turn.signal]) : turn.signal,
          })
        } catch (cause) {
          if (turn.signal.aborted) return undefined
          fail(`hermes backend: open request failed: ${describeError(cause)}`)
          return undefined
        }
        if (!response.ok) {
          const detail = await safeText(response)
          if (turn !== controller || turn.signal.aborted) return undefined
          fail(`hermes backend: open failed: ${response.status} ${response.statusText}: ${detail}`)
          return undefined
        }
        const body = (await response.json()) as { id?: unknown }
        if (turn !== controller || turn.signal.aborted) return undefined
        if (typeof body.id !== 'string' || body.id.length === 0) {
          fail('hermes backend: open response missing "id"')
          return undefined
        }
        sessionId = body.id
        return sessionId
      }

      const consume = async (response: Response, turn: AbortController): Promise<void> => {
        if (!response.body) return fail('hermes backend: response has no body')
        for await (const frame of readNdjsonFrames(response.body)) {
          if (closed || turn.signal.aborted || turn !== controller) return
          const event = translateFrame(frame)
          if (!event) continue
          if (event.type === 'tool.call') pendingCallIds.add(event.callId)
          if (event.type === 'turn.done') pendingCallIds.clear()
          onEvent(event)
          if (event.type === 'turn.done') return
        }
      }

      const send = async (body: Record<string, unknown>): Promise<void> => {
        const turn = controller
        if (closed || turn.signal.aborted) return
        const id = await ensureSession(turn)
        if (!id || closed || turn !== controller || turn.signal.aborted) return
        let response: Response
        try {
          response = await fetchImpl(`${endpoint}/sessions/${id}/messages`, {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify(body),
            signal: signal ? AbortSignal.any([signal, turn.signal]) : turn.signal,
          })
        } catch (cause) {
          if (turn.signal.aborted) return
          fail(`hermes backend: request failed: ${describeError(cause)}`)
          return
        }
        if (turn.signal.aborted || turn !== controller) return
        if (!response.ok) {
          const detail = await safeText(response)
          if (turn !== controller || turn.signal.aborted) return
          fail(`hermes backend: ${response.status} ${response.statusText}: ${detail}`)
          return
        }
        try {
          await consume(response, turn)
        } catch (cause) {
          if (!turn.signal.aborted && turn === controller) fail(`hermes stream failed: ${describeError(cause)}`)
        }
      }

      return {
        async inputText(text: string): Promise<void> {
          await send({ type: 'text', text })
        },
        // Text-only backend; the Gateway runs STT/TTS around it.
        async inputAudio(): Promise<void> {},
        async toolResult(callId: string, result: unknown): Promise<void> {
          if (!pendingCallIds.has(callId)) return
          pendingCallIds.delete(callId)
          await send({ type: 'tool_result', callId, result: result ?? null })
        },
        async cancel(): Promise<void> {
          controller.abort()
          controller = new AbortController()
          pendingCallIds.clear()
        },
        async close(): Promise<void> {
          closed = true
          controller.abort()
          pendingCallIds.clear()
          if (!sessionId) return
          try {
            await fetchImpl(`${endpoint}/sessions/${sessionId}`, { method: 'DELETE', headers: headers() })
          } catch {
            // Best-effort cleanup; the session server will eventually reap it.
          }
        },
      }
    },
  }
}

function translateFrame(raw: unknown): AgentEvent | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const frame = raw as Record<string, unknown>
  switch (frame.type) {
    case 'text':
      if (typeof frame.text !== 'string') return undefined
      return { type: 'text', text: frame.text, final: frame.final !== false }
    case 'transcript':
      if (typeof frame.text !== 'string') return undefined
      if (frame.direction !== 'input' && frame.direction !== 'output') return undefined
      return { type: 'transcript', direction: frame.direction, text: frame.text, final: frame.final !== false }
    case 'tool_call':
      if (typeof frame.callId !== 'string' || typeof frame.name !== 'string') return undefined
      return {
        type: 'tool.call',
        callId: frame.callId,
        name: frame.name,
        arguments: isRecord(frame.arguments) ? frame.arguments : {},
      }
    case 'error':
      if (typeof frame.message !== 'string') return undefined
      return {
        type: 'error',
        code: isErrorCode(frame.code) ? frame.code : 'agentUnavailable',
        message: frame.message,
        fatal: frame.fatal === true,
      }
    case 'done':
      return { type: 'turn.done' }
    default:
      return undefined
  }
}

async function* readNdjsonFrames(body: ReadableStream<Uint8Array>): AsyncIterable<unknown> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) yield JSON.parse(trimmed)
      }
      if (done) return
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrorCode(value: unknown): value is GatewayErrorCode {
  return typeof value === 'string' && (VALID_ERROR_CODES as readonly string[]).includes(value)
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return '<no body>'
  }
}
