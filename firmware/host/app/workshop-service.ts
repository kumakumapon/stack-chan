import loadPreferences from 'loadPreference'
import type { StackchanContext } from 'capabilities'
import { chunkStorage } from 'chunk-storage'
import { isCompanionIdleSuppressed } from 'companion-idle'
import { InboxModel } from 'inbox-model'
import Preference from 'preference'
import Time from 'time'
import Timer from 'timer'
import { workshopRequest } from 'workshop-http'
import { type WorkshopSettings, WorkshopStore } from 'workshop-store'

export class WorkshopService {
  readonly store = new WorkshopStore(
    {
      get: () => Preference.get('sc_workshop', 'state'),
      set: (value) => Preference.set('sc_workshop', 'state', value),
    },
    chunkStorage(Preference, 'sc_deck'),
  )
  readonly inbox: InboxModel
  status = ''
  pairCode = ''
  #pairUntil = 0
  #listeners = new Set<() => void>()
  #closed = false
  #working = false
  #acting = false
  #gateway: { endpoint?: string; deviceId?: string; token?: string }
  #timer: ReturnType<typeof Timer.repeat>
  #cancelReaction: (() => unknown) | undefined
  constructor(readonly context: StackchanContext) {
    this.#gateway = loadPreferences('gateway')
    this.inbox = new InboxModel(
      () => Time.ticks,
      () => {
        this.react('greeting')
      },
    )
    this.#timer = Timer.repeat(() => {
      void this.poll()
    }, 5000)
    context.lifecycle.onClose(() => this.close())
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
  notify(): void {
    if (!this.#closed) for (const listener of this.#listeners) listener()
  }
  settings() {
    return this.store.settings()
  }
  set(key: keyof Omit<WorkshopSettings, 'version'>, value: boolean): void {
    this.store.set(key, value)
    if (key === 'receiving' && !value) {
      this.inbox.clear()
      this.pairCode = ''
      this.#cancelReaction?.()
    }
    this.notify()
    if (key === 'receiving' && value) void this.poll()
  }
  busy(): boolean {
    const controller = (this.context.ui.application as { behavior?: { companionIdle?: boolean } } | undefined)?.behavior
    return (
      controller?.companionIdle === false ||
      isCompanionIdleSuppressed(this.context) ||
      this.context.conversation.remoteSession?.activationState === 'active' ||
      !!this.context.audio.isActive ||
      !!this.context.performance.status().active ||
      !!this.context.reaction.status().active
    )
  }
  react(name: 'greeting' | 'success' | 'yes' | 'thinking'): () => void {
    if (
      !this.settings().gestures ||
      this.context.audio.isActive ||
      this.context.conversation.remoteSession?.activationState === 'active'
    )
      return () => undefined
    const result = this.context.reaction.playOwned?.(name, { intensity: 0.25, restore: true })
    if (!result?.ok) return () => undefined
    const cancel = () => {
      result.cancel()
    }
    this.#cancelReaction = cancel
    return cancel
  }
  sound(): void {
    if (
      this.settings().sound &&
      !this.context.audio.isActive &&
      this.context.conversation.remoteSession?.activationState !== 'active'
    )
      void this.context.audio.tone(660, 80, 0.15).catch(() => undefined)
  }
  activity(kind: 'quest-complete' | 'quiz-complete' | 'memory-complete', score: number): void {
    this.sound()
    if (!this.settings().pet) return
    try {
      const raw = Preference.get('sc_activity', 'state')
      const previous = typeof raw === 'string' ? Number(raw) : 0
      if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER)
        throw new Error('Invalid activity sequence')
      const sequence = previous + 1
      Preference.set('sc_activity', 'state', String(sequence))
      this.context.ui.miniApps.reportActivity?.({ kind, eventId: `activity-${sequence}`, score })
    } catch {
      this.status = 'Save failed'
      this.notify()
    }
  }
  async request(action: string, body: Record<string, unknown> = {}): Promise<unknown> {
    const { endpoint, deviceId, token } = this.#gateway
    if (!endpoint || !deviceId || !token) throw new Error('Configure Gateway ID and token first')
    const match = /^(?:ws|http):\/\/([^/?#]+)(?:\/[^?#]*)?$/.exec(endpoint)
    if (!match || match[1].includes('@')) throw new Error('Use a LAN http:// or ws:// Gateway')
    return workshopRequest(`http://${match[1]}/api/inbox/${action}`, token, { ...body, deviceId })
  }
  async poll(): Promise<void> {
    if (this.#closed || this.#working || !this.settings().receiving) return
    this.#working = true
    try {
      const result = await this.request('poll')
      if (this.#closed || !this.settings().receiving) return
      this.inbox.receive(result)
      this.inbox.present(this.busy())
      this.context.ui.miniApps.setStatus?.(
        'stackchan.workshop',
        String(this.inbox.snapshot().filter((entry) => !entry.read).length),
      )
      this.status = ''
    } catch (error) {
      if (!this.#closed) this.status = String(error)
    } finally {
      this.#working = false
      if (Time.ticks >= this.#pairUntil) this.pairCode = ''
      this.notify()
    }
  }
  async act(action: 'pair' | 'revoke' | 'read' | 'reply' | 'delete', id?: string): Promise<void> {
    if (this.#closed || this.#acting) return
    this.#acting = true
    try {
      const result = (await this.request(action, id ? { id } : {})) as { code?: string }
      if (this.#closed) return
      if (action === 'pair') {
        this.pairCode = result.code ?? ''
        this.#pairUntil = Time.ticks + 120000
      }
      if (action === 'revoke') this.pairCode = ''
      this.status = ''
      await this.poll()
    } catch (error) {
      if (!this.#closed) this.status = String(error)
    }
    this.#acting = false
    this.notify()
  }
  command(command: { action: string; value?: unknown }): unknown {
    if (this.#closed) throw new Error('Workshop closed')
    if (command.action === 'quiz') {
      if (typeof command.value !== 'string') throw new Error('Expected quiz JSON')
      this.store.importDeck(command.value)
      this.notify()
      return { title: this.store.deck()?.title }
    }
    if (command.action === 'studio') {
      if (this.busy()) throw new Error('Close the Mini App or conversation before previewing')
      const result = this.context.performance.playStudio?.(command.value)
      if (!result) throw new Error('Studio unsupported')
      if (result.ok === false) throw new Error(result.error)
      return { ok: true }
    }
    if (command.action === 'stop') {
      if (this.context.performance.status().active === 'studio') this.context.performance.cancel()
      return { ok: true }
    }
    if (command.action === 'gateway') {
      const value = command.value as { endpoint?: unknown; deviceId?: unknown; token?: unknown }
      if (
        !value ||
        typeof value.endpoint !== 'string' ||
        value.endpoint.length > 200 ||
        typeof value.deviceId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,64}$/.test(value.deviceId) ||
        typeof value.token !== 'string' ||
        value.token.length < 1 ||
        value.token.length > 256
      )
        throw new Error('Invalid Gateway settings')
      this.#gateway = { endpoint: value.endpoint, deviceId: value.deviceId, token: value.token }
      this.set('receiving', true)
      return { ok: true }
    }
    throw new Error('Unknown workshop command')
  }
  close(): void {
    if (this.#closed) return
    this.#closed = true
    Timer.clear(this.#timer)
    this.#cancelReaction?.()
    this.#listeners.clear()
    this.inbox.clear()
  }
}

let services: WeakMap<object, WorkshopService> | undefined
export function workshopFor(context: StackchanContext): WorkshopService {
  services ??= new WeakMap()
  let service = services.get(context)
  if (!service) {
    service = new WorkshopService(context)
    services.set(context, service)
  }
  return service
}
