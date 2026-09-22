import type {
  RemoteConversationSession,
  RemoteConversationSessionDelegate,
  RemoteConversationState,
  StackchanContext,
} from 'capabilities'
import type { GatewayBridge } from 'stackchan-gateway-bridge'
import type { GatewayConfig } from 'stackchan-gateway-config'
import { type GatewayPresentation, isLocalSpeechError } from 'stackchan-gateway-dock-presentation'
import type { GatewayServerMessage } from 'stackchan-gateway-protocol'
import type { RealtimeEventBridge, RealtimeToolProvider } from 'stackchan-realtime-session'
import {
  createRemoteConversationSessionFacade,
  type RemoteConversationSessionBinding,
} from 'stackchan-remote-session-facade'

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
  scheduler?: { set(callback: () => void, milliseconds: number): unknown; clear(handle: unknown): void }
  createMicrophone?(
    onFrame: (payload: string) => void,
    onError: (message: string) => void,
  ): { start(): void; stop(): void }
  isAudioActive?(context: StackchanContext): boolean
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
      return message.fatal ? 'blocked' : current === 'recognizing' || current === 'speaking' ? 'listening' : undefined
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
  let interruptActive: (() => void) | undefined
  let cancelSequence = 0
  let contextAttached = false
  let closed = false
  const facade = createRemoteConversationSessionFacade(createActiveBinding)

  function createActiveBinding(): RemoteConversationSessionBinding {
    if (!contextAttached || !context) {
      throw new Error('Gateway Dock cannot activate before the Stack-chan context is attached')
    }
    const activeContext = context
    const activation = remoteRuntime.activate(activeContext, dependencies.createRealtimeToolProvider(activeContext))
    let presentation: GatewayPresentation | undefined
    let bindingClosed = false
    let playbackPending = 0
    /** Why the last reply was not spoken, shown on the way back to listening. */
    let speechFailure: string | undefined
    let playbackGeneration = 0
    let responseId: string | undefined
    let cancelRequest: string | undefined
    let cancelTimer: unknown
    const clearCancelTimer = () => {
      const timer = cancelTimer
      cancelTimer = undefined
      if (timer !== undefined) dependencies.scheduler?.clear(timer)
    }
    let audioInputEnabled = false
    let speakLocally = true
    let sequence = 0
    let recording = false
    let pendingAudio: { schema: string; type: string; seq: number; payload: string } | undefined
    let pendingRetries = 0
    let poll: unknown
    let removeState: (() => void) | undefined
    let removeTransport: (() => void) | undefined
    const canRecord = () =>
      !bindingClosed &&
      !cancelRequest &&
      config.microphone === true &&
      audioInputEnabled &&
      activation.remoteConversationSession.state === 'listening' &&
      bridge.transportState === 'ready' &&
      playbackPending === 0 &&
      !dependencies.isAudioActive?.(activeContext)
    const microphone =
      config.microphone === true
        ? dependencies.createMicrophone?.(
            (payload) => {
              if (!canRecord() || pendingAudio) return
              const message = {
                schema: 'stackchan.gateway.v1',
                type: 'audio.input',
                seq: sequence++,
                payload,
              }
              const result = bridge.sendGatewayMessage(message)
              if (result === 'overflow') {
                // Retain only the unaccepted frame. Stop capture until a poll
                // can enqueue it; do not close the transport or end the turn.
                pendingAudio = message
                pendingRetries = 0
                recording = false
                microphone?.stop()
                return
              }
              if (result !== 'queued') {
                const reason = bridge.lastSendFailure ?? result
                microphone?.stop()
                recording = false
                activation.updateConversationState('blocked', `Mic send: ${reason}`)
              }
            },
            (message) => activation.updateConversationState('blocked', message),
          )
        : undefined
    const syncMicrophone = () => {
      const permitted = canRecord()
      if (!permitted) {
        pendingAudio = undefined
        bridge.clearPendingAudio?.()
      }
      const next = permitted && !pendingAudio
      if (recording === next) return
      recording = next
      if (next) microphone?.start()
      else {
        microphone?.stop()
        if (bridge.transportState === 'ready')
          bridge.sendGatewayMessage({
            schema: 'stackchan.gateway.v1',
            type: 'audio.input.end',
            seq: sequence++,
          })
      }
    }
    const tick = () => {
      if (bindingClosed) return
      if (pendingAudio && canRecord()) {
        const result = bridge.sendGatewayMessage(pendingAudio)
        if (result === 'queued') pendingAudio = undefined
        else if (result === 'disconnected' || ++pendingRetries >= 250) {
          const reason = result === 'disconnected' ? (bridge.lastSendFailure ?? result) : 'send wait timeout'
          pendingAudio = undefined
          activation.updateConversationState('blocked', `Mic send: ${reason}`)
        }
      }
      syncMicrophone()
      poll = dependencies.scheduler?.set(tick, 20)
    }
    try {
      if (config.presentationEnabled !== false) {
        // The Gateway advertises whether it streams assistant audio only in
        // session.ready, which arrives after activation, so start in the
        // conservative mode: speak locally, and stop once audio starts.
        presentation = dependencies.createPresentation(context, { speakLocally: true })
      }
      const activePresentation = presentation
      const stopPlayback = () => {
        playbackGeneration++
        playbackPending = 0
        responseId = undefined
        activePresentation?.interrupt?.()
      }
      interruptActive = () => {
        if (bindingClosed || cancelRequest) return
        cancelRequest = `cancel-${++cancelSequence}`
        activation.updateConversationState('recognizing')
        stopPlayback()
        syncMicrophone()
        if (
          bridge.sendGatewayMessage({
            schema: 'stackchan.gateway.v1',
            type: 'response.cancel',
            requestId: cancelRequest,
          }) !== 'queued'
        ) {
          activation.updateConversationState('blocked', 'Gateway interruption failed')
          return
        }
        cancelTimer = dependencies.scheduler?.set(() => {
          cancelTimer = undefined
          if (!bindingClosed && cancelRequest)
            activation.updateConversationState('blocked', 'Gateway interruption timed out')
        }, 5000)
      }
      removeState = activation.remoteConversationSession.subscribe(syncMicrophone)
      removeTransport = activation.remoteConversationSession.subscribeTransport((state) => {
        if (state !== 'ready') {
          audioInputEnabled = false
          cancelRequest = undefined
          clearCancelTimer()
          stopPlayback()
        }
        syncMicrophone()
        if (state === 'ready' && activation.remoteConversationSession.state !== 'standby') {
          activation.remoteConversationSession.requestStart()
        }
      })
      tick()
      bridge.setSidebandHandler((message) => {
        if (message.type === 'response.cancelled') {
          if (cancelRequest !== message.requestId) return
          cancelRequest = undefined
          clearCancelTimer()
          activation.updateConversationState('listening')
          syncMicrophone()
          return
        }
        if (cancelRequest && message.type !== 'agent.error') return
        if (message.type === 'audio.started') {
          stopPlayback()
          responseId = message.responseId
          speakLocally = false
          activePresentation?.setSpeakLocally(false)
        }
        if ((message.type === 'audio.chunk' || message.type === 'audio.completed') && message.responseId !== responseId)
          return
        if (message.type === 'agent.error') stopPlayback()

        if (message.type === 'session.ready') {
          // The Gateway decides who speaks: it streams PCM when a TTS adapter
          // is configured, otherwise the robot reads the output transcript.
          speakLocally = message.features.audioOutput !== true
          audioInputEnabled =
            message.features.audioInput &&
            message.audio.input.sampleRate === 16000 &&
            message.audio.input.channels === 1 &&
            message.audio.input.codec === 'pcm16'
          activePresentation?.setSpeakLocally(speakLocally)
          syncMicrophone()
        }
        const stopped =
          activation.remoteConversationSession.state === 'standby' ||
          activation.remoteConversationSession.state === 'blocked'
        if (stopped && message.type !== 'session.ready' && message.type !== 'agent.error') return
        const next = gatewayConversationState(message, activation.remoteConversationSession.state)
        if (next && message.type !== 'audio.completed') {
          activation.updateConversationState(
            next,
            message.type === 'agent.error' && message.fatal ? message.message : undefined,
          )
        }
        const finishesPlayback =
          message.type === 'audio.completed' || (message.type === 'transcript.output' && message.final && speakLocally)
        if (finishesPlayback) playbackPending++
        const currentPlayback = playbackGeneration
        syncMicrophone()
        let completion: void | Promise<void>
        try {
          completion = deliver(activePresentation, message)
        } catch (error) {
          stopPlayback()
          activation.updateConversationState('blocked', errorMessage(error))
          return
        }
        if (finishesPlayback)
          void Promise.resolve(completion)
            .catch((error) => {
              if (bindingClosed || currentPlayback !== playbackGeneration) return
              // A reply the local engine cannot pronounce does not break the
              // session: the link and the microphone are both fine. `blocked`
              // is terminal here -- canRecord() requires `listening` and
              // gatewayConversationState() ignores every server message while
              // blocked -- so one unpronounceable reply would end the
              // conversation for good. Report it and keep listening instead.
              if (isLocalSpeechError(error)) {
                speechFailure = errorMessage(error)
                return
              }
              activation.updateConversationState('blocked', errorMessage(error))
            })
            .finally(() => {
              if (currentPlayback !== playbackGeneration) return
              playbackPending--
              if (
                bindingClosed ||
                playbackPending ||
                activation.remoteConversationSession.state === 'standby' ||
                activation.remoteConversationSession.state === 'blocked'
              )
                return
              const failure = speechFailure
              speechFailure = undefined
              activation.updateConversationState('listening', failure)
              syncMicrophone()
            })
      })
    } catch (error) {
      bindingClosed = true
      pendingAudio = undefined
      tryClose(() => bridge.clearPendingAudio?.())
      if (poll !== undefined) dependencies.scheduler?.clear(poll)
      tryClose(() => microphone?.stop())
      tryClose(() => removeState?.())
      tryClose(() => removeTransport?.())
      tryClose(() => bridge.setSidebandHandler(undefined))
      tryClose(() => presentation?.close())
      tryClose(() => activation.close())
      throw error
    }

    const activePresentation = presentation
    return {
      remoteSession: activation.remoteConversationSession,
      close() {
        if (bindingClosed) return
        bindingClosed = true
        pendingAudio = undefined
        interruptActive = undefined
        clearCancelTimer()
        if (poll !== undefined) dependencies.scheduler?.clear(poll)
        let firstError: unknown
        const attempt = (operation: () => void) => {
          try {
            operation()
          } catch (error) {
            firstError ??= error
          }
        }
        attempt(() => bridge.clearPendingAudio?.())
        attempt(() => microphone?.stop())
        attempt(() => removeState?.())
        attempt(() => removeTransport?.())
        attempt(() => bridge.setSidebandHandler(undefined))
        attempt(() => activePresentation?.close())
        attempt(() => activation.close())
        if (firstError !== undefined) throw firstError
      },
    }
  }

  return {
    remoteConversationSession: Object.assign(facade.remoteSession, {
      interrupt() {
        interruptActive?.()
      },
      sendText(text: string) {
        if (facade.remoteSession.activationState !== 'active' || facade.remoteSession.state !== 'listening') {
          throw new Error('Start the conversation and wait for listening before sending text')
        }
        if (!text.trim() || text.length > 4000) throw new Error('Text must contain 1–4000 characters')
        if (bridge.sendGatewayMessage({ schema: 'stackchan.gateway.v1', type: 'text.input', text }) !== 'queued') {
          throw new Error('Gateway is not ready')
        }
      },
    }),
    onContextCreated(nextContext) {
      if (closed) throw new Error('Gateway Dock runtime is closed')
      if (contextAttached) throw new Error('Gateway Dock context is already attached')
      context = nextContext
      contextAttached = true
      if (config.autoStart) {
        try {
          facade.remoteSession.activate()
          facade.remoteSession.requestStart()
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

function deliver(presentation: GatewayPresentation | undefined, message: GatewayServerMessage): void | Promise<void> {
  if (!presentation) return
  try {
    switch (message.type) {
      case 'transcript.input':
        presentation.onInputTranscript(message.text, message.final)
        break
      case 'transcript.output':
        return presentation.onOutputTranscript(message.text, message.final)
      case 'audio.started':
        presentation.onAudioStarted(message.format)
        break
      case 'audio.chunk':
        presentation.onAudioChunk(message.payload)
        break
      case 'audio.completed':
        return presentation.onAudioCompleted()
      case 'agent.error':
        presentation.onAgentError(message.message, message.fatal)
        break
      default:
        break
    }
  } catch (error) {
    log(`[gateway-dock] presentation failed: ${errorMessage(error)}\n`)
    throw error
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
