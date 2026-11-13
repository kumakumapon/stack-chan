export const devices = {
  m5stackchan_cores3: {
    platform: './host/platforms/m5stackchan_cores3',
    manifest: './host/app/manifest_m5stackchan_cores3.json',
    label: 'M5StackChan CoreS3',
    esptoolChip: 'esp32s3',
    firmwareVersionSource: 'moddable',
  },
}

export const aliases = {
  default: 'm5stackchan_cores3',
  m5stackchan: 'm5stackchan_cores3',
}

export function resolveDevice(value, prefix = '[stack-chan]') {
  const name = aliases[value] ?? value
  if (devices[name]) return name
  console.error(`${prefix} Unknown device: ${value}`)
  console.error(`${prefix} Supported devices: ${Object.keys(devices).join(', ')}`)
  process.exit(1)
}
