import { createWasmPreference } from 'wasm-preference-memory'

const get = native('xs_stackchan_wasm_pet_preference_get')
const set = native('xs_stackchan_wasm_pet_preference_set')
const remove = native('xs_stackchan_wasm_pet_preference_delete')
const getFocus = native('xs_stackchan_wasm_focus_preference_get')
const setFocus = native('xs_stackchan_wasm_focus_preference_set')
const removeFocus = native('xs_stackchan_wasm_focus_preference_delete')

const getDaily = native('xs_stackchan_wasm_daily_preference_get')
const setDaily = native('xs_stackchan_wasm_daily_preference_set')
const removeDaily = native('xs_stackchan_wasm_daily_preference_delete')
const daily = (index) => ({
  get: () => getDaily(index),
  set: (value) => setDaily(index, value),
  delete: () => removeDaily(index),
})

export default createWasmPreference(
  { get, set, delete: remove },
  { get: getFocus, set: setFocus, delete: removeFocus },
  { quest: daily(0), quiz: daily(1) },
)
