export function createWorkshopBridge({ fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const queue = [],
    pending = new Map(),
    requests = new Map()
  let ready = false,
    sequence = 0,
    epoch = 0
  function reset() {
    ready = false
    epoch++
    queue.length = 0
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(Error('Simulator restarted'))
    }
    pending.clear()
    for (const item of requests.values()) item.controller.abort()
    requests.clear()
  }
  return {
    reset,
    command(value) {
      if (!ready) return Promise.reject(Error('Wait for the simulator to finish starting'))
      if (pending.size >= 4 || JSON.stringify(value).length > 24000)
        return Promise.reject(Error('Workshop request too large or busy'))
      const id = ++sequence
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          const index = queue.findIndex((item) => item.id === id)
          if (index >= 0) queue.splice(index, 1)
          reject(Error('Workshop request timed out'))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        queue.push({ id, value })
      })
    },
    exchange(request) {
      if (request.action === 'ready') {
        reset()
        ready = true
        return {}
      }
      if (request.action === 'take') return queue.shift() ?? null
      if (request.action === 'result') {
        const item = pending.get(request.id)
        if (item) {
          clearTimeout(item.timer)
          pending.delete(request.id)
          if (request.error) item.reject(Error(request.error))
          else item.resolve(request.value)
        }
        return {}
      }
      if (request.action === 'http') {
        if (requests.size >= 4) throw Error('Gateway busy')
        const url = new URL(request.url)
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          !url.pathname.startsWith('/api/inbox/')
        )
          throw Error('Invalid Gateway URL')
        const controller = new AbortController(),
          id = ++sequence,
          generation = epoch
        const item = { controller, result: null }
        requests.set(id, item)
        const timeout = setTimeout(() => controller.abort(), 10000)
        void (async () => {
          try {
            const response = await fetchImpl(url.href, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${request.token}` },
              body: JSON.stringify(request.body),
              signal: controller.signal,
              credentials: 'omit',
              redirect: 'error',
            })
            if (!response.ok) throw Error(`Gateway response ${response.status}`)
            const reader = response.body.getReader(),
              parts = []
            let length = 0
            for (;;) {
              const chunk = await reader.read()
              if (chunk.done) break
              length += chunk.value.byteLength
              if (length > 32768) {
                await reader.cancel()
                throw Error('Gateway response too large')
              }
              parts.push(chunk.value)
            }
            const bytes = new Uint8Array(length)
            let offset = 0
            for (const part of parts) {
              bytes.set(part, offset)
              offset += part.length
            }
            if (generation === epoch) item.result = { value: JSON.parse(new TextDecoder().decode(bytes)) }
          } catch (error) {
            if (generation === epoch) item.result = { error: error.message }
          } finally {
            clearTimeout(timeout)
          }
        })()
        return { id }
      }
      if (request.action === 'httpResult') {
        const item = requests.get(request.id)
        if (!item) return { error: 'Gateway request expired' }
        if (item.result) requests.delete(request.id)
        return item.result
      }
      throw Error('Unknown workshop bridge action')
    },
  }
}
