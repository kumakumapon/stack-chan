import type {
  RemoteConversationSession,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  StackchanContext,
} from 'capabilities'
import type { GatewayBridge } from 'stackchan-gateway-bridge'
import type { GatewayConfig } from 'stackchan-gateway-config'
import type { GatewayServerMessage } from 'stackchan-gateway-protocol'
import type { RealtimeEventBridge, RealtimeToolProvider } from 'stackchan-realtime-session'
import {
  createRemoteConversationSessionFacade,
  type RemoteConversationSessionBinding,
} from 'stackchan-remote-session-facade'
import type { GatewayPresentation } from './presentation.ts'

/**
 * Gateway Dock runtime.
 *
 * The Gateway is a Dock that happens to be reachable over Wi-Fi instead of USB,
 * so this mirrors `docks/android-usb-audio/runtime.ts`: the physical transport
 * is reserved at start-up, and context, tools and presentation are bound only
 * while the conversation is activated.
 *
 * The one thing the Wi-Fi Dock has to do for itself is derive the conversation
 * state. A USB Dock reports it as a status byte; the Gateway reports it through
 * the `stackchan.gateway.v1` sideband, which this file maps onto the same
 * `RemoteConversationState` the rest of the firmware already renders.
 */

export type GatewayRemoteActivation = {
  readonly remoteConversationSession: RemoteConversationSessionDelegate
  updateConversationState(state: RemoteConversationState, error?: string): void
  close(): void
}

export type GatewayRemoteRuntime = {
  activate(context: StackchanContext, provider: RealtimeToolProvider): GatewayRemoteActivation
  close(): void
}

export type GatewayDockRuntime = {
  readonly remoteConversationSession?: RemoteConversationSession
  onContextCreated(context: StackchanContext): void
  close(): void
}

export type GatewayDockDependencies = {
  createBridge(): GatewayBridge
  createRemoteRuntime(bridge: RealtimeEventBridge): GatewayRemoteRuntime
  createRealtimeToolProvider(context: StackchanContext): RealtimeToolProvider
  createPresentation(context: StackchanContext, options: { speakLocally: boolean }): GatewayPresentation
}

/**
 * Maps a sideband message onto the conversation state the robot shows.
 * Exported because this mapping is the contract between the two planes, and a
 * regression here is invisible in every other test.
 */
export function gatewayConversationState(
  message: GatewayServerMessage,
  current: RemoteConversationState,
): RemoteConversationState | undefined {
  switch (message.type) {
    case 'transcript.input':
      return current === 'standby' || current === 'blocked' ? undefined : 'recognizing'
    case 'transcript.output':
      return current === 'standby' || current === 'blocked' ? undefined : 'speaking'
    case 'audio.started':
      return current === 'standby' || current === 'blocked' ? undefined : 'speaking'
    case 'audio.completed':
      return current === 'standby' || current === 'blocked' ? undefined : 'listening'
    case 'agent.error':
      return message.fatal ? 'blocked' : undefined
    default:
      return undefined
  }
}

export function createGatewayDockRuntime(
  config: GatewayConfig,
  dependencies: GatewayDockDependencies,
): GatewayDockRuntime {
  const bridge = dependencies.createBridge()
  let remoteRuntime: GatewayRemoteRuntime
  try {
    remoteRuntime = dependencies.createRemoteRuntime(bridge)
  } catch (error) {
    tryClose(() => bridge.close())
    throw error
  }

  let context: StackchanContext | undefined
  let contextAttached = false
  let closed = false
  const facade = createRemoteConversationSessionFacade(createActiveBinding)

  function createActiveBinding(): RemoteConversationSessionBinding {
    if (!contextAttached || !context) {
      throw new Error('Gateway Dock cannot activate before the Stack-chan context is attached')
    }
    const activation = remoteRuntime.activate(context, dependencies.createRealtimeToolProvider(context))
    let presentation: GatewayPresentation | undefined
    try {
      if (config.presentationEnabled !== false) {
        // The Gateway advertises whether it streams assistant audio only in
        // session.ready, which arrives after activation, so start in the
        // conservative mode: speak locally, and stop once audio starts.
        presentation = dependencies.createPresentation(context, { speakLocally: true })
      }
      const activePresentation = presentation
      bridge.setSidebandHandler((message) => {
        if (message.type === 'session.ready') {
          // The Gateway decides who speaks: it streams PCM when a TTS adapter
          // is configured, otherwise the robot reads the output transcript.
          activePresentation?.setSpeakLocally(message.features.audioOutput !== true)
        }
        const next = gatewayConversationState(message, activation.remoteConversationSession.state)
        if (next) {
          activation.updateConversationState(
            next,
            message.type === 'agent.error' && message.fatal ? message.message : undefined,
          )
        }
        deliver(activePresentation, message)
      })
    } catch (error) {
      tryClose(() => bridge.setSidebandHandler(undefined))
      tryClose(() => presentation?.close())
      tryClose(() => activation.close())
      throw error
    }

    const activePresentation = presentation
    let bindingClosed = false
    return {
      remoteSession: activation.remoteConversationSession,
      close() {
        if (bindingClosed) return
        bindingClosed = true
        let firstError: unknown
        const attempt = (operation: () => void) => {
          try {
            operation()
          } catch (error) {
            firstError ??= error
          }
        }
        attempt(() => bridge.setSidebandHandler(undefined))
        attempt(() => activePresentation?.close())
        attempt(() => activation.close())
        if (firstError !== undefined) throw firstError
      },
    }
  }

  return {
    remoteConversationSession: facade.remoteSession,
    onContextCreated(nextContext) {
      if (closed) throw new Error('Gateway Dock runtime is closed')
      if (contextAttached) throw new Error('Gateway Dock context is already attached')
      context = nextContext
      contextAttached = true
      if (config.autoStart) {
        try {
          facade.remoteSession.activate()
        } catch (error) {
          log(`[gateway-dock] auto-start activation failed: ${errorMessage(error)}\n`)
        }
      }
    },
    close() {
      if (closed) return
      closed = true
      context = undefined
      let firstError: unknown
      const attempt = (operation: () => void) => {
        try {
          operation()
        } catch (error) {
          firstError ??= error
        }
      }
      attempt(() => facade.close())
      attempt(() => remoteRuntime.close())
      attempt(() => bridge.close())
      if (firstError !== undefined) throw firstError
    },
  }
}

function deliver(presentation: GatewayPresentation | undefined, message: GatewayServerMessage): void {
  if (!presentation) return
  try {
    switch (message.type) {
      case 'transcript.input':
        presentation.onInputTranscript(message.text, message.final)
        break
      case 'transcript.output':
        presentation.onOutputTranscript(message.text, message.final)
        break
      case 'audio.started':
        presentation.onAudioStarted(message.format)
        break
      case 'audio.chunk':
        presentation.onAudioChunk(message.payload)
        break
      case 'audio.completed':
        presentation.onAudioCompleted()
        break
      case 'agent.error':
        presentation.onAgentError(message.message, message.fatal)
        break
      default:
        break
    }
  } catch (error) {
    log(`[gateway-dock] presentation failed: ${errorMessage(error)}\n`)
  }
}

function tryClose(operation: () => void): void {
  try {
    operation()
  } catch {
    // Preserve the original failure.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function log(message: string): void {
  if (typeof trace === 'function') trace(message)
}
