import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type DesktopSettings, defaultSettings, parseSettings, record, text } from './settings.ts'

export type HistoryTurn = { at: string; provider: string; user: string; assistant: string }
export type DesktopStore = Awaited<ReturnType<typeof openDesktopStore>>

/** One atomic file, serialized writes, and no device id used as a filesystem path. */
export async function openDesktopStore(directory: string) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'desktop.json')
  let settings = defaultSettings()
  let history: Record<string, HistoryTurn[]> = Object.create(null)
  try {
    const saved = record(JSON.parse(await readFile(path, 'utf8')))
    settings = parseSettings(saved.settings)
    for (const [id, entries] of Object.entries(record(saved.history))) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || !Array.isArray(entries)) throw new Error('保存履歴が不正です')
      history[id] = entries.slice(-1000).map((value) => {
        const turn = record(value)
        return {
          at: text(turn.at, '日時', 40),
          provider: text(turn.provider, 'プロバイダー', 40),
          user: text(turn.user, '発話', 4000),
          assistant: text(turn.assistant, '返答', 600),
        }
      })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  let queue = Promise.resolve()
  const save = (next: () => { settings: DesktopSettings; history: Record<string, HistoryTurn[]> }) => {
    const operation = queue.then(async () => {
      const { settings: nextSettings, history: nextHistory } = next()
      await writeFile(`${path}.tmp`, JSON.stringify({ settings: nextSettings, history: nextHistory }, null, 2), {
        mode: 0o600,
      })
      await rename(`${path}.tmp`, path)
      settings = nextSettings
      history = nextHistory
    })
    queue = operation.catch(() => {})
    return operation
  }
  // First-run token persists before any device is accepted.
  await save(() => ({ settings, history }))
  return {
    settings: () => structuredClone(settings),
    history: (deviceId: string) => structuredClone(history[deviceId] ?? []),
    async update(value: unknown) {
      const next = parseSettings(value)
      await save(() => ({ settings: next, history }))
    },
    async append(deviceId: string, turn: HistoryTurn) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(deviceId)) throw new Error('本体IDが不正です')
      await save(() => ({
        settings,
        history: { ...history, [deviceId]: [...(history[deviceId] ?? []), structuredClone(turn)].slice(-1000) },
      }))
    },
    async clear(deviceId: string) {
      await save(() => {
        const next = { ...history }
        delete next[deviceId]
        return { settings, history: next }
      })
    },
  }
}
