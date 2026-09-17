import { createWasmTouchPanelSensor, installWasmSensor } from 'wasm-input-sensor-bridge'

const available = native('xs_stackchan_wasm_touch_panel_available')
const read = native('xs_stackchan_wasm_touch_panel_read')

export function installWasmTouchPanel() {
  // Installation is deferred until runtime because native functions are
  // unavailable while xsl evaluates preloadable module code (see
  // wasm-button-bridge for the same constraint). Returns false when the
  // browser profile does not provide a TouchPanel bridge.
  const TouchPanel = createWasmTouchPanelSensor({ available, read })
  if (!TouchPanel) return false
  installWasmSensor('TouchPanel', TouchPanel, globalThis)
  return true
}
