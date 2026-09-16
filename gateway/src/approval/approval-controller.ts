/**
 * Owns the `approval.request -> approval.presented -> approval.response ->
 * approval.resolved` handshake, plus the `task.status` bracket around a running
 * tool call. Entirely in terms of the builders in `protocol/stackchan-event-v1.ts`
 * so the wire shape stays pinned by `protocol/contract.test.ts`.
 *
 * The device side (`firmware/host/app/remote-session/approval-session.ts`)
 * retries `approval.response` until it sees `approval.resolved`; this
 * controller is the thing that eventually sends it.
 */

import {
  type ApprovalKind,
  approvalRequest,
  approvalResolved,
  approvalSuspended,
  type StackchanDeviceEvent,
  type StackchanGatewayEvent,
  taskStatus,
} from '../protocol/stackchan-event-v1.ts'
import type { ToolCallOutcome } from '../tools/tool-types.ts'

/** No response within this window suspends the request rather than hanging the caller forever. */
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_DETAIL_LIMIT = 2000

export type ApprovalScheduler = {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export type ApprovalController = {
  requestApproval(request: {
    kind: ApprovalKind
    title: string
    summary: string
    detail: string
  }): Promise<ToolCallOutcome>
  /** Consumes `approval.presented`/`approval.response`; returns whether the event was ours. */
  handleDeviceEvent(event: StackchanDeviceEvent): boolean
  /** Brackets a running tool call with `task.status` running/idle. `end()` is idempotent. */
  beginTask(requestId?: string): { requestId: string; end(): void }
  /** Suspends every outstanding request and resolves it declined, so no caller hangs. */
  close(): void
}

export type ApprovalControllerOptions = {
  send(event: StackchanGatewayEvent): void
  timeoutMs?: number
  scheduler?: ApprovalScheduler
  createRequestId?: () => string
  detailLimit?: number
}

type PendingApproval = {
  requestId: string
  resolve(outcome: ToolCallOutcome): void
  timer: unknown
  presented: boolean
  settled: boolean
}

export function createApprovalController(options: ApprovalControllerOptions): ApprovalController {
  const send = options.send
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const detailLimit = options.detailLimit ?? DEFAULT_DETAIL_LIMIT
  const scheduler = options.scheduler ?? defaultScheduler()
  const createRequestId = options.createRequestId ?? defaultCreateRequestId
  const pending = new Map<string, PendingApproval>()

  const settle = (entry: PendingApproval, outcome: ToolCallOutcome) => {
    if (entry.settled) return
    entry.settled = true
    scheduler.clear(entry.timer)
    pending.delete(entry.requestId)
    entry.resolve(outcome)
  }

  const suspend = (entry: PendingApproval, message: string) => {
    if (entry.settled) return
    send(approvalSuspended(entry.requestId))
    settle(entry, { status: 'declined', message })
  }

  return {
    requestApproval(request) {
      const requestId = createRequestId()
      const { detail, truncated } = truncateDetail(request.detail, detailLimit)
      return new Promise<ToolCallOutcome>((resolve) => {
        const entry: PendingApproval = { requestId, resolve, timer: undefined, presented: false, settled: false }
        entry.timer = scheduler.set(() => suspend(entry, 'Approval request timed out'), timeoutMs)
        pending.set(requestId, entry)
        send(
          approvalRequest({
            requestId,
            kind: request.kind,
            title: request.title,
            summary: request.summary,
            detail,
            truncated,
          }),
        )
      })
    },

    handleDeviceEvent(event) {
      switch (event.type) {
        case 'approval.presented': {
          const entry = pending.get(event.requestId)
          if (!entry) return false
          entry.presented = true
          return true
        }
        case 'approval.response': {
          const entry = pending.get(event.requestId)
          if (!entry) return false
          send(approvalResolved(entry.requestId))
          settle(
            entry,
            event.decision === 'approve'
              ? { status: 'ok', result: undefined }
              : { status: 'declined', message: 'Declined by operator' },
          )
          return true
        }
        default:
          return false
      }
    },

    beginTask(requestId = createRequestId()) {
      send(taskStatus(requestId, 'running'))
      let ended = false
      return {
        requestId,
        end() {
          if (ended) return
          ended = true
          send(taskStatus(requestId, 'idle'))
        },
      }
    },

    close() {
      for (const entry of [...pending.values()]) suspend(entry, 'Gateway closing')
    },
  }
}

function truncateDetail(detail: string, limit: number): { detail: string; truncated: boolean } {
  if (detail.length <= limit) return { detail, truncated: false }
  return { detail: detail.slice(0, limit), truncated: true }
}

function defaultCreateRequestId(): string {
  return crypto.randomUUID()
}

function defaultScheduler(): ApprovalScheduler {
  return {
    set(callback, ms) {
      const handle = setTimeout(callback, ms)
      if (typeof handle.unref === 'function') handle.unref()
      return handle
    },
    clear(handle) {
      clearTimeout(handle as NodeJS.Timeout)
    },
  }
}
