type PreferenceDomainValues = Record<string, unknown>
type PreferenceStore = Record<string, PreferenceDomainValues>
type StatePersistence = {
  get(): string | null
  set(value: string): void
  delete(): void
}

const PET_DOMAIN = 'stackchan_pet'
const PET_KEY = 'state'
const FOCUS_DOMAIN = 'stackchan_focus'
const FOCUS_KEY = 'state'

function isPetState(domain: string, key: string): boolean {
  return domain === PET_DOMAIN && key === PET_KEY
}

function assertSupportedPreferenceValue(value: unknown): void {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('float unsupported')
    return
  }
  if (typeof value === 'boolean' || typeof value === 'string' || value instanceof ArrayBuffer) return
  throw new Error('unsupported type')
}

export function createWasmPreference(petPersistence?: StatePersistence, focusPersistence?: StatePersistence) {
  const values: PreferenceStore = Object.create(null)
  const persistenceFor = (domain: string, key: string) =>
    isPetState(domain, key)
      ? petPersistence
      : domain === FOCUS_DOMAIN && key === FOCUS_KEY
        ? focusPersistence
        : undefined

  return {
    get(domain: string, key: string): unknown {
      const value = values[domain]?.[key]
      if (value !== undefined) return value
      return persistenceFor(domain, key)?.get() ?? undefined
    },

    set(domain: string, key: string, value: unknown): void {
      assertSupportedPreferenceValue(value)
      // Timer writes are transactional so a failed browser save is visible to
      // the host service. Preserve the existing Pet persistence contract.
      if (domain === FOCUS_DOMAIN && key === FOCUS_KEY && focusPersistence) {
        if (typeof value !== 'string') throw new TypeError('timer state must be a string')
        focusPersistence.set(value)
      }
      let domainValues = values[domain]
      if (!domainValues) {
        domainValues = Object.create(null)
        values[domain] = domainValues
      }
      domainValues[key] = value
      if (isPetState(domain, key) && typeof value === 'string') petPersistence?.set(value)
    },

    delete(domain: string, key: string): void {
      const domainValues = values[domain]
      if (!domainValues || domainValues[key] === undefined) {
        persistenceFor(domain, key)?.delete()
        return
      }

      delete domainValues[key]
      if (Object.keys(domainValues).length === 0) {
        delete values[domain]
      }
      persistenceFor(domain, key)?.delete()
    },

    keys(domain: string): string[] {
      const domainValues = values[domain]
      const keys = domainValues ? Object.keys(domainValues) : []
      if (domain === PET_DOMAIN && !keys.includes(PET_KEY) && petPersistence?.get() != null) keys.push(PET_KEY)
      if (domain === FOCUS_DOMAIN && !keys.includes(FOCUS_KEY) && focusPersistence?.get() != null) keys.push(FOCUS_KEY)
      return keys
    },
  }
}

export default createWasmPreference()
