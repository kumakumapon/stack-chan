import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createInbox, handleInbox } from './inbox.ts'

test('HTTP inbox enforces authentication, exact origins and bounded payloads', async (t) => {
  const inbox = createInbox({ devices: [{ deviceId: 'robot', token: 'secret' }] })
  const server = createServer((req, res) => {
    void handleInbox(req, res, inbox, ['http://localhost:5173']).then((handled) => {
      if (!handled) res.writeHead(404).end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))))
  const address = server.address() as { port: number }
  const url = `http://127.0.0.1:${address.port}/api/inbox/`
  const post = (action: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  assert.equal((await post('poll', { deviceId: 'robot' })).status, 401)
  assert.equal(
    (await post('poll', { deviceId: 'robot' }, { authorization: 'Bearer secret', origin: 'http://evil.local' })).status,
    403,
  )
  const poll = await post(
    'poll',
    { deviceId: 'robot' },
    { authorization: 'Bearer secret', origin: 'http://localhost:5173' },
  )
  assert.equal(poll.status, 200)
  assert.equal(poll.headers.get('access-control-allow-origin'), 'http://localhost:5173')
  assert.deepEqual(await poll.json(), { entries: [] })
  assert.equal(
    (await post('build', { deviceId: 'robot', id: 'x', extra: 'a'.repeat(5000) }, { authorization: 'Bearer secret' }))
      .status,
    413,
  )
  assert.equal((await post('build', null)).status, 400)
  assert.equal(
    (await post('build', { deviceId: 'robot', id: 'build-1' }, { authorization: 'Bearer secret' })).status,
    200,
  )
  const again = await post('build', { deviceId: 'robot', id: 'build-1' }, { authorization: 'Bearer secret' })
  assert.deepEqual(await again.json(), { accepted: false })
})
