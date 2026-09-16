import type { StackchanContext } from 'capabilities'
import type { StackchanDock } from 'dock'
import config from 'mc/config'
import Modules from 'modules'
import { createGatewayBridge } from 'stackchan-gateway-bridge'
import { type GatewayConfig, requireGatewayIdentity, resolveGatewayConfig } from 'stackchan-gateway-config'
import { createGatewayPresentation } from 'stackchan-gateway-dock-presentation'
import { createGatewayDockRuntime } from 'stackchan-gateway-dock-runtime'
import { createGatewaySocket } from 'stackchan-gateway-socket'
import type { RealtimeToolProvider } from 'stackchan-realtime-session'
import { createRemoteSessionRuntime } from 'stackchan-remote-session-runtime'
import Timer from 'timer'

/**
 * Gateway Dock.
 *
 * Selected with `conversation.backend = 'gateway'`. Direct ChatService sessions
 * and the Android USB Dock are untouched: a target picks exactly one Dock
 * manifest, and this one only starts when a Gateway endpoint is configured.
 */

const stackchanGatewayDock: StackchanDock = {
  start(modConfig) {
    const gateway = resolveGatewayConfig((config as { gateway?: GatewayConfig }).gateway, modConfig)
    if (!gateway?.enabled) return
    // Fails fast with the missing field named, rather than opening a socket
    // to an endpoint the device cannot identify itself on.
    const identity = requireGatewayIdentity(gateway)
    const scheduler = {
      set: (callback: () => void, milliseconds: number) => Timer.set(callback, milliseconds),
      clear: (handle: unknown) => Timer.clear(handle as Timer),
    }

    return createGatewayDockRuntime(gateway, {
      createBridge() {
        return createGatewayBridge({
          endpoint: identity.endpoint,
          deviceId: identity.deviceId,
          clientId: identity.clientId,
          token: identity.token,
          socketFactory: createGatewaySocket,
          scheduler,
          capabilities: {
            audioInput: [{ codec: 'pcm16', sampleRate: 16_000, channels: 1 }],
            audioOutput: [{ codec: 'pcm16', sampleRate: 16_000, channels: 1 }],
            embodiment: [],
            approval: true,
          },
        })
      },
      createRemoteRuntime(bridge) {
        return createRemoteSessionRuntime(bridge, scheduler)
      },
      createRealtimeToolProvider,
      createPresentation: (context, options) => createGatewayPresentation(context, options),
    })
  },
}

function createRealtimeToolProvider(context: StackchanContext): RealtimeToolProvider {
  if (!Modules.has('stackchan-realtime-tools')) {
    trace('[gateway-dock] stackchan-realtime-tools is unavailable; the Agent gets no embodiment tools\n')
    return { tools: [] }
  }
  const createProvider = Modules.importNow('stackchan-realtime-tools') as
    | ((context: StackchanContext) => RealtimeToolProvider)
    | undefined
  if (typeof createProvider !== 'function') {
    throw new TypeError('stackchan-realtime-tools does not export a provider factory')
  }
  return createProvider(context)
}

export default stackchanGatewayDock
