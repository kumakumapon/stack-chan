import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { I18nProvider } from '@/app/i18n-provider'
import { FIRMWARE_BOARDS } from '@/features/firmware-install/boards'
import { HostInstallForm } from '@/features/firmware-install/host-install-form'

const install = vi.hoisted(() => vi.fn())
vi.mock('@/features/firmware-install/use-firmware-install', () => ({
  useFirmwareInstall: () => ({ state: { status: 'idle' }, install, reset: vi.fn() }),
}))

it('offers the supported CoreS3 firmware without a hardware selector', async () => {
  localStorage.setItem('stackchan.locale', 'ja')
  render(
    <I18nProvider>
      <HostInstallForm />
    </I18nProvider>
  )

  expect(screen.getByText('M5StackChan CoreS3', { exact: true })).toBeInTheDocument()
  expect(FIRMWARE_BOARDS).toHaveLength(1)
  expect(screen.queryByRole('combobox', { name: 'ボード' })).not.toBeInTheDocument()
  expect(screen.getByRole('note')).toHaveTextContent('設定とインストール済みのMODはすべて消去')
  await userEvent.click(screen.getByRole('button', { name: 'USBに接続して書き込む' }))
  expect(install).toHaveBeenCalledWith(FIRMWARE_BOARDS[0])
})
