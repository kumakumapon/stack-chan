export type FirmwareBoard = {
  id: string
  label: string
  manifestUrl: string
}

export const FIRMWARE_BOARDS: readonly FirmwareBoard[] = [
  {
    id: 'esp32_m5stackchan_cores3',
    label: 'M5StackChan CoreS3',
    manifestUrl: new URL('./manifest_esp32_m5stackchan_cores3.json', document.baseURI).href,
  },
]
