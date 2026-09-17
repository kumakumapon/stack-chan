import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
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

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  // The bottom bar and the in-sheet TabsTrigger can share a label; the bottom bar buttons carry
  // role "button" while base-ui's TabsTrigger carries role "tab", so this targets the bar.
  await user.click(screen.getByRole('button', { name }))
}

describe('SimulatorMobileSurface', () => {
  beforeEach(() => {
    vi.mocked(useMobileDeviceSensors).mockReturnValue(createSensors())
  })

  it('opens the 操作 tab from the bottom bar and reaches the controller through head-touch controls', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('m5stackchan-cores3') })
    renderSurface(controller)

    await openTab(user, '操作')
    expect(screen.getByRole('dialog', { name: 'シミュレーター操作パネル' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: '前方スワイプ' }))
    expect(controller.headSwipe).toHaveBeenCalledWith('forward')

    await user.click(screen.getByRole('button', { name: 'タッチを離す' }))
    expect(controller.releaseHeadTouch).toHaveBeenCalledOnce()

    // CoreS3 has no A/B/C buttons wired, so the compatibility card must stay hidden.
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument()
  })

  it('shows the compatibility A/B/C buttons in 操作 on the legacy profile', async () => {
    const user = userEvent.setup()
    const controller = createController({ deviceProfile: resolveDeviceProfile('legacy-compat') })
    renderSurface(controller)

    await openTab(user, '操作')
    await user.click(screen.getByRole('button', { name: 'B' }))
    expect(controller.pushButton).toHaveBeenCalledWith('b')
  })

  it('reaches IMU, mobile sensor, camera and performance controls from センサー', async () => {
    const sensors = createSensors()
    vi.mocked(useMobileDeviceSensors).mockReturnValue(sensors)
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    await openTab(user, 'センサー')

    await user.click(screen.getByRole('button', { name: '前に転倒' }))
    expect(controller.setImuOrientation).toHaveBeenCalledWith('fallenForward')

    await user.click(screen.getByRole('button', { name: 'シェイク' }))
    expect(controller.shakeImu).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: '端末センサーを使用' }))
    expect(sensors.enable).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'インカメラ' }))
    expect(controller.connectCamera).toHaveBeenCalledWith({ facingMode: 'user' })

    await user.click(screen.getByRole('button', { name: 'アウトカメラ' }))
    expect(controller.connectCamera).toHaveBeenCalledWith({ facingMode: 'environment' })

    await user.click(screen.getByRole('button', { name: 'デスクトップ' }))
    expect(controller.setPerformanceMode).toHaveBeenCalledWith('desktop')

    await user.click(screen.getByRole('button', { name: 'モバイル' }))
    expect(controller.setPerformanceMode).toHaveBeenCalledWith('mobile')
  })

  it('calls setImuAccelerometer through the mobile sensor hook onAcceleration wiring', async () => {
    const user = userEvent.setup()
    const controller = createController()
    renderSurface(controller)

    // The センサー panel is unmounted (and so is not calling the hook) until its tab is open;
    // see the "does not render the firmware log" test for the same lazy-mount behavior on ログ.
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
      screen.getByText('端末センサーの利用が許可されていません。上のIMUボタンで手動操作してください。')
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: '逆さま' }))
    expect(controller.setImuOrientation).toHaveBeenCalledWith('upsideDown')

    await user.click(screen.getByRole('button', { name: 'シェイク' }))
    expect(controller.shakeImu).toHaveBeenCalledOnce()
  })

  it('disables the device-sensor button and explains when the browser does not support it', async () => {
    vi.mocked(useMobileDeviceSensors).mockReturnValue(createSensors({ state: 'unsupported', supported: false }))
    const user = userEvent.setup()
    renderSurface(createController())

    await openTab(user, 'センサー')

    expect(screen.getByText('このブラウザでは端末センサーを利用できません。上のIMUボタンで手動操作してください。')).toBeVisible()
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

  it('does not render the firmware log until the ログ tab is opened', async () => {
    const user = userEvent.setup()
    const controller = createController({
      logs: [{ id: '1', level: 'info', message: 'firmware boot ok' }],
    })
    renderSurface(controller)

    await openTab(user, '操作')
    expect(screen.queryByText('firmware boot ok')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'ログ' }))
    expect(screen.getByText('firmware boot ok')).toBeVisible()
  })
})
