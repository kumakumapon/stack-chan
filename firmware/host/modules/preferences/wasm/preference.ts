type PreferenceDomainValues = Record<string, unknown>
type PreferenceStore = Record<string, PreferenceDomainValues>

const values: PreferenceStore = Object.create(null)
const PET_DOMAIN = 'stackchan_pet'
const PET_KEY = 'state'
const readSavedPetState = native('xs_stackchan_wasm_pet_preference_get') as () => string | null
const writeSavedPetState = native('xs_stackchan_wasm_pet_preference_set') as (value: string) => void
const deleteSavedPetState = native('xs_stackchan_wasm_pet_preference_delete') as () => void

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

const Preference = {
  get(domain: string, key: string): unknown {
    const value = values[domain]?.[key]
    if (value !== undefined || !isPetState(domain, key)) return value
    return readSavedPetState() ?? undefined
  },

  set(domain: string, key: string, value: unknown): void {
    assertSupportedPreferenceValue(value)
    let domainValues = values[domain]
    if (!domainValues) {
      domainValues = Object.create(null)
      values[domain] = domainValues
    }
    domainValues[key] = value
    if (isPetState(domain, key) && typeof value === 'string') writeSavedPetState(value)
  },

  delete(domain: string, key: string): void {
    const domainValues = values[domain]
    if (!domainValues || domainValues[key] === undefined) {
      if (isPetState(domain, key)) deleteSavedPetState()
      return
    }

    delete domainValues[key]
    if (Object.keys(domainValues).length === 0) {
      delete values[domain]
    }
    if (isPetState(domain, key)) deleteSavedPetState()
  },

  keys(domain: string): string[] {
    const domainValues = values[domain]
    const keys = domainValues ? Object.keys(domainValues) : []
    if (domain === PET_DOMAIN && !keys.includes(PET_KEY) && readSavedPetState() !== null) keys.push(PET_KEY)
    return keys
  },
}

export default Preference
