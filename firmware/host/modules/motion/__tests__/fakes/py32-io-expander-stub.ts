export function getSharedPY32IOExpander(_options?: { address?: number }) {
  return {
    setDirection(_pin: number, _output: boolean): void {},
    setPullMode(_pin: number, _enabled: boolean): void {},
    digitalWrite(_pin: number, _enabled: boolean): void {},
    getWriteValue(_pin: number): boolean {
      return false
    },
  }
}

export type PY32IOExpander = ReturnType<typeof getSharedPY32IOExpander>

/** Mirrors the real module: returns undefined when the expander is unreachable. */
export let py32ExpanderAvailable = true

export function setPY32ExpanderAvailable(available: boolean): void {
  py32ExpanderAvailable = available
}

export function tryGetSharedPY32IOExpander(
  options?: { address?: number },
  onError?: (error: unknown) => void,
): PY32IOExpander | undefined {
  if (py32ExpanderAvailable) return getSharedPY32IOExpander(options)
  onError?.(new Error('py32 expander unavailable'))
  return undefined
}
