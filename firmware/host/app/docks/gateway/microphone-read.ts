type Reader = { read(buffer: Uint8Array): number | undefined }

// The callback's size is a snapshot, not a reservation. Reuse PCM storage
// and reduce only rejected sizes; unrelated driver errors must still surface.
export function readMicrophone(input: Reader, storage: Uint8Array, available: number): Uint8Array | undefined {
  let size = Math.min(storage.byteLength, Math.max(0, Math.trunc(available))) & ~1
  while (size > 0) {
    const target = size === storage.byteLength ? storage : storage.subarray(0, size)
    let count: number | undefined
    try {
      count = input.read(target)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'invalid size' || size === 2) throw error
      size = Math.max(2, (size >> 1) & ~1)
      continue
    }
    if (!count) return
    if (count < 0 || count > size || count % 2 !== 0) throw new Error('invalid microphone read count')
    return count === size ? target : target.subarray(0, count)
  }
}
