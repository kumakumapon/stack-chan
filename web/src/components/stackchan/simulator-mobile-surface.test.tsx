import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { AppError } from '@/lib/errors/app-error'
import { SimulatorMobileSurface } from '@/components/stackchan/simulator-mobile-surface'
import { type SimulatorSurfaceController } from '@/components/stackchan/simulator-surface'
import { useMobileDeviceSensors } from '@/features/simulator/use-mobile-device-sensors'
import { resolveDeviceProfile } from '../../../simulator/device-profile.mjs'

vi.mock('@/features/simulator/use-mobile-device-sensors', () => ({
  useMobileDeviceSensors: vi.fn(),
}))

function createController(overrides: Partial<SimulatorSurfaceController> = {}): SimulatorSurfaceController {
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
    performanceMode: 'mobile',
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
    performanceStatus: {
      reaction: { active: null, startedAt: null },
      performance: { active: null, startedAt: null, nextCue: 0 },
    },
    playReaction: vi.fn(),
    cancelReaction: vi.fn(),
    playPerformance: vi.fn(),
    cancelPerformance: vi.fn(),
    resetViewportCamera: vi.fn(),
    viewportControlsLocked: false,
    setViewportControlsLocked: vi.fn(),
    ...overrides,
  }
}

function createSensors(overrides: Partial<ReturnType<typeof useMobileDeviceSensors>> = {}) {
  return {
    state: 'prompt' as const,
    supported: true,
    active: false,
    enable: vi.fn(async () => {}),
    disable: vi.fn(),
    ...overrides,
  }
}

function renderSurface(controller: SimulatorSurfaceController) {
  return render(
    <I18nProvider>
      <SimulatorMobileSurface controller={controller} />
    </I18nProvider>
  )
}

// The bottom nav is the only tab affordance now (no Tabs/Sheet library involved), so every panel
// switch goes through this one button.
async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name }))
}

