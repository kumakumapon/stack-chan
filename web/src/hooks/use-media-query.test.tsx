import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMediaQuery } from '@/hooks/use-media-query'

type Listener = (event: { matches: boolean }) => void

function stubMatchMedia(options: { matches: boolean; legacy?: boolean; missing?: boolean }) {
  const listeners = new Set<Listener>()
  const media = {
    matches: options.matches,
    media: '',
    onchange: null,
    dispatchEvent: () => false,
    ...(options.legacy
      ? {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        }
      : {
          addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
          removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
        }),
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: options.missing ? undefined : () => media,
  })
  return {
    emit(matches: boolean) {
      media.matches = matches
      for (const listener of listeners) listener({ matches })
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useMediaQuery', () => {
  it('reports the initial match and follows later changes', () => {
    const media = stubMatchMedia({ matches: false })
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))

    expect(result.current).toBe(false)
    act(() => media.emit(true))
    expect(result.current).toBe(true)
  })

  it('falls back to the deprecated listener pair', () => {
    const media = stubMatchMedia({ matches: true, legacy: true })
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))

    expect(result.current).toBe(true)
    act(() => media.emit(false))
    expect(result.current).toBe(false)
  })

  it('unsubscribes on unmount so a remounted surface does not leak listeners', () => {
    const media = stubMatchMedia({ matches: false })
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 768px)'))

    expect(media.listenerCount).toBe(1)
    unmount()
    expect(media.listenerCount).toBe(0)
  })

  it('reports no match when the environment has no matchMedia', () => {
    stubMatchMedia({ matches: true, missing: true })
    const { result } = renderHook(() => useMediaQuery('(max-width: 768px)'))

    expect(result.current).toBe(false)
  })
})
