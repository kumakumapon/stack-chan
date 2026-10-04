import Timer from 'timer'

const nativeExchange = native('xs_workshop_exchange')
export function exchange(request) {
  const result = JSON.parse(nativeExchange(JSON.stringify(request)))
  if (result?.error) throw new Error(result.error)
  return result
}
export function workshopRequest(url, token, body) {
  const { id } = exchange({ action: 'http', url, token, body })
  return new Promise((resolve, reject) => {
    let attempts = 0
    const timer = Timer.repeat(() => {
      try {
        const result = exchange({ action: 'httpResult', id })
        if (!result && attempts++ < 300) return
        Timer.clear(timer)
        if (!result || result.error) reject(new Error(result?.error ?? 'Gateway timeout'))
        else resolve(result.value)
      } catch (error) {
        Timer.clear(timer)
        reject(error)
      }
    }, 50)
  })
}
export function installWasmWorkshop(service, context) {
  exchange({ action: 'ready' })
  const timer = Timer.repeat(() => {
    const command = exchange({ action: 'take' })
    if (!command) return
    try {
      exchange({ action: 'result', id: command.id, value: service.command(command.value) })
    } catch (error) {
      exchange({ action: 'result', id: command.id, error: String(error) })
    }
  }, 50)
  context.lifecycle.onClose(() => Timer.clear(timer))
}