describe('SimulatorMobileSurface', () => {
  beforeEach(() => {
    vi.mocked(useMobileDeviceSensors).mockReturnValue(createSensors())
  })

  it('keeps the 3D viewport visible while a dock panel is open', async () => {
    const user = userEvent.setup()
    renderSurface(createController())

    await openTab(user, 'センサー')

    expect(screen.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' })).toBeVisible()
  })

  it('never unmounts the canvas across tab switches and closing the dock', async () => {
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    const canvas = controller.viewportRef.current
    expect(canvas).toBeInstanceOf(HTMLCanvasElement)

    await openTab(user, '操作')
    expect(controller.viewportRef.current).toBe(canvas)

    await openTab(user, 'センサー')
    expect(controller.viewportRef.current).toBe(canvas)

    await openTab(user, 'MOD')
    expect(controller.viewportRef.current).toBe(canvas)

    await openTab(user, '詳細')
    expect(controller.viewportRef.current).toBe(canvas)

    // Closing the dock by tapping the active tab again must not touch the canvas either.
    await openTab(user, '詳細')
    expect(controller.viewportRef.current).toBe(canvas)
  })

  it('reaches head-swipe and shake through Quick Controls without opening the dock', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') })
    renderSurface(controller)

    await user.click(screen.getByRole('button', { name: '前方スワイプ' }))
    expect(controller.headSwipe).toHaveBeenCalledWith('forward')

    await user.click(screen.getByRole('button', { name: 'シェイク' }))
    expect(controller.shakeImu).toHaveBeenCalledOnce()
  })

  it('follows the device profile in Quick Controls: no A/B/C on CoreS3', () => {
    renderSurface(createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') }))

    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument()
  })

  it('follows the device profile in Quick Controls: A/B/C on the legacy profile', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('legacy-compat') })
    renderSurface(controller)

    await user.click(screen.getByRole('button', { name: 'A' }))
    expect(controller.pushButton).toHaveBeenCalledWith('a')
  })

  it('shows an input feedback chip after a Quick Control is pressed', async () => {
    const user = userEvent.setup()
    renderSurface(createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') }))

    await user.click(screen.getByRole('button', { name: '前方スワイプ' }))
    expect(screen.getByText('入力: 前方スワイプ')).toBeVisible()
  })

  it('opens the 操作 tab from the bottom bar and reaches the controller through head-touch controls', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') })
    renderSurface(controller)

    await openTab(user, '操作')

    await user.click(screen.getByRole('button', { name: 'タッチを離す' }))
    expect(controller.releaseHeadTouch).toHaveBeenCalledOnce()

    // CoreS3 has no A/B/C buttons wired, so the compatibility card must stay hidden.
    expect(screen.queryByRole('button', { name: 'B' })).not.toBeInTheDocument()
  })

  it('shows the compatibility A/B/C buttons in 操作 on the legacy profile', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('legacy-compat') })
    renderSurface(controller)

    await openTab(user, '操作')
    // Two "B" buttons exist once the dock is open: Quick Controls and the 操作 panel card.
    const buttons = screen.getAllByRole('button', { name: 'B' })
    await user.click(buttons[buttons.length - 1])
    expect(controller.pushButton).toHaveBeenCalledWith('b')
  })

  it('reaches mobile sensor, camera and IMU controls from センサー', async () => {
    const sensors = createSensors()
    vi.mocked(useMobileDeviceSensors).mockReturnValue(sensors)
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    await openTab(user, 'センサー')

    await user.click(screen.getByRole('button', { name: '端末センサーを使用' }))
    expect(sensors.enable).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'インカメラ' }))
    expect(controller.connectCamera).toHaveBeenCalledWith({ facingMode: 'user' })

    await user.click(screen.getByRole('button', { name: 'アウトカメラ' }))
    expect(controller.connectCamera).toHaveBeenCalledWith({ facingMode: 'environment' })

    await user.click(screen.getByRole('button', { name: '前に転倒' }))
    expect(controller.setImuOrientation).toHaveBeenCalledWith('fallenForward')
  })

  it('calls setImuAccelerometer through the mobile sensor hook onAcceleration wiring', async () => {
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    // The センサー panel is unmounted (and so not calling the hook) until its tab is open; see
    // the "does not render the firmware log" test for the same lazy-mount behavior on 詳細.
    await openTab(user, 'センサー')

    expect(useMobileDeviceSensors).toHaveBeenCalledWith(
      expect.objectContaining({ onAcceleration: controller.setImuAccelerometer })
    )
  })

  it('leaves the IMU orientation and shake buttons working when device sensor permission is denied', async () => {
    vi.mocked(useMobileDeviceSensors).mockReturnValue(createSensors({ state: 'denied' }))
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    await openTab(user, 'センサー')

    expect(
      screen.getByText('端末センサーの利用が許可されていません。IMUのボタンで手動操作してください。')
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '逆さま' }))
    expect(controller.setImuOrientation).toHaveBeenCalledWith('upsideDown')
  })

  it('disables the device-sensor button and explains when the browser does not support it', async () => {
    vi.mocked(useMobileDeviceSensors).mockReturnValue(createSensors({ state: 'unsupported', supported: false }))
    const user = userEvent.setup()
    renderSurface(createController())

    await openTab(user, 'センサー')

    expect(screen.getByText('このブラウザでは端末センサーを利用できません。IMUのボタンで手動操作してください。')).toBeVisible()
    expect(screen.getByRole('button', { name: '端末センサーを使用' })).toBeDisabled()
  })

  it('runs the MOD panel through the shared MOD control', async () => {
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    await openTab(user, 'MOD')
    await user.click(screen.getByRole('button', { name: '再起動' }))
    expect(controller.restart).toHaveBeenCalledOnce()
  })

  it('does not render the firmware log until the 詳細 tab is opened', async () => {
    const user = userEvent.setup()
    const controller = createController({
      logs: [{ id: '1', level: 'info', message: 'firmware boot ok' }],
    })
    renderSurface(controller)

    await openTab(user, '操作')
    expect(screen.queryByText('firmware boot ok')).not.toBeInTheDocument()

    await openTab(user, '詳細')
    expect(screen.getByText('firmware boot ok')).toBeVisible()
  })

  it('resets and locks the 3D view from 詳細', async () => {
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    await openTab(user, '詳細')

    await user.click(screen.getByRole('button', { name: '正面に戻す' }))
    expect(controller.resetViewportCamera).toHaveBeenCalledOnce()

    const lockButton = screen.getByRole('button', { name: '3D回転ロック' })
    expect(lockButton).toHaveAttribute('aria-pressed', 'false')
    await user.click(lockButton)
    expect(controller.setViewportControlsLocked).toHaveBeenCalledWith(true)
  })

  it('reflects a locked 3D view as aria-pressed', async () => {
    const user = userEvent.setup()
    renderSurface(createController({ viewportControlsLocked: true }))

    await openTab(user, '詳細')
    expect(screen.getByRole('button', { name: '3D回転ロック' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('closes the dock when the active tab is tapped again', async () => {
    const user = userEvent.setup()
    const controller = createController({
      logs: [{ id: '1', level: 'info', message: 'firmware boot ok' }],
    })
    renderSurface(controller)

    await openTab(user, '詳細')
    expect(screen.getByText('firmware boot ok')).toBeVisible()
    expect(screen.getByRole('button', { name: '詳細' })).toHaveAttribute('aria-pressed', 'true')

    await openTab(user, '詳細')
    expect(screen.queryByText('firmware boot ok')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '詳細' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('SimulatorMobileSurface status', () => {
  it('surfaces a failed start over the viewport instead of leaving a blank canvas', () => {
    const controller = createController({
      operation: { status: 'error', error: new AppError('simulator', 'WASMを読み込めませんでした') },
    })

    renderSurface(controller)

    expect(screen.getByText('シミュレーターを起動できませんでした')).toBeVisible()
  })

  it('shows a compact pending chip instead of the full status block', () => {
    const controller = createController({ operation: { status: 'pending' } })

    renderSurface(controller)

    expect(screen.getByText('準備中')).toBeVisible()
  })

  it('shows a compact running chip instead of the full status block', () => {
    const controller = createController({ operation: { status: 'success', result: undefined } })

    renderSurface(controller)

    expect(screen.getByText('実行中')).toBeVisible()
  })

  it('shows nothing once the simulator settles back to idle', () => {
    const controller = createController({ operation: { status: 'idle' } })

    renderSurface(controller)

    expect(screen.queryByText('シミュレーターを準備しています')).toBeNull()
    expect(screen.queryByText('シミュレーターを起動できませんでした')).toBeNull()
  })
})
