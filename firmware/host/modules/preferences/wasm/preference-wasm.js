import { createWasmPreference } from 'wasm-preference-memory'

const get = native('xs_stackchan_wasm_pet_preference_get')
const set = native('xs_stackchan_wasm_pet_preference_set')
const remove = native('xs_stackchan_wasm_pet_preference_delete')

export default createWasmPreference({ get, set, delete: remove })
