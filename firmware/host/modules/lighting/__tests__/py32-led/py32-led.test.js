import { getSharedPY32IOExpander } from 'py32-io-expander'
import PY32Led from 'py32-led'
import Timer from 'timer'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

let writes = 0
let failAt = 0
let closes = 0
class FakeSMBus {
  readUint8() {
    return 1
  }
  writeUint8() {
    writes++
    if (writes === failAt) throw new Error('write failed')
  }
  writeBuffer() {
    this.writeUint8()
  }
  close() {
    closes++
  }
}

// Inject through the supported sensor seam. Preloaded modules may retain their
// own global environment, so replacing globalThis.device is not portable in XS.
const shared = getSharedPY32IOExpander({ sensor: { io: FakeSMBus } })
const healthy = new PY32Led({ length: 3 })
const initializationWrites = writes
assert(initializationWrites > 0, 'initialization must exercise the bus')
healthy.on(255, 0, 0)
assert(writes > initializationWrites, 'healthy LED still writes colors')
healthy.off()

// Fail every individual setup/initial-clear write, not just device discovery.
for (let failure = 1; failure <= initializationWrites; failure++) {
  Timer.reset()
  writes = 0
  failAt = failure
  const disabled = new PY32Led({ length: 3 })
  assert(writes === failure, 'initialization stops at the failed write')
  failAt = 0
  disabled.on(255, 0, 0, 100)
  disabled.off()
  disabled.blink(255, 0, 0, 100)
  disabled.rainbow()
  Timer.advance(1000)
  assert(writes === failure, 'failed LED must remain inert, including timers')
  assert(closes === 0, 'LED failure must not close the shared servo bus')
  assert(getSharedPY32IOExpander() === shared, 'shared expander must be retained')
  shared.digitalWrite(0, true)
  assert(writes === failure + 1, 'other shared-bus consumers remain usable')
}

writes = 0
const recovered = new PY32Led({ length: 3 })
assert(writes === initializationWrites, 'a new instance can initialize after recovery')
recovered.blink(255, 0, 0, 100)
Timer.advance(100)
assert(writes > initializationWrites, 'healthy effects still update LEDs')
recovered.off()
trace('ok\n')
