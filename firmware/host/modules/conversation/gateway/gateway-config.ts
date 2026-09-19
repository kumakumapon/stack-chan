/**
 * Configuration resolution for the Gateway Dock: MOD-driven enablement, and
 * parsing/validation of the `ws://`/`wss://` endpoint and device identity.
 * Pure and Node-testable; mirrors `resolveUsbAudioConfig` in
 * `host/app/docks/android-usb-audio/runtime.ts`.
 */

export type GatewayConfig = {
  enabled?: boolean
  endpoint?: string
  deviceId?: string
  clientId?: string
  token?: string
  autoStart?: boolean
  presentationEnabled?: boolean
  /** Opt-in microphone streaming over the gateway media plane. Default off. */
  microphone?: boolean
}

export type GatewayEndpoint = {
  secure: boolean
  host: string
  port: number
  path: string
}

export type GatewayIdentity = {
  endpoint: GatewayEndpoint
  deviceId: string
  clientId: string
  token?: string
}

/**
 * A MOD may flip `enabled` on for a build whose host config leaves the Dock
 * off by default, the same opt-in shape `resolveUsbAudioConfig` offers the
 * USB Dock.
 */
export function resolveGatewayConfig(
  hostConfig: GatewayConfig | undefined,
  modConfig: unknown,
): GatewayConfig | undefined {
  const enabledByMod = (modConfig as { gateway?: { enabled?: unknown } } | null)?.gateway?.enabled === true
  const override = (modConfig as { gateway?: { autoStart?: boolean } } | null)?.gateway
  return enabledByMod
    ? {
        ...(hostConfig ?? {}),
        enabled: true,
        ...(override?.autoStart === undefined ? {} : { autoStart: override.autoStart }),
      }
    : hostConfig
}

/**
 * Parses a `ws://` or `wss://` endpoint URL into its connection parts.
 * Defaults the port to 80/443 and the path to `/` when omitted.
 */
export function parseGatewayEndpoint(endpoint: string): GatewayEndpoint {
  // The authority may be empty here so that `ws://` reports a missing host
  // rather than an unrecognised scheme.
  const match = /^(wss?):\/\/([^/?#]*)(\/[^?#]*)?$/.exec(endpoint)
  if (!match) {
    throw new Error(`gateway endpoint must be a ws:// or wss:// URL, got: ${endpoint}`)
  }
  const [, scheme, authority, rawPath] = match
  const secure = scheme === 'wss'
  const hostMatch = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(authority)
  if (!hostMatch?.[1]) {
    throw new Error(`gateway endpoint has an invalid host: ${endpoint}`)
  }
  const host = hostMatch[1].replace(/^\[|\]$/g, '')
  if (!host) {
    throw new Error(`gateway endpoint has an invalid host: ${endpoint}`)
  }
  let port = secure ? 443 : 80
  if (hostMatch[2] !== undefined) {
    const parsedPort = Number.parseInt(hostMatch[2], 10)
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      throw new Error(`gateway endpoint has an invalid port: ${endpoint}`)
    }
    port = parsedPort
  }
  const path = rawPath && rawPath.length > 0 ? rawPath : '/'
  return { secure, host, port, path }
}

/**
 * Resolves the fields the Gateway Dock needs to open a session, throwing a
 * readable error that names the first missing field.
 */
export function requireGatewayIdentity(config: GatewayConfig | undefined): GatewayIdentity {
  if (!config?.endpoint) throw new Error('gateway config is missing "endpoint"')
  if (!config.deviceId) throw new Error('gateway config is missing "deviceId"')
  if (!config.clientId) throw new Error('gateway config is missing "clientId"')
  const endpoint = parseGatewayEndpoint(config.endpoint)
  const identity: GatewayIdentity = {
    endpoint,
    deviceId: config.deviceId,
    clientId: config.clientId,
  }
  if (config.token !== undefined) identity.token = config.token
  return identity
}
