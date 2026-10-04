import assert from 'node:assert/strict'
import test from 'node:test'
import { createInbox } from './inbox.ts'

test('pairing gates messages; retries, read/reply/delete and expiry retain their semantics', () => {
  let now = 1000
  let sequence = 0
  const inbox = createInbox({
    devices: [{ deviceId: 'robot', token: 'secret' }],
    now: () => now,
    random: () => (++sequence).toString().padStart(12, '0') + 'token',
  })
  assert.throws(() => inbox.device('robot', 'wrong', 'poll'), /unauthorized/)
  assert.throws(() => inbox.send('robot', 'secret', 'id', 'thanks'), /unauthorized/)
  const code = inbox.device('robot', 'secret', 'pair') as { code: string }
  const { token } = inbox.claim('robot', code.code, 'Friend')
  assert.throws(() => inbox.claim('robot', code.code, 'Other'), /unauthorized/)
  assert.equal(inbox.send('robot', token, 'id', 'thanks').accepted, true)
  assert.equal(inbox.send('robot', token, 'id', 'thanks').accepted, false)
  assert.equal(inbox.status('robot', token).connected, false)
  const { entries } = inbox.device('robot', 'secret', 'poll') as { entries: { id: string; text: string }[] }
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.text, 'ありがとう')
  assert.equal(inbox.status('robot', token).connected, true)
  const id = entries[0]?.id
  inbox.device('robot', 'secret', 'read', { id })
  inbox.device('robot', 'secret', 'reply', { id })
  assert.equal(inbox.status('robot', token).entries[0]?.reply, 'thanks')
  inbox.device('robot', 'secret', 'delete', { id })
  assert.equal(inbox.send('robot', token, 'id', 'thanks').accepted, false)
  now += 3600001
  assert.equal(inbox.status('robot', token).entries.length, 0)
  assert.equal(inbox.send('robot', token, 'id', 'thanks').accepted, false)
  inbox.device('robot', 'secret', 'revoke')
  assert.throws(() => inbox.send('robot', token, 'other', 'hello'), /unauthorized/)
})

test('notifications are authenticated, bounded and independent from message senders', () => {
  const inbox = createInbox({ devices: [{ deviceId: 'robot', token: 'secret' }] })
  assert.throws(() => inbox.build('robot', undefined, 'one'), /unauthorized/)
  for (let i = 0; i < 16; i++) assert.equal(inbox.build('robot', 'secret', String(i)).accepted, true)
  assert.equal(inbox.build('robot', 'secret', '0').accepted, false)
  assert.throws(() => inbox.build('robot', 'secret', 'overflow'), /capacity/)
  assert.throws(() => inbox.build('robot', 'secret', '../invalid'), /invalid/)
})

test('pair codes expire, lock after guesses and remain isolated per device', () => {
  let time = 1
  const inbox = createInbox({
    devices: [
      { deviceId: 'a', token: 'one' },
      { deviceId: 'b', token: 'two' },
    ],
    now: () => time,
  })
  const code = (inbox.device('a', 'one', 'pair') as { code: string }).code
  assert.throws(() => inbox.claim('b', code, 'friend'), /unauthorized/)
  for (let index = 0; index < 5; index++) assert.throws(() => inbox.claim('a', 'bad', 'friend'), /unauthorized/)
  assert.throws(() => inbox.claim('a', code, 'friend'), /unauthorized/)
  const next = (inbox.device('a', 'one', 'pair') as { code: string }).code
  time += 120001
  assert.throws(() => inbox.claim('a', next, 'friend'), /unauthorized/)
})
