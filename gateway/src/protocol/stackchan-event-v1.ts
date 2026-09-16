/**
 * Gateway-side mirror of the Stack-chan control plane (`stackchan.event.v1`).
 *
 * The device implementation lives in
 * `firmware/host/app/remote-session/application-event.ts`. The two files are
 * independently maintained on purpose: the firmware copy runs on XS and must
 * stay free of Node types. `protocol/contract.test.ts` pins the shared wire
 * constants so the pair cannot drift silently.
 *
 * Direction naming follows the Gateway: `Device*` events arrive from Stack-chan,
 * `Gateway*` events are sent to it.
 */

export const STACKCHAN_EVENT_SCHEMA = 'stackchan.event.v1'

export type RemoteConversationState = 'standby' | 'connecting' | 'listening' | 'recognizing' | 'speaking' | 'blocked'

export type ApprovalKind = 'command' | 'fileChange'
export type ApprovalDecision = 'approve' | 'decline'
export type TaskExecutionState = 'idle' | 'running'

export type ConversationStart = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.start'
  requestId: string
  source: 'headTouch'
  gesture: 'forwardSwipe'
}

export type ConversationStop = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.stop'
  requestId: string
  source: 'headTouch'
  gesture: 'backwardSwipe'
}

export type ConversationResult = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'conversation.result'
  requestId: string
  success: boolean
  state: RemoteConversationState
  error?: string
}

export type ApprovalRequest = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.request'
  requestId: string
  kind: ApprovalKind
  title: string
  summary: string
  detail: string
  truncated: boolean
}

export type ApprovalPresented = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.presented'
  requestId: string
}

export type ApprovalResponse = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.response'
  requestId: string
  decision: ApprovalDecision
}

export type ApprovalResolved = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.resolved'
  requestId: string
  message?: string
}

export type ApprovalSuspended = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'approval.suspended'
  requestId: string
}

export type TaskStatus = {
  schema: typeof STACKCHAN_EVENT_SCHEMA
  type: 'task.status'
  requestId: string
  state: TaskExecutionState
}

/** Control-plane events Stack-chan sends to the Gateway. */
export type StackchanDeviceEvent = ConversationStart | ConversationStop | ApprovalPresented | ApprovalResponse

/** Control-plane events the Gateway sends to Stack-chan. */
export type StackchanGatewayEvent =
  | ConversationResult
  | ApprovalRequest
  | ApprovalResolved
  | ApprovalSuspended
  | TaskStatus

export function isStackchanEventEnvelope(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.schema === STACKCHAN_EVENT_SCHEMA
}

export function parseStackchanDeviceEvent(value: unknown): StackchanDeviceEvent | undefined {
  if (!isStackchanEventEnvelope(value) || !hasRequestId(value)) return
  switch (value.type) {
    case 'conversation.start':
      if (value.source !== 'headTouch' || value.gesture !== 'forwardSwipe') return
      return value as ConversationStart
    case 'conversation.stop':
      if (value.source !== 'headTouch' || value.gesture !== 'backwardSwipe') return
      return value as ConversationStop
    case 'approval.presented':
      return value as ApprovalPresented
    case 'approval.response':
      if (value.decision !== 'approve' && value.decision !== 'decline') return
      return value as ApprovalResponse
    default:
      return
  }
}

export function conversationResult(
  requestId: string,
  success: boolean,
  state: RemoteConversationState,
  error?: string,
): ConversationResult {
  const event: ConversationResult = {
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'conversation.result',
    requestId,
    success,
    state,
  }
  if (error !== undefined) event.error = error
  return event
}

export function approvalRequest(request: {
  requestId: string
  kind: ApprovalKind
  title: string
  summary: string
  detail: string
  truncated: boolean
}): ApprovalRequest {
  return { schema: STACKCHAN_EVENT_SCHEMA, type: 'approval.request', ...request }
}

export function approvalResolved(requestId: string, message?: string): ApprovalResolved {
  const event: ApprovalResolved = { schema: STACKCHAN_EVENT_SCHEMA, type: 'approval.resolved', requestId }
  if (message !== undefined) event.message = message
  return event
}

export function approvalSuspended(requestId: string): ApprovalSuspended {
  return { schema: STACKCHAN_EVENT_SCHEMA, type: 'approval.suspended', requestId }
}

export function taskStatus(requestId: string, state: TaskExecutionState): TaskStatus {
  return { schema: STACKCHAN_EVENT_SCHEMA, type: 'task.status', requestId, state }
}

export function isRemoteConversationState(value: unknown): value is RemoteConversationState {
  return (
    value === 'standby' ||
    value === 'connecting' ||
    value === 'listening' ||
    value === 'recognizing' ||
    value === 'speaking' ||
    value === 'blocked'
  )
}

function hasRequestId(value: Record<string, unknown>): value is Record<string, unknown> & { requestId: string } {
  return typeof value.requestId === 'string' && value.requestId.length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
