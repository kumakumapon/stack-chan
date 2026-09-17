import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { SimulatorSurface, type SimulatorSurfaceController } from '@/components/stackchan/simulator-surface'
import { resolveDeviceProfile } from '../../../simulator/device-profile.mjs'

function createController(
  overrides: Partial<SimulatorSurfaceController> = {}
): SimulatorSurfaceController {
  return {
    viewportRef: createRef<HTMLCanvasElement>(),
    screenRef: createRef<HTMLCanvasElement>(),
    operation: { status: 'idle' },
    modState: { result: { status: 'empty' } },
    cameraStatus: { status: 'idle' },
    cameraFacingMode: undefined,
    logs: [],
    clearLogs: vi.fn(),
    deviceProfile: resolveDeviceProfile('m5stackchan-cores3'),
    setDeviceProfile: vi.fn(),
    performanceMode: 'desktop',
    setPerformanceMode: vi.fn(),
    installMod: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    clearMod: vi.fn(async () => {}),
    connectCamera: vi.fn(async () => {}),
    pushButton: vi.fn(),
    headSwipe: vi.fn(),
    setHeadTouchPosition: vi.fn(),
    releaseHeadTouch: vi.fn(),
    setImuOrientation: vi.fn(),
    shakeImu: vi.fn(),
    setImuAccelerometer: vi.fn(),
    resetViewportCamera: vi.fn(),
    viewportControlsLocked: false,
    setViewportControlsLocked: vi.fn(),
    ...overrides,
  }
}

describe('SimulatorSurface device profile controls', () => {
  it('hides the compatibility A/B/C buttons and shows head-touch and IMU controls on the CoreS3 profile', () => {
    const controller = createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') })

    render(
      <I18nProvider>
        <SimulatorSurface controller={controller} />
      </I18nProvider>
    )

    expect(screen.queryByText('互換仮想ボタン (A/B/C)')).not.toBeInTheDocument()
    expect(screen.getByText('ヘッドタッチパネル')).toBeInTheDocument()
    expect(screen.getByText('IMU')).toBeInTheDocument()
  })

  it('shows the compatibility A/B/C buttons and hides head-touch controls on the legacy profile', () => {
    const controller = createController({ deviceProfile: resolveDeviceProfile('legacy-compat') })

    render(
      <I18nProvider>
        <SimulatorSurface controller={controller} />
      </I18nProvider>
    )

    expect(screen.getByText('互換仮想ボタン (A/B/C)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument()
    expect(screen.queryByText('ヘッドタッチパネル')).not.toBeInTheDocument()
    expect(screen.getByText('IMU')).toBeInTheDocument()
  })

  it('calls headSwipe, setHeadTouchPosition, releaseHeadTouch, setImuOrientation and shakeImu with the right arguments', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') })

    render(
      <I18nProvider>
        <SimulatorSurface controller={controller} />
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: '前方スワイプ' }))
    expect(controller.headSwipe).toHaveBeenCalledWith('forward')

    await user.click(screen.getByRole('button', { name: '後方スワイプ' }))
    expect(controller.headSwipe).toHaveBeenCalledWith('backward')

    await user.click(screen.getByRole('button', { name: '右端' }))
    expect(controller.setHeadTouchPosition).toHaveBeenCalledWith(100)

    await user.click(screen.getByRole('button', { name: 'タッチを離す' }))
    expect(controller.releaseHeadTouch).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '前に転倒' }))
    expect(controller.setImuOrientation).toHaveBeenCalledWith('fallenForward')

    await user.click(screen.getByRole('button', { name: 'シェイク' }))
    expect(controller.shakeImu).toHaveBeenCalledOnce()
  })

  it('pushes virtual buttons on the legacy profile', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('legacy-compat') })

    render(
      <I18nProvider>
        <SimulatorSurface controller={controller} />
      </I18nProvider>
    )

    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(controller.pushButton).toHaveBeenCalledWith('b')
  })
})
