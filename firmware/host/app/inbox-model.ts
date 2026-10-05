export type InboxEntry = Readonly<{
  id: string
  kind: 'build' | 'message'
  text: string
  sender: string
  read: boolean
  remainingMs: number
}>
export type InboxTransport = (action: string, body: Record<string, unknown>) => Promise<unknown>

/** Monotonic expiry and a bounded seen-set prevent replaying old gestures on reconnect. */
export class InboxModel {
  #entries: Array<InboxEntry & { deadline: number }> = []
  #seen = new Set<string>()
  #pending = new Set<string>()
  #primed = false
  constructor(
    private now: () => number,
    private react: () => void,
  ) {}
  receive(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('Invalid inbox response')
    const entries = (value as { entries?: unknown }).entries
    if (!Array.isArray(entries) || entries.length > 16) throw new Error('Invalid inbox response')
    const checked = entries.map((entry): InboxEntry & { deadline: number } => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'string' ||
        entry.id.length > 80 ||
        !['build', 'message'].includes(entry.kind) ||
        typeof entry.text !== 'string' ||
        entry.text.length > 120 ||
        typeof entry.sender !== 'string' ||
        entry.sender.length > 24 ||
        typeof entry.read !== 'boolean' ||
        !Number.isFinite(entry.remainingMs) ||
        entry.remainingMs <= 0 ||
        entry.remainingMs > 3600000
      )
        throw new Error('Invalid inbox entry')
      return {
        id: entry.id,
        kind: entry.kind,
        text: entry.text,
        sender: entry.sender,
        read: entry.read,
        remainingMs: entry.remainingMs,
        deadline: this.now() + entry.remainingMs,
      }
    })
    if (new Set(checked.map((entry) => entry.id)).size !== checked.length) throw new Error('Duplicate inbox entry')
    for (const entry of checked) {
      if (!this.#seen.has(entry.id)) {
        // Never discard replay guards while receiving the same connection's history.
        if (this.#seen.size >= 128) this.#seen.delete(this.#seen.values().next().value as string)
        this.#seen.add(entry.id)
        if (this.#primed && !entry.read) this.#pending.add(entry.id)
      }
    }
    this.#primed = true
    this.#entries = checked
    for (const id of this.#pending)
      if (!checked.some((entry) => entry.id === id && !entry.read)) this.#pending.delete(id)
  }
  snapshot(): readonly InboxEntry[] {
    return this.#entries.filter((entry) => entry.deadline > this.now())
  }
  present(busy: boolean): void {
    const pending = this.snapshot().filter((entry) => this.#pending.has(entry.id))
    if (busy || pending.length === 0) return
    // Coalesce a reconnect backlog into one quiet gesture, never one motion per old item.
    this.#pending.clear()
    this.react()
  }
  clear(): void {
    this.#entries = []
    this.#pending.clear()
  }
}
