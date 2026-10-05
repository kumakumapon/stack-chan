import { Request } from 'http'
import Timer from 'timer'

/** Bound response memory and connection lifetime independently of the conversation transport. */
export function workshopRequest(url: string, token: string, body: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const match = /^http:\/\/([^/:]+)(?::([0-9]+))?(\/.*)$/.exec(url)
    if (!match) {
      reject(new Error('Use a LAN http:// Gateway for inbox'))
      return
    }
    let status = 0,
      bytes = 0,
      finished = false
    const fragments: ArrayBuffer[] = []
    const request = new Request({
      host: match[1],
      port: match[2] ? Number(match[2]) : 80,
      path: match[3],
      method: 'POST',
      headers: ['Content-Type', 'application/json', 'Authorization', `Bearer ${token}`],
      body: JSON.stringify(body),
    })
    const timer = Timer.set(() => fail('Gateway timeout'), 10000)
    const fail = (message: string) => {
      if (finished) return
      finished = true
      Timer.clear(timer)
      request.close()
      reject(new Error(message))
    }
    request.callback = (message: number, value: unknown) => {
      if (finished) return
      if (message === 1) status = Number(value)
      else if (message === 4) {
        const size = Number(value)
        if (bytes + size > 32768) {
          fail('Gateway response too large')
          return
        }
        const fragment = request.read(ArrayBuffer) as ArrayBuffer
        bytes += fragment.byteLength
        fragments.push(fragment)
      } else if (message === 5) {
        if (status !== 200) {
          fail(`Gateway response ${status}`)
          return
        }
        const buffer = new Uint8Array(bytes)
        let offset = 0
        for (const fragment of fragments) {
          buffer.set(new Uint8Array(fragment), offset)
          offset += fragment.byteLength
        }
        try {
          const result = JSON.parse(String.fromArrayBuffer(buffer.buffer))
          finished = true
          Timer.clear(timer)
          resolve(result)
        } catch {
          fail('Invalid Gateway response')
        }
      } else if (message < 0) fail('Gateway connection failed')
    }
  })
}
