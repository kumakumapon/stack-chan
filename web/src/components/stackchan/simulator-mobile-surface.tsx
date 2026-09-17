import { Compass, Gamepad2, Info, Package } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import {
  SimulatorMobileControlDock,
  type MobileDockTab,
} from '@/components/stackchan/simulator-mobile-control-dock'
import { SimulatorMobileQuickControls } from '@/components/stackchan/simulator-mobile-quick-controls'
import { SimulatorViewport, type SimulatorSurfaceController } from '@/components/stackchan/simulator-surface'
import { Button } from '@/components/ui/button'

// `translate: false` matches the existing convention (see IMU's bare `<CardTitle>IMU</CardTitle>`
// in simulator-surface.tsx) of leaving technical acronyms/labels like "MOD" untranslated.
const PANEL_TABS: { value: MobileDockTab; label: string; icon: typeof Gamepad2; translate?: boolean }[] = [
  { value: 'operate', label: '操作', icon: Gamepad2 },
  { value: 'sensors', label: 'センサー', icon: Compass },
  { value: 'mod', label: 'MOD', icon: Package, translate: false },
  { value: 'details', label: '詳細', icon: Info },
]

const INPUT_CHIP_TIMEOUT_MS = 2000

function StatusChip({ children }: { children: string }) {
  return (
    <span
      role="status"
      className="pointer-events-auto rounded-full border bg-background/90 px-3 py-1 text-xs shadow-sm backdrop-blur"
    >
      {children}
    </span>
  )
}

export function SimulatorMobileSurface({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<MobileDockTab>('operate')
  const [dockOpen, setDockOpen] = useState(false)
  // What the browser sent into the simulated hardware, not what the firmware concluded from it —
  // the browser cannot know whether a stroke read as petting or a jolt as a shake, only
  // GestureRecognizer/MotionRecognizer (surfaced through the firmware log) can. The `入力:` prefix
  // on the chip below keeps that distinction visible instead of implying a firmware verdict.
  const [lastInput, setLastInput] = useState<string | null>(null)
  const inputTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    return () => clearTimeout(inputTimeoutRef.current)
  }, [])

  const handleInput = (label: string) => {
    clearTimeout(inputTimeoutRef.current)
    setLastInput(label)
    inputTimeoutRef.current = setTimeout(() => setLastInput(null), INPUT_CHIP_TIMEOUT_MS)
  }

  const selectTab = (tab: MobileDockTab) => {
    // Tapping the already-open tab closes the dock instead of re-opening it, so the tab bar
    // doubles as the dock's own toggle and the 3D view can be given the full height back without
    // a second control.
    if (dockOpen && activeTab === tab) {
      setDockOpen(false)
      return
    }
    setActiveTab(tab)
    setDockOpen(true)
  }

  return (
    // `100dvh` (not `100vh`) tracks the visible viewport as the mobile browser chrome shows or
    // hides, and `landscape:`/`portrait:` are plain CSS media-query variants, not a JS branch —
    // rotating the device restyles this same tree instead of remounting the canvas.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden landscape:flex-row">
      {/* Always rendered, never conditional: the firmware runs inside this canvas, and unmounting
          it (e.g. by hiding this pane while the dock is open) would kill the running simulator. */}
      <div className="relative min-h-[30dvh] flex-1 landscape:h-full landscape:min-h-0">
        <SimulatorViewport
          viewportRef={controller.viewportRef}
          screenRef={controller.screenRef}
          className="size-full rounded-none border-0"
        />

        {lastInput && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-2">
            <StatusChip>{t('入力: {label}', { label: lastInput })}</StatusChip>
          </div>
        )}

        {/* Loading the WASM firmware takes seconds on a phone, and it can fail. A compact chip
            keeps the 3D area as large as possible while pending/running; an error gets the full
            OperationStatus block since it needs room for its detail. */}
        {(controller.operation.status === 'pending' || controller.operation.status === 'success') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <StatusChip>{controller.operation.status === 'pending' ? t('準備中') : t('実行中')}</StatusChip>
          </div>
        )}
        {controller.operation.status === 'error' && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
            <div className="pointer-events-auto">
              <OperationStatus
                state={controller.operation}
                labels={{
                  pending: t('シミュレーターを準備しています'),
                  success: t('シミュレーターを実行中'),
                  error: t('シミュレーターを起動できませんでした'),
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col landscape:h-full landscape:w-[min(22rem,55vw)]">
        <SimulatorMobileQuickControls controller={controller} onInput={handleInput} />

        {dockOpen && <SimulatorMobileControlDock controller={controller} activeTab={activeTab} />}

        <nav
          className="grid shrink-0 grid-cols-4 gap-1 border-t bg-background p-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] landscape:pb-1.5"
          aria-label={t('シミュレーター操作パネル')}
        >
          {PANEL_TABS.map(({ value, label, icon: Icon, translate = true }) => (
            <Button
              key={value}
              variant="ghost"
              aria-pressed={dockOpen && activeTab === value}
              className="h-auto flex-col gap-1 py-2"
              onClick={() => selectTab(value)}
            >
              <Icon />
              <span className="text-xs">{translate ? t(label) : label}</span>
            </Button>
          ))}
        </nav>
      </div>
    </div>
  )
}
