import type { MiniAppStorage } from './life-quest.js'

/** NVS strings have a per-entry limit. Commit a bank pointer only after every bounded chunk is written. */
export function chunkStorage(
  preference: { get(domain: string, key: string): unknown; set(domain: string, key: string, value: string): void },
  domain: string,
): MiniAppStorage {
  const metadata = () => {
    const raw = preference.get(domain, 'meta')
    if (raw === undefined) return undefined
    if (typeof raw !== 'string' || raw.length > 128) throw new Error('Invalid storage metadata')
    const value = JSON.parse(raw)
    if (
      ![0, 1].includes(value.bank) ||
      !Number.isInteger(value.count) ||
      value.count < 1 ||
      value.count > 23 ||
      !Number.isInteger(value.length) ||
      value.length < 1 ||
      value.length > 20000
    )
      throw new Error('Invalid storage metadata')
    return value as { bank: number; count: number; length: number }
  }
  return {
    get() {
      const meta = metadata()
      if (!meta) return undefined
      let text = ''
      for (let index = 0; index < meta.count; index++) {
        const chunk = preference.get(domain, `b${meta.bank}c${index}`)
        if (typeof chunk !== 'string' || chunk.length > 900) throw new Error('Invalid storage chunk')
        text += chunk
      }
      if (text.length !== meta.length) throw new Error('Incomplete saved data')
      return text
    },
    set(value) {
      if (typeof value !== 'string' || value.length < 1 || value.length > 20000)
        throw new Error('Saved data is too large')
      let old: ReturnType<typeof metadata>
      try {
        old = metadata()
      } catch {
        old = undefined
      }
      const bank = old?.bank === 0 ? 1 : 0
      let count = 0
      for (let start = 0; start < value.length; ) {
        let end = Math.min(start + 900, value.length)
        const last = value.charCodeAt(end - 1)
        if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--
        preference.set(domain, `b${bank}c${count++}`, value.slice(start, end))
        start = end
      }
      preference.set(domain, 'meta', JSON.stringify({ bank, count, length: value.length }))
    },
  }
}
