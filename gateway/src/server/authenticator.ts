/**
 * Device authentication.
 *
 * A per-device token wins over the shared one, so revoking a single robot never
 * means rotating the fleet. Comparisons are constant-time: the token is the
 * only thing standing between a LAN peer and the Agent's tools.
 */

import { timingSafeEqual } from 'node:crypto'
import type { DeviceCredential } from '../config.ts'

export type AuthenticatorOptions = {
  devices?: DeviceCredential[]
  sharedToken?: string
  /** Accepts unauthenticated devices. Only sensible on a trusted lab network. */
  allowAnonymous?: boolean
}

export function createAuthenticator(options: AuthenticatorOptions) {
  const devices = new Map((options.devices ?? []).map((device) => [device.deviceId, device]))
  const sharedToken = options.sharedToken
  const allowAnonymous = options.allowAnonymous === true

  return (credentials: { deviceId: string; clientId: string; token?: string }): boolean => {
    const known = devices.get(credentials.deviceId)
    if (known?.token !== undefined) return secureEquals(credentials.token, known.token)
    // A device listed without a token is enrolled but unprotected; it still has
    // to satisfy the shared token when one is configured.
    if (sharedToken !== undefined) return secureEquals(credentials.token, sharedToken)
    if (known) return true
    return allowAnonymous
  }
}

function secureEquals(candidate: string | undefined, expected: string): boolean {
  if (typeof candidate !== 'string') return false
  const left = Buffer.from(candidate, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  if (left.length !== right.length) {
    // Compare against itself so the answer still costs the same work.
    timingSafeEqual(left, left)
    return false
  }
  return timingSafeEqual(left, right)
}
