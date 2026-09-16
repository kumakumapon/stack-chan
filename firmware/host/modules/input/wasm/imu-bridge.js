import { createWasmImuSensor, installWasmSensor } from 'wasm-input-sensor-bridge'

const available = native('xs_stackchan_wasm_imu_available')
const read = native('xs_stackchan_wasm_imu_read')

export function installWasmImu() {
  // Installation is deferred until runtime because native functions are
  // unavailable while xsl evaluates preloadable module code (see
  // wasm-button-bridge for the same constraint). Returns false when the
  // browser profile does not provide an IMU bridge.
  const IMU = createWasmImuSensor({ available, read })
  if (!IMU) return false
  installWasmSensor('IMU', IMU, globalThis)
  return true
}
