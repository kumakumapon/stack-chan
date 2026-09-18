// Pure logic shared by the WASM performance/reaction simulator bridge. This
// module owns no native() calls and no Timer, so it is Node-testable; the thin
// performance-bridge.js next to it only wires native() readers/writers and a
// Timer.repeat poll loop around the functions below (see input-sensor-bridge.ts
// for the same split on the input side).

import type { PerformanceName, PerformanceOptions, PerformancePlayResult, PerformanceStatus } from 'performance-types'
import type { ReactionName, ReactionOptions, ReactionPlayResult, ReactionStatus } from 'reaction-types'

export type PerformanceBridgeTarget = 'reaction' | 'performance'
export type PerformanceBridgeAction = 'play' | 'cancel'

export type PerformanceBridgeCommandOptions = {
  intensity?: number
  restore?: boolean
}

/**
 * A command as it crosses the browser -> XS boundary through take(), one JSON
 * object per queued call to context.reaction/performance play()/cancel().
 */
export type PerformanceBridgeCommand = {
  target: PerformanceBridgeTarget
  action: PerformanceBridgeAction
  name?: string
  options?: PerformanceBridgeCommandOptions
}

export type PerformanceBridgeDispatchResult = {
  ok: boolean
  error?: string
  /** Set only for a 'cancel' action: whether anything was actually playing. */
  cancelled?: boolean
}

type ReactionLikeCapability = {
  readonly names: readonly ReactionName[]
  play(name: ReactionName, options?: ReactionOptions): ReactionPlayResult
  cancel(): boolean
  status(): ReactionStatus
}

type PerformanceLikeCapability = {
  readonly names: readonly PerformanceName[]
  play(name: PerformanceName, options?: PerformanceOptions): PerformancePlayResult
  cancel(): boolean
  status(): PerformanceStatus
}

/**
 * The slice of StackchanContext this bridge dispatches onto. A structural
 * type rather than StackchanContext itself, so this module never depends on
 * capabilities.ts (owned elsewhere) and stays trivially fakeable in tests.
 */
export type PerformanceBridgeContext = {
  reaction: ReactionLikeCapability
  performance: PerformanceLikeCapability
}

export type PerformanceBridgeStatusPayload = {
  reaction: ReactionStatus
  performance: PerformanceStatus
}

const TARGETS: readonly PerformanceBridgeTarget[] = ['reaction', 'performance']
const ACTIONS: readonly PerformanceBridgeAction[] = ['play', 'cancel']

function isTarget(value: unknown): value is PerformanceBridgeTarget {
  return typeof value === 'string' && (TARGETS as readonly string[]).includes(value)
}

function isAction(value: unknown): value is PerformanceBridgeAction {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value)
}

function sanitizeOptions(value: unknown): PerformanceBridgeCommandOptions | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>
  const options: PerformanceBridgeCommandOptions = {}
  if (typeof source.intensity === 'number') options.intensity = source.intensity
  if (typeof source.restore === 'boolean') options.restore = source.restore
  return options
}

/**
 * Parses one command JSON string (as returned by the browser's take()).
 * Returns undefined for anything that fails to parse or does not shape up as
 * a command, so the caller can trace and skip it instead of throwing on a
 * malformed or version-skewed browser payload.
 */
export function parseCommand(json: string): PerformanceBridgeCommand | undefined {
  if (typeof json !== 'string' || json.length === 0) return undefined

  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined

  const source = value as Record<string, unknown>
  if (!isTarget(source.target) || !isAction(source.action)) return undefined
  if (source.name !== undefined && typeof source.name !== 'string') return undefined

  const command: PerformanceBridgeCommand = { target: source.target, action: source.action }
  if (typeof source.name === 'string') command.name = source.name
  const options = sanitizeOptions(source.options)
  if (options) command.options = options
  return command
}

function dispatchOn<Name extends string>(
  command: PerformanceBridgeCommand,
  capability: {
    readonly names: readonly Name[]
    play(name: Name, options?: PerformanceBridgeCommandOptions): { ok: boolean; error?: string }
    cancel(): boolean
  },
): PerformanceBridgeDispatchResult {
  if (command.action === 'cancel') {
    return { ok: true, cancelled: capability.cancel() }
  }

  if (!command.name) return { ok: false, error: 'play requires a name' }
  if (!(capability.names as readonly string[]).includes(command.name)) {
    return { ok: false, error: `unknown ${command.target} name: ${command.name}` }
  }
  return capability.play(command.name as Name, command.options)
}

/** Validates `command` against the live capability names and dispatches play()/cancel(). */
export function dispatchCommand(
  command: PerformanceBridgeCommand,
  context: PerformanceBridgeContext,
): PerformanceBridgeDispatchResult {
  if (command.target === 'reaction') return dispatchOn(command, context.reaction)
  return dispatchOn(command, context.performance)
}

/** A status snapshot for both capabilities, ready to hand to Host.Performance.setStatus(). */
export function buildStatusPayload(context: PerformanceBridgeContext): PerformanceBridgeStatusPayload {
  return {
    reaction: context.reaction.status(),
    performance: context.performance.status(),
  }
}

export function serializeStatus(context: PerformanceBridgeContext): string {
  return JSON.stringify(buildStatusPayload(context))
}

/** True while either capability has something active, for the bridge's idle-poll status cadence. */
export function isPerformanceBridgeActive(context: PerformanceBridgeContext): boolean {
  return context.reaction.status().active !== null || context.performance.status().active !== null
}
