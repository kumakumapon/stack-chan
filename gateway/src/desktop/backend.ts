import { randomUUID } from 'node:crypto'
import type { AgentBackend } from '../agent/agent-backend.ts'
import type { ModelResponder } from './model.ts'
import { parseReply, replyTools } from './reply.ts'
import type { DesktopStore } from './store.ts'

/** Read settings/history per turn, so all providers share Gateway-owned conversation memory. */
export function createDesktopBackend(store: DesktopStore, respond: ModelResponder): AgentBackend {
  return {
    name: 'desktop',
    producesAudio: false,
    async createSession(options) {
      let closed = false
      let controller: AbortController | undefined
      const pending = new Map<string, () => void>()
      const cancel = async () => {
        controller?.abort()
        controller = undefined
        for (const resolve of pending.values()) resolve()
        pending.clear()
      }
      return {
        async inputText(text) {
          if (closed) return
          if (controller) throw new Error('前の応答が処理中です')
          const turn = new AbortController()
          controller = turn
          const signal = options.signal ? AbortSignal.any([options.signal, turn.signal]) : turn.signal
          try {
            const settings = store.settings()
            const reply = parseReply(
              await respond({ settings, history: store.history(options.deviceId), text, signal }),
            )
            if (closed || signal.aborted) return
            if (settings.embodiment) {
              for (const call of replyTools(reply, options.tools)) {
                if (closed || signal.aborted) return
                const callId = randomUUID()
                await new Promise<void>((resolve) => {
                  pending.set(callId, resolve)
                  options.onEvent({ type: 'tool.call', callId, ...call })
                })
              }
            }
            if (closed || signal.aborted) return
            await store.append(options.deviceId, {
              at: new Date().toISOString(),
              provider: settings.provider,
              user: text,
              assistant: reply.text,
            })
            if (closed || signal.aborted) return
            options.onEvent({ type: 'text', text: reply.text, final: true })
            options.onEvent({ type: 'turn.done' })
          } catch (error) {
            if (closed || signal.aborted) return
            options.onEvent({
              type: 'error',
              code: 'agentUnavailable',
              message: error instanceof Error ? error.message : 'LLMの実行に失敗しました',
              fatal: false,
            })
            options.onEvent({ type: 'turn.done' })
          } finally {
            if (controller === turn) controller = undefined
          }
        },
        async inputAudio() {},
        async toolResult(callId) {
          const resolve = pending.get(callId)
          pending.delete(callId)
          resolve?.()
        },
        cancel,
        async close() {
          closed = true
          await cancel()
        },
      }
    },
  }
}
