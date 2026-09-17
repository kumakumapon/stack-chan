import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProjectSimulatorDialog } from '@/features/project-editor/project-simulator-dialog'
import { useSimulatorEngine } from '@/features/simulator/use-simulator-engine'
import { resolveDeviceProfile } from '../../../simulator/device-profile.mjs'

vi.mock('@/features/simulator/use-simulator-engine', () => ({
  useSimulatorEngine: vi.fn(),
}))

const simulatorController = {
  viewportRef: createRef<HTMLCanvasElement>(),
  screenRef: createRef<HTMLCanvasElement>(),
  operation: { status: 'idle' as const },
  modState: { result: { status: 'empty' as const } },
  cameraStatus: { status: 'idle' as const },
  cameraFacingMode: undefined,
  logs: [],
  clearLogs: vi.fn(),
  installMod: vi.fn(async () => {}),
  restart: vi.fn(async () => {}),
  clearMod: vi.fn(async () => {}),
  connectCamera: vi.fn(async () => {}),
  pushButton: vi.fn(),
  // The dialog renders the full simulator surface, so the fake has to carry the
  // device profile and its input controls too. Resolve a real profile rather
  // than inventing a shape the surface would happily accept but the engine
  // would never produce.
  deviceProfile: resolveDeviceProfile('m5stackchan-cores3'),
  setDeviceProfile: vi.fn(),
  performanceMode: 'desktop' as const,
  setPerformanceMode: vi.fn(),
  headSwipe: vi.fn(),
  setHeadTouchPosition: vi.fn(),
  releaseHeadTouch: vi.fn(),
  setImuOrientation: vi.fn(),
  shakeImu: vi.fn(),
  setImuAccelerometer: vi.fn(),
}

describe('ProjectSimulatorDialog', () => {
  beforeEach(() => {
    vi.mocked(useSimulatorEngine).mockReturnValue(simulatorController)
  })

  it('runs the built archive in a session-scoped React surface without an iframe', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const archive = new Uint8Array([0, 0, 0, 8, 0x58, 0x53, 0x5f, 0x41])

    render(
      <I18nProvider>
        <TooltipProvider>
          <ProjectSimulatorDialog open archive={archive} archiveName="hello.xsa" onOpenChange={onOpenChange} />
        </TooltipProvider>
      </I18nProvider>
    )

    expect(screen.getByRole('dialog', { name: 'シミュレーター' })).toBeVisible()
    expect(screen.getByTestId('project-simulator')).toBeVisible()
    expect(screen.getByRole('region', { name: 'ｽﾀｯｸﾁｬﾝ3Dシミュレーター' })).toBeVisible()
    expect(document.querySelector('iframe')).toBeNull()
    expect(useSimulatorEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        initialMod: { name: 'hello.xsa', bytes: archive },
        persistence: 'session',
      })
    )

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
