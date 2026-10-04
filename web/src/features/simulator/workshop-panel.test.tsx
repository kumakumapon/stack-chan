import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/app/i18n-provider'
import { WorkshopPanel } from './workshop-panel'
import type { useSimulatorEngine } from './use-simulator-engine'

const controller = (command: (value: unknown) => Promise<unknown>) =>
  ({ workshopCommand: command }) as unknown as ReturnType<typeof useSimulatorEngine>
const show = (command: (value: unknown) => Promise<unknown>) => {
  localStorage.setItem('stackchan.locale', 'ja')
  return render(
    <I18nProvider>
      <WorkshopPanel controller={controller(command)} />
    </I18nProvider>
  )
}
afterEach(() => vi.restoreAllMocks())

describe('WorkshopPanel', () => {
  it('submits the independent inbox settings without starting a conversation', async () => {
    const command = vi.fn(async () => ({ ok: true }))
    show(command)
    const button = screen.getByRole('button', { name: '受信を開始', hidden: true })
    const form = within(button.closest('form')!)
    fireEvent.change(form.getByLabelText('Gateway URL'), { target: { value: 'http://gateway.local:8765' } })
    fireEvent.change(form.getByLabelText('Gatewayトークン'), { target: { value: 'secret' } })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(command).toHaveBeenCalledWith({
      action: 'gateway',
      value: { endpoint: 'http://gateway.local:8765', deviceId: 'stackchan-01', token: 'secret' },
    })
  })
  it('queues stop even while a play acknowledgement is pending', async () => {
    let release!: (value: unknown) => void
    const command = vi.fn((value: unknown) =>
      (value as { action: string }).action === 'studio'
        ? new Promise((resolve) => {
            release = resolve
          })
        : Promise.resolve({ ok: true })
    )
    show(command)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '再生', hidden: true }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '停止', hidden: true }))
    })
    expect(command).toHaveBeenCalledWith({ action: 'stop' })
    await act(async () => release({ ok: true }))
  })
})
