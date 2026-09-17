import { describe, expect, it } from 'vitest'

import { deviceMotionSupport, requestDeviceMotionPermission } from './mobile-sensor-permission'

function fakeWindow(overrides: Record<string, unknown> = {}): Window & typeof globalThis {
  return { ...overrides } as unknown as Window & typeof globalThis
}

describe('deviceMotionSupport', () => {
  it('reports unsupported when there is no DeviceMotionEvent', () => {
    expect(deviceMotionSupport(fakeWindow())).toBe('unsupported')
  })

  it('reports unsupported when DeviceMotionEvent is not a function', () => {
    expect(deviceMotionSupport(fakeWindow({ DeviceMotionEvent: {} }))).toBe('unsupported')
  })

  it('reports prompt when requestPermission exists (iOS)', () => {
    class IosDeviceMotionEvent {
      static requestPermission() {
        return Promise.resolve('granted' as const)
      }
    }
    expect(deviceMotionSupport(fakeWindow({ DeviceMotionEvent: IosDeviceMotionEvent }))).toBe('prompt')
  })

  it('reports granted when DeviceMotionEvent exists with no requestPermission (Android/desktop)', () => {
    class PlainDeviceMotionEvent {}
    expect(deviceMotionSupport(fakeWindow({ DeviceMotionEvent: PlainDeviceMotionEvent }))).toBe('granted')
  })
})

describe('requestDeviceMotionPermission', () => {
  it('resolves unsupported when there is no DeviceMotionEvent', async () => {
    await expect(requestDeviceMotionPermission(fakeWindow())).resolves.toBe('unsupported')
  })

  it('resolves granted immediately when no prompt is required', async () => {
    class PlainDeviceMotionEvent {}
    await expect(requestDeviceMotionPermission(fakeWindow({ DeviceMotionEvent: PlainDeviceMotionEvent }))).resolves.toBe(
      'granted'
    )
  })

  it('resolves granted when the iOS prompt is accepted', async () => {
    class IosDeviceMotionEvent {
      static requestPermission() {
        return Promise.resolve('granted' as const)
      }
    }
    await expect(
      requestDeviceMotionPermission(fakeWindow({ DeviceMotionEvent: IosDeviceMotionEvent }))
    ).resolves.toBe('granted')
  })

  it('resolves denied when the iOS prompt is explicitly denied', async () => {
    class IosDeviceMotionEvent {
      static requestPermission() {
        return Promise.resolve('denied' as const)
      }
    }
    await expect(
      requestDeviceMotionPermission(fakeWindow({ DeviceMotionEvent: IosDeviceMotionEvent }))
    ).resolves.toBe('denied')
  })

  it('resolves denied, never throws, when requestPermission rejects (called outside a gesture)', async () => {
    class IosDeviceMotionEvent {
      static requestPermission() {
        return Promise.reject(new Error('NotAllowedError'))
      }
    }
    await expect(
      requestDeviceMotionPermission(fakeWindow({ DeviceMotionEvent: IosDeviceMotionEvent }))
    ).resolves.toBe('denied')
  })
})
