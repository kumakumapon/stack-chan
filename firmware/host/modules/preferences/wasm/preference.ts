type PreferenceDomainValues = Record<string, unknown>
type PreferenceStore = Record<string, PreferenceDomainValues>
type PetPersistence = {
  get(): string | null
  set(value: string): void
  delete(): void
}

const PET_DOMAIN = 'stackchan_pet'
const PET_KEY = 'state'

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

export function createWasmPreference(petPersistence?: PetPersistence) {
  const values: PreferenceStore = Object.create(null)

  return {
    get(domain: string, key: string): unknown {
      const value = values[domain]?.[key]
      if (value !== undefined || !isPetState(domain, key)) return value
      return petPersistence?.get() ?? undefined
    },

    set(domain: string, key: string, value: unknown): void {
      assertSupportedPreferenceValue(value)
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
        if (isPetState(domain, key)) petPersistence?.delete()
        return
      }

      delete domainValues[key]
      if (Object.keys(domainValues).length === 0) {
        delete values[domain]
      }
      if (isPetState(domain, key)) petPersistence?.delete()
    },

    keys(domain: string): string[] {
      const domainValues = values[domain]
      const keys = domainValues ? Object.keys(domainValues) : []
      if (domain === PET_DOMAIN && !keys.includes(PET_KEY) && petPersistence?.get() != null) keys.push(PET_KEY)
      return keys
    },
  }
}

export default createWasmPreference()
