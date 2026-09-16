/**
 * Deterministic offline backend: echoes text back with a prefix.
 *
 * Doubles as the Gateway's integration-test fixture (predictable events, no
 * network) and as a working dev backend for exercising the transport and
 * media pipeline without an API key. Keep it dependency-free and honest to
 * the `AgentBackend` contract -- tests elsewhere rely on its behavior, not
 * just its shape.
 */

import type { AgentBackend, AgentEvent, AgentSession, AgentSessionOptions } from './agent-backend.ts'

const EMOTION_TOOL_NAME = 'stackchan.face.setEmotion'
const EMOTION_PATTERN = /:emotion=(\S+)/

export function createEchoBackend(options: { prefix?: string } = {}): AgentBackend {
  const prefix = options.prefix ?? 'echo: '

  return {
    name: 'echo',
    producesAudio: false,
    async createSession(sessionOptions: AgentSessionOptions): Promise<AgentSession> {
      const { onEvent, tools } = sessionOptions
      const hasEmotionTool = tools.some((tool) => tool.name === EMOTION_TOOL_NAME)

      let audioFrames: Int16Array[] = []
      let pendingTool: { callId: string; resolve: () => void } | undefined
      let callSeq = 0

      const emit = (event: AgentEvent): void => onEvent(event)

      const runTurn = async (transcriptText: string, replyText: string): Promise<void> => {
        emit({ type: 'transcript', direction: 'input', text: transcriptText, final: true })

        const emotionMatch = hasEmotionTool ? replyText.match(EMOTION_PATTERN) : null
        let waitForResult: Promise<void> | undefined
        if (emotionMatch) {
          const callId = `echo-call-${callSeq++}`
          waitForResult = new Promise<void>((resolve) => {
            pendingTool = { callId, resolve }
          })
          emit({
            type: 'tool.call',
            callId,
            name: EMOTION_TOOL_NAME,
            arguments: { emotion: emotionMatch[1] ?? '' },
          })
        }

        emit({ type: 'text', text: replyText, final: true })
        if (waitForResult) await waitForResult
        emit({ type: 'turn.done' })
      }

      return {
        async inputText(text: string): Promise<void> {
          await runTurn(text, `${prefix}${text}`)
        },
        async inputAudio(audio: Int16Array): Promise<void> {
          audioFrames.push(audio)
        },
        async endAudio(): Promise<void> {
          const totalSamples = audioFrames.reduce((sum, frame) => sum + frame.length, 0)
          audioFrames = []
          const description = `[audio utterance: ${totalSamples} samples]`
          await runTurn(description, `${prefix}${description}`)
        },
        async toolResult(callId: string): Promise<void> {
          if (pendingTool?.callId === callId) {
            pendingTool.resolve()
            pendingTool = undefined
          }
        },
        async cancel(): Promise<void> {
          audioFrames = []
          pendingTool = undefined
        },
        async close(): Promise<void> {
          audioFrames = []
          pendingTool = undefined
        },
      }
    },
  }
}
