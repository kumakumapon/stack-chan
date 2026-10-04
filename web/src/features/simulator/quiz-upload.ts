import { BlePreferenceClient } from '@/services/preferences/ble-preference-client'
import { parseQuizDeck } from '../../../../firmware/host/app/workshop-model'

export async function uploadQuizToDevice(json: string): Promise<void> {
  const value = JSON.stringify(parseQuizDeck(json))
  let waiting: { resolve(): void; reject(error: Error): void; sequence: number } | undefined
  let sequence = 0
  const client = new BlePreferenceClient({
    deviceName: 'STK',
    onValue(value) {
      if (value.prop !== 'workshop.reply' || typeof value.value !== 'string' || !waiting) return
      try {
        const reply = JSON.parse(value.value)
        if (!reply.ok) waiting.reject(Error('本体が教材を受け付けませんでした'))
        else if (reply.sequence === waiting.sequence) waiting.resolve()
      } catch {
        waiting.reject(Error('本体からの応答を読み取れませんでした'))
      }
    },
  })
  client.onDisconnected = () => waiting?.reject(Error('Bluetooth接続が切れました'))
  const send = async (command: Record<string, unknown>) => {
    const next = ++sequence
    let timer: ReturnType<typeof setTimeout> | undefined
    const response = new Promise<void>((resolve, reject) => {
      waiting = { resolve, reject, sequence: next }
      timer = setTimeout(() => reject(Error('本体からの確認がありません')), 5000)
    })
    try {
      await Promise.all([
        client.send({ _batch: { 'workshop.command': JSON.stringify({ ...command, sequence: next }) } }),
        response,
      ])
    } finally {
      clearTimeout(timer)
      waiting = undefined
    }
  }
  try {
    await client.connect()
    await send({ action: 'begin' })
    for (let offset = 0; offset < value.length; offset += 500)
      await send({ action: 'append', index: offset / 500, text: value.slice(offset, offset + 500) })
    await send({ action: 'commit' })
  } finally {
    await client.disconnect()
  }
}
