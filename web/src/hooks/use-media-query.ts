import { useEffect, useState } from 'react'

/**
 * Tracks a CSS media query.
 *
 * The simulator uses this to pick between the desktop and mobile surfaces, so
 * it has to survive environments where `matchMedia` is missing or only exposes
 * the deprecated `addListener` pair: jsdom stubs it, and older mobile Safari
 * still ships the legacy API. In any of those cases the hook reports the
 * initial match and simply stops updating rather than throwing.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchQuery(query))

  useEffect(() => {
    const media = globalThis.matchMedia?.(query)
    if (!media) return
    setMatches(media.matches)
    const onChange = (event: MediaQueryListEvent | MediaQueryList) => setMatches(event.matches)
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }
    if (typeof media.addListener === 'function') {
      media.addListener(onChange)
      return () => media.removeListener?.(onChange)
    }
    return undefined
  }, [query])

  return matches
}

function matchQuery(query: string): boolean {
  try {
    return globalThis.matchMedia?.(query).matches ?? false
  } catch {
    // A malformed query throws in some engines; treat it as "does not match"
    // rather than taking the whole page down.
    return false
  }
}
