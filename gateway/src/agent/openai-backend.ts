/**
 * OpenAI Chat Completions backend.
 *
 * Streaming is deliberately off: the Gateway already streams to the device
 * over its own transport, and non-streaming responses make the tool-call
 * round trip (assistant tool_calls -> Gateway executes/relays -> `tool` role
 * message -> re-request) trivial to reason about and test. `producesAudio`
 * is false, so the Gateway runs its own STT/TTS around this backend.
 */

import type { ToolDefinition } from '../tools/tool-types.ts'
import type { AgentBackend, AgentSession, AgentSessionOptions } from './agent-backend.ts'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-4o-mini'
/** A tool call that keeps asking for more tools, forever, would hang the turn. */
const MAX_TOOL_ROUNDS = 8

type ChatToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatToolCall[] } }>
}

function toOpenAiTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }
}

export function createOpenAiBackend(options: {
  apiKey: string
  model?: string
  baseUrl?: string
  instructions?: string
  fetchImpl?: typeof fetch
}): AgentBackend {
  const model = options.model ?? DEFAULT_MODEL
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL
  const fetchImpl = options.fetchImpl ?? fetch

  return {
    name: 'openai',
    producesAudio: false,
    async createSession(sessionOptions: AgentSessionOptions): Promise<AgentSession> {
      const { onEvent, tools, signal: sessionSignal } = sessionOptions
      const instructions = sessionOptions.instructions ?? options.instructions
      const openAiTools = tools.map(toOpenAiTool)
      const messages: ChatMessage[] = instructions ? [{ role: 'system', content: instructions }] : []

      let pendingCallIds: Set<string> | undefined
      let round = 0
      let closed = false
      let turnController: AbortController | undefined

      const abandonTurn = (): void => {
        turnController = undefined
        pendingCallIds = undefined
        round = 0
      }

      const fail = (message: string): void => {
        onEvent({ type: 'error', code: 'agentUnavailable', message, fatal: false })
        onEvent({ type: 'turn.done' })
        abandonTurn()
      }

      const request = async (): Promise<void> => {
        const controller = turnController
        if (!controller) return // cancelled before this round started
        round++
        if (round > MAX_TOOL_ROUNDS) {
          fail(`openai backend: exceeded ${MAX_TOOL_ROUNDS} tool-call rounds in one turn`)
          return
        }

        let response: Response
        try {
          response = await fetchImpl(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages,
              stream: false,
              ...(openAiTools.length > 0 ? { tools: openAiTools } : {}),
            }),
            signal: controller.signal,
          })
        } catch (cause) {
          if (controller.signal.aborted) return // cancel()/close() already handled this turn
          fail(`openai backend: request failed: ${describeError(cause)}`)
          return
        }
        if (controller !== turnController) return // superseded by a cancel

        if (!response.ok) {
          const detail = await safeText(response)
          if (controller !== turnController || controller.signal.aborted) return
          fail(`openai backend: ${response.status} ${response.statusText}: ${detail}`)
          return
        }

        const body = (await response.json()) as ChatCompletionResponse
        if (controller !== turnController || controller.signal.aborted) return
        const message = body.choices?.[0]?.message
        if (!message) return fail('openai backend: response had no choices')

        const toolCalls = message.tool_calls ?? []
        if (toolCalls.length > 0) {
          messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls })
          pendingCallIds = new Set(toolCalls.map((call) => call.id))
          for (const call of toolCalls) {
            onEvent({ type: 'tool.call', callId: call.id, name: call.function.name, arguments: parseArgs(call) })
          }
          return
        }

        messages.push({ role: 'assistant', content: message.content ?? '' })
        onEvent({ type: 'text', text: message.content ?? '', final: true })
        onEvent({ type: 'turn.done' })
        abandonTurn()
      }

      const startTurn = async (userText: string): Promise<void> => {
        if (closed) return
        turnController?.abort()
        messages.push({ role: 'user', content: userText })
        const controller = new AbortController()
        turnController = controller
        pendingCallIds = undefined
        round = 0
        if (sessionSignal) {
          if (sessionSignal.aborted) controller.abort()
          else sessionSignal.addEventListener('abort', () => controller.abort(), { once: true })
        }
        // Resolves once this round's events are emitted -- either the turn finished,
        // it errored, or it's now waiting on `toolResult` for a tool-call round.
        await request()
      }

      return {
        async inputText(text: string): Promise<void> {
          await startTurn(text)
        },
        // This backend has no native audio path; the Gateway runs STT/TTS around it.
        async inputAudio(): Promise<void> {},
        async toolResult(callId: string, result: unknown): Promise<void> {
          if (!pendingCallIds?.has(callId)) return
          messages.push({ role: 'tool', tool_call_id: callId, content: JSON.stringify(result ?? null) })
          pendingCallIds.delete(callId)
          if (pendingCallIds.size === 0) {
            pendingCallIds = undefined
            await request()
          }
        },
        async cancel(): Promise<void> {
          for (const callId of pendingCallIds ?? [])
            messages.push({ role: 'tool', tool_call_id: callId, content: '{"cancelled":true}' })
          turnController?.abort()
          abandonTurn()
        },
        async close(): Promise<void> {
          closed = true
          turnController?.abort()
          abandonTurn()
        },
      }
    },
  }
}

function parseArgs(call: ChatToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
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
