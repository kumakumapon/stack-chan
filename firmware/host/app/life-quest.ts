export type MiniAppStorage = { get(): unknown; set(value: string): void }
export const LIFE_QUEST_DOMAIN = 'stackchan_quest'
export const LIFE_QUEST_KEY = 'state'
export const LIFE_QUEST_TASKS = ['tidy', 'read', 'prepare'] as const
export type LifeQuestSnapshot = Readonly<{
  done: readonly boolean[]
  complete: boolean
  celebrated: boolean
  celebration: boolean
  storageFailed: boolean
}>

/** A round is reset only by the user; this model never depends on wall clock time. */
export class LifeQuest {
  #done = [false, false, false]
  #celebrated = false
  #celebration = false
  #storageFailed = false
  #closed = false
  #storage: MiniAppStorage

  constructor(storage: MiniAppStorage) {
    this.#storage = storage
    try {
      const raw = storage.get()
      if (raw === undefined) return
      if (typeof raw !== 'string' || raw.length > 512) throw new Error('Invalid quest state')
      const saved = JSON.parse(raw)
      if (
        saved?.version !== 1 ||
        !Array.isArray(saved.done) ||
        saved.done.length !== LIFE_QUEST_TASKS.length ||
        !saved.done.every((item: unknown) => typeof item === 'boolean') ||
        typeof saved.celebrated !== 'boolean'
      )
        throw new Error('Invalid quest state')
      this.#done = saved.done.slice()
      // A completed saved round cannot celebrate again, even if the latch was inconsistent.
      this.#celebrated = saved.celebrated || this.#done.every(Boolean)
    } catch {
      this.#storageFailed = true
    }
  }

  snapshot(): LifeQuestSnapshot {
    return Object.freeze({
      done: Object.freeze(this.#done.slice()),
      complete: this.#done.every(Boolean),
      celebrated: this.#celebrated,
      celebration: this.#celebration,
      storageFailed: this.#storageFailed,
    })
  }

  /** Use the desired value rather than toggling: replaying a completion is idempotent. */
  setDone(index: number, done: boolean): boolean {
    if (this.#closed || !Number.isInteger(index) || index < 0 || index >= 3 || typeof done !== 'boolean') return false
    if (this.#done[index] === done) return false
    this.#done[index] = done
    this.#celebration = this.#done.every(Boolean) && !this.#celebrated
    if (this.#celebration) this.#celebrated = true
    this.#save()
    return true
  }

  newRound(): void {
    if (this.#closed || (!this.#celebrated && !this.#done.some(Boolean))) return
    this.#done = [false, false, false]
    this.#celebrated = false
    this.#celebration = false
    this.#save()
  }

  retrySave(): void {
    if (!this.#closed) this.#save()
  }

  close(): void {
    this.#closed = true
  }

  #save(): void {
    try {
      this.#storage.set(JSON.stringify({ version: 1, done: this.#done, celebrated: this.#celebrated }))
      this.#storageFailed = false
    } catch {
      this.#storageFailed = true
    }
  }
}
