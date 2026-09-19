import fetch from 'fetch'
import { HttpServerService, Response } from 'http-server-service'
import { equal } from 'testing/assert'
import Timer from 'timer'

const app = new HttpServerService({ port: 8082 })

app.get('/response', (_c) => {
  return new Response('Thank you for coming', {
    status: 201,
    headers: {
      'X-Message': 'Hello',
      'Content-Type': 'text/plain',
    },
  })
})

app.get('/header', (c) => {
  const userAgent = c.req.header('User-Agent')
  return c.text(`Your UserAgent is ${userAgent}`)
})

app.get('/query', (c) => {
  const text = c.req.query('text')
  return c.text(`Your  query is ${text}`)
})

app.get('/json', (c) => {
  const posts = [
    { id: 1, title: 'Good Morning' },
    { id: 2, title: 'Good Afternoon' },
    { id: 3, title: 'Good Evening' },
    { id: 4, title: 'Good Night' },
  ]
  return c.json(posts)
})

app.post('/post/text', async (c) => {
  const text = await c.req.text()
  return c.json({ message: `${text} received!` }, 201)
})

app.post('/post/json', async (c) => {
  const json = await c.req.json()
  return c.json(json)
})

app.post('/post/form', async (c) => {
  const form = await c.req.formData()
  return c.text(`form: ${JSON.stringify(form)}`)
})

app.get('/failure', () => {
  throw new Error('test failure')
})
app.get('/keep-alive', () => new Response('custom', { headers: { Connection: 'keep-alive' } }))

async function verifySequentialRequests() {
  await new Promise((resolve) => Timer.set(resolve, 100))
  // The SDK fetch caches its client by origin. Request two used to abort XS.
  for (const [path, status, body] of [
    ['/response', 201, 'Thank you for coming'],
    ['/keep-alive', 200, 'custom'],
    ['/missing', 404, 'Resource Not Found'],
    ['/failure', 500, 'Internal Server Error'],
    ['/response', 201, 'Thank you for coming'],
  ]) {
    const response = await fetch(`http://127.0.0.1:8082${path}`)
    equal(response.status, status, path)
    equal(response.headers.get('connection'), 'close', path)
    equal(await response.text(), body, path)
    // SDK fetch evicts its cached client on the asynchronous socket-close event,
    // not on body completion. Let that event run before the next request.
    await new Promise((resolve) => Timer.set(resolve, 100))
  }
  equal(new Response('default').status, 200)
  trace('ok\n')
}
void verifySequentialRequests().catch((error) => {
  throw error
})
