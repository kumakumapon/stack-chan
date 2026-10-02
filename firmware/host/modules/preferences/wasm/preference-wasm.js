import { createWasmPreference } from 'wasm-preference-memory'

const get = native('xs_stackchan_wasm_pet_preference_get')
const set = native('xs_stackchan_wasm_pet_preference_set')
const remove = native('xs_stackchan_wasm_pet_preference_delete')
const getFocus = native('xs_stackchan_wasm_focus_preference_get')
const setFocus = native('xs_stackchan_wasm_focus_preference_set')
const removeFocus = native('xs_stackchan_wasm_focus_preference_delete')

export default createWasmPreference({ get, set, delete: remove }, { get: getFocus, set: setFocus, delete: removeFocus })
