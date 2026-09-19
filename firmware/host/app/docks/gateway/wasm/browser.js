import Timer from 'timer'

const nativeExchange = native('xs_gateway_exchange')
export function exchange(request) {
  const result = JSON.parse(nativeExchange(JSON.stringify(request)))
  if (result?.error) throw new Error(result.error)
  return result
}
export function createGatewaySocket(options) {
  exchange({ action: 'open', secure: options.secure, host: options.host, port: options.port, path: options.path })
  let closed = false
  const timer = Timer.repeat(() => {
    for (let i = 0; i < 16 && !closed; i++) {
      const event = exchange({ action: 'socket' })
      if (!event) break
      if (event.type === 'ready') options.onReady()
      if (event.type === 'message') options.onMessage(event.data)
      if (event.type === 'closed') {
        closed = true
        Timer.clear(timer)
        options.onClosed(event.reason)
      }
    }
  }, 20)
  return {
    write(data) {
      exchange({ action: 'write', data })
    },
    close() {
      closed = true
      Timer.clear(timer)
      exchange({ action: 'close' })
    },
  }
}
export default exchange
