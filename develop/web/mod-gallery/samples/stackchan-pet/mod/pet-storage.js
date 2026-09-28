import { createPetState, decodePetState, encodePetState } from 'pet-state'
import Preference from 'preference'

const DOMAIN = 'stackchan_pet'
const KEY = 'state'

/** Moddable Preference is a public platform API, separate from host storage internals. */
export function loadPetState() {
  try {
    const stored = Preference.get(DOMAIN, KEY)
    return decodePetState(stored)
  } catch (error) {
    trace(`[stackchan_pet] invalid saved state: ${String(error)}\n`)
    return createPetState()
  }
}

export function savePetState(state) {
  Preference.set(DOMAIN, KEY, encodePetState(state))
}
