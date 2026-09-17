// A device profile tells the simulator which Host.* bridges to build, mirroring how a real
// firmware/host/platforms/*/manifest.json wires (or omits) a sensor driver for a physical board.
// SimulatorEngine reads `inputs` to decide which bridges exist on `stackchanRuntime.host`; the
// firmware side treats an absent Host.TouchPanel/Host.IMU/Host.Button as "this device has no
// such sensor", so keeping a disabled input out of the object (never a stub) is what makes the
// simulated board behave like the real one.

const DEVICE_PROFILES_LIST = [
  {
    id: 'm5stackchan-cores3',
    label: 'M5StackChan CoreS3',
    description: 'Stock CoreS3 head with the Si12T head touch panel and IMU; no A/B/C buttons.',
    inputs: {
      screenTouch: true,
      // firmware/host/platforms/m5stackchan_cores3/manifest.json sets config.virtualButton: false —
      // CoreS3 has no physical A/B/C buttons wired through Host.Button.
      virtualButtons: false,
      headTouch: true,
      imu: true,
    },
  },
  {
    id: 'legacy-compat',
    label: 'Legacy / Compatibility',
    description: 'Older M5Stack targets with A/B/C buttons and an IMU, but no Si12T head panel.',
    inputs: {
      screenTouch: true,
      // The A/B/C button bridge stays useful for older M5Stack targets and for exercising
      // button-aware MODs, neither of which a CoreS3 profile needs.
      virtualButtons: true,
      // These boards carry an IMU but never shipped the CoreS3's Si12T head touch panel.
      headTouch: false,
      imu: true,
    },
  },
]

function freezeProfile(profile) {
  return Object.freeze({ ...profile, inputs: Object.freeze({ ...profile.inputs }) })
}

export const DEVICE_PROFILES = Object.freeze(DEVICE_PROFILES_LIST.map(freezeProfile))

export const DEFAULT_DEVICE_PROFILE_ID = 'm5stackchan-cores3'

export function resolveDeviceProfile(id) {
  const requested = DEVICE_PROFILES.find((profile) => profile.id === id)
  if (requested) return requested
  return DEVICE_PROFILES.find((profile) => profile.id === DEFAULT_DEVICE_PROFILE_ID)
}

export function listDeviceProfiles() {
  return DEVICE_PROFILES
}
