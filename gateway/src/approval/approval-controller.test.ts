import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STACKCHAN_EVENT_SCHEMA, type StackchanGatewayEvent, taskStatus } from '../protocol/stackchan-event-v1.ts'
import { createApprovalController } from './approval-controller.ts'

/** Deterministic stand-in for setTimeout/clearTimeout: timers fire only when the test says so. */
function createFakeScheduler() {
  const timers: Array<{ cb: () => void; cleared: boolean }> = []
  return {
    scheduler: {
      set(cb: () => void) {
        const id = timers.length
        timers.push({ cb, cleared: false })
        return id
      },
      clear(handle: unknown) {
        const entry = timers[handle as number]
        if (entry) entry.cleared = true
      },
    },
    fire(id: number) {
      const entry = timers[id]
      if (entry && !entry.cleared) entry.cb()
    },
    isCleared(id: number) {
      return timers[id]?.cleared ?? true
    },
  }
}

function idSequence(prefix = 'req'): () => string {
  let n = 0
  return () => `${prefix}-${n++}`
}

test('requestApproval sends approval.request and resolves ok on approve, sending approval.resolved', async () => {
  const sent: StackchanGatewayEvent[] = []
  const { scheduler } = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler,
    createRequestId: idSequence(),
  })

  const pending = controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: 'd' })
  assert.equal(sent[0]?.type, 'approval.request')

  const consumed = controller.handleDeviceEvent({
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId: 'req-0',
    decision: 'approve',
  })
  assert.equal(consumed, true)

  assert.deepEqual(await pending, { status: 'ok', result: undefined })
  assert.equal(sent[1]?.type, 'approval.resolved')
})

test('requestApproval resolves declined on decline, sending approval.resolved', async () => {
  const sent: StackchanGatewayEvent[] = []
  const { scheduler } = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler,
    createRequestId: idSequence(),
  })

  const pending = controller.requestApproval({ kind: 'fileChange', title: 't', summary: 's', detail: 'd' })
  controller.handleDeviceEvent({
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId: 'req-0',
    decision: 'decline',
  })

  assert.deepEqual(await pending, { status: 'declined', message: 'Declined by operator' })
  assert.equal(sent[1]?.type, 'approval.resolved')
})

test('a timed-out request is suspended and resolves declined', async () => {
  const sent: StackchanGatewayEvent[] = []
  const fake = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler: fake.scheduler,
    createRequestId: idSequence(),
  })

  const pending = controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: 'd' })
  fake.fire(0)

  assert.deepEqual(await pending, { status: 'declined', message: 'Approval request timed out' })
  assert.ok(sent.some((event) => event.type === 'approval.suspended'))
})

test('approval.presented is consumed but does not resolve the request', async () => {
  const sent: StackchanGatewayEvent[] = []
  const fake = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler: fake.scheduler,
    createRequestId: idSequence(),
  })

  const pending = controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: 'd' })
  const consumed = controller.handleDeviceEvent({
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.presented',
    requestId: 'req-0',
  })
  assert.equal(consumed, true)

  // Presentation alone never resolves it; only a response or the timeout does.
  fake.fire(0)
  assert.equal((await pending).status, 'declined')
})

test('close suspends every outstanding request and resolves each declined', async () => {
  const sent: StackchanGatewayEvent[] = []
  const fake = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler: fake.scheduler,
    createRequestId: idSequence(),
  })

  const first = controller.requestApproval({ kind: 'command', title: 't1', summary: 's1', detail: 'd1' })
  const second = controller.requestApproval({ kind: 'fileChange', title: 't2', summary: 's2', detail: 'd2' })
  controller.close()

  const [outcomeA, outcomeB] = await Promise.all([first, second])
  assert.deepEqual(outcomeA, { status: 'declined', message: 'Gateway closing' })
  assert.deepEqual(outcomeB, { status: 'declined', message: 'Gateway closing' })
  assert.equal(sent.filter((event) => event.type === 'approval.suspended').length, 2)
  assert.ok(fake.isCleared(0))
  assert.ok(fake.isCleared(1))
})

test('settling a request clears its timer so it never fires afterward', async () => {
  const sent: StackchanGatewayEvent[] = []
  const fake = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler: fake.scheduler,
    createRequestId: idSequence(),
  })

  const pending = controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: 'd' })
  controller.handleDeviceEvent({
    schema: STACKCHAN_EVENT_SCHEMA,
    type: 'approval.response',
    requestId: 'req-0',
    decision: 'approve',
  })
  await pending
  assert.ok(fake.isCleared(0))

  // Firing the (already-cleared) timer must not send a second suspension/resolution.
  fake.fire(0)
  assert.equal(sent.filter((event) => event.type === 'approval.suspended').length, 0)
})

test('requestApproval truncates an over-long detail and marks it truncated', () => {
  const sent: StackchanGatewayEvent[] = []
  const { scheduler } = createFakeScheduler()
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    scheduler,
    detailLimit: 5,
    createRequestId: idSequence(),
  })

  void controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: '0123456789' })
  const request = sent[0]
  assert.equal(request?.type, 'approval.request')
  if (request?.type === 'approval.request') {
    assert.equal(request.detail, '01234')
    assert.equal(request.truncated, true)
  }
})

test('requestApproval leaves a short detail untouched', () => {
  const sent: StackchanGatewayEvent[] = []
  const { scheduler } = createFakeScheduler()
  const controller = createApprovalController({ send: (event) => sent.push(event), scheduler, detailLimit: 20 })

  void controller.requestApproval({ kind: 'command', title: 't', summary: 's', detail: 'short' })
  const request = sent[0]
  assert.equal(request?.type, 'approval.request')
  if (request?.type === 'approval.request') {
    assert.equal(request.detail, 'short')
    assert.equal(request.truncated, false)
  }
})

test('handleDeviceEvent returns false for an unknown requestId or an unrelated event', () => {
  const controller = createApprovalController({ send: () => {} })
  assert.equal(
    controller.handleDeviceEvent({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'approval.response',
      requestId: 'never-requested',
      decision: 'approve',
    }),
    false,
  )
  assert.equal(
    controller.handleDeviceEvent({
      schema: STACKCHAN_EVENT_SCHEMA,
      type: 'conversation.start',
      requestId: 'x',
      source: 'headTouch',
      gesture: 'forwardSwipe',
    }),
    false,
  )
})

test('beginTask emits running then idle exactly once each, and end() is idempotent', () => {
  const sent: StackchanGatewayEvent[] = []
  const controller = createApprovalController({ send: (event) => sent.push(event) })

  const task = controller.beginTask('req-x')
  assert.deepEqual(sent, [taskStatus('req-x', 'running')])

  task.end()
  task.end()
  assert.deepEqual(sent, [taskStatus('req-x', 'running'), taskStatus('req-x', 'idle')])
})

test('beginTask without a requestId generates one and returns it', () => {
  const sent: StackchanGatewayEvent[] = []
  const controller = createApprovalController({
    send: (event) => sent.push(event),
    createRequestId: idSequence('task'),
  })

  const task = controller.beginTask()
  assert.equal(task.requestId, 'task-0')
  assert.deepEqual(sent, [taskStatus('task-0', 'running')])
})
