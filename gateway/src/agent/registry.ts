/**
 * Turns Gateway config into a concrete `AgentBackend`. The only place that
 * needs to know all three backends exist; everything downstream just holds
 * an `AgentBackend`.
 */

import type { AgentBackend } from './agent-backend.ts'
import { createEchoBackend } from './echo-backend.ts'
import { createHermesBackend } from './hermes-backend.ts'
import { createOpenAiBackend } from './openai-backend.ts'

export type AgentBackendKind = 'echo' | 'openai' | 'hermes'

export function createAgentBackend(config: {
  type: AgentBackendKind
  apiKey?: string
  model?: string
  baseUrl?: string
  endpoint?: string
  token?: string
  instructions?: string
}): AgentBackend {
  switch (config.type) {
    case 'echo':
      return createEchoBackend()
    case 'openai':
      if (!config.apiKey) throw new Error('createAgentBackend: "openai" backend requires config.apiKey')
      return createOpenAiBackend({
        apiKey: config.apiKey,
        ...(config.model ? { model: config.model } : {}),
        ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
        ...(config.instructions ? { instructions: config.instructions } : {}),
      })
    case 'hermes':
      if (!config.endpoint) throw new Error('createAgentBackend: "hermes" backend requires config.endpoint')
      return createHermesBackend({
        endpoint: config.endpoint,
        ...(config.token ? { token: config.token } : {}),
      })
    default:
      throw new Error(`createAgentBackend: unknown backend type "${config.type as string}"`)
  }
}
