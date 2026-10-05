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

const workshopPreference = native('xs_workshop_preference')
const workshop = (domain, key) => {
  if (!['sc_deck', 'sc_workshop', 'sc_inbox', 'sc_activity', 'sc_quiz'].includes(domain)) return undefined
  const call = (action, value) => {
    const result = JSON.parse(workshopPreference(JSON.stringify({ action, domain, key, value })))
    if (result.error) throw new Error(result.error)
    return result.value ?? null
  }
  return { get: () => call('get'), set: (value) => call('set', value), delete: () => call('delete') }
}

export default createWasmPreference(
  { get, set, delete: remove },
  { get: getFocus, set: setFocus, delete: removeFocus },
  { quest: daily(0), quiz: daily(1) },
  workshop,
)
