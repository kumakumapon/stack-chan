import type { MiniAppStorage } from './life-quest.js'
import { parseQuizDeck } from './workshop-model.js'

/** Short acknowledged BLE commands; only commit touches the installed deck. */
export function createQuizTransfer(storage: MiniAppStorage) {
  let chunks: string[] | undefined
  return (raw: string): string => {
    try {
      if (typeof raw !== 'string' || raw.length > 1600) throw Error('command too large')
      const input = JSON.parse(raw)
      if (input.action === 'begin') chunks = []
      else if (input.action === 'append') {
        if (
          !chunks ||
          input.index !== chunks.length ||
          typeof input.text !== 'string' ||
          input.text.length > 500 ||
          chunks.length >= 40
        )
          throw Error('invalid chunk')
        chunks.push(input.text)
      } else if (input.action === 'commit') {
        if (!chunks) throw Error('no upload')
        const deck = parseQuizDeck(chunks.join(''))
        storage.set(JSON.stringify(deck))
        chunks = undefined
      } else if (input.action === 'cancel') chunks = undefined
      else throw Error('invalid command')
      return JSON.stringify({ ok: true, sequence: input.sequence })
    } catch {
      chunks = undefined
      return JSON.stringify({ ok: false })
    }
  }
}
