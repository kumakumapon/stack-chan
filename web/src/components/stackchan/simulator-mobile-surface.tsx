import { Compass, Gamepad2, Package, ScrollText } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import { OperationStatus } from '@/components/stackchan/operation-status'
import {
  DeviceProfileCard,
  HeadTouchCard,
  ImuCard,
  ModRuntimeControl,
  SimulatorLogPanel,
  SimulatorViewport,
  VirtualButtonCard,
  type SimulatorSurfaceController,
} from '@/components/stackchan/simulator-surface'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMobileDeviceSensors } from '@/features/simulator/use-mobile-device-sensors'
import { cn } from '@/lib/utils'

type PanelTab = 'operate' | 'sensors' | 'mod' | 'log'

// `translate: false` matches the existing convention (see IMU's bare `<CardTitle>IMU</CardTitle>`
// in simulator-surface.tsx) of leaving technical acronyms/labels like "MOD" untranslated.
const PANEL_TABS: { value: PanelTab; label: string; icon: typeof Gamepad2; translate?: boolean }[] = [
  { value: 'operate', label: '操作', icon: Gamepad2 },
  { value: 'sensors', label: 'センサー', icon: Compass },
  { value: 'mod', label: 'MOD', icon: Package, translate: false },
  { value: 'log', label: 'ログ', icon: ScrollText },
]

const MOBILE_SENSOR_STATE_LABEL: Record<ReturnType<typeof useMobileDeviceSensors>['state'], string> = {
  unsupported: 'このブラウザでは端末センサーを利用できません。上のIMUボタンで手動操作してください。',
  denied: '端末センサーの利用が許可されていません。上のIMUボタンで手動操作してください。',
  prompt: '端末センサーの利用には許可が必要です',
  granted: '端末センサーを使用中',
}

function MobileSensorCard({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  // Enabling device motion on iOS Safari requires DeviceMotionEvent.requestPermission() to run
  // synchronously inside a user gesture, so `enable` is called directly from `onClick` below —
  // never behind an intermediate await or effect that would break the gesture chain.
  const sensors = useMobileDeviceSensors({ onAcceleration: controller.setImuAccelerometer })
  const blocked = sensors.state === 'unsupported' || sensors.state === 'denied'

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('端末センサー')}</CardTitle>
        <CardDescription role="status">{t(MOBILE_SENSOR_STATE_LABEL[sensors.state])}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button
          className="w-full"
          variant="outline"
          onClick={() => void sensors.enable()}
          disabled={sensors.state === 'unsupported'}
        >
          <Compass data-icon="inline-start" />
          {t('端末センサーを使用')}
        </Button>
        {blocked && (
          <p className="text-sm text-muted-foreground" role="status">
            {t('端末を傾けたりシェイクしたりする代わりに、下のIMUボタンで姿勢とシェイクを試せます。')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function MobileCameraCard({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  const cameraBusy = controller.cameraStatus.status === 'pending'
  const cameraLabel = {
    idle: '未接続',
    pending: '接続中',
    connected: '接続済み',
    fallback: '利用できません · 合成映像',
    error: `接続失敗 · 合成映像`,
  }[controller.cameraStatus.status]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('カメラ')}</CardTitle>
        <CardDescription role="status">{t(cameraLabel)}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Button
          variant={controller.cameraFacingMode === 'user' ? 'default' : 'outline'}
          aria-pressed={controller.cameraFacingMode === 'user'}
          onClick={() => void controller.connectCamera({ facingMode: 'user' })}
          disabled={cameraBusy}
        >
          {t('インカメラ')}
        </Button>
        <Button
          variant={controller.cameraFacingMode === 'environment' ? 'default' : 'outline'}
          aria-pressed={controller.cameraFacingMode === 'environment'}
          onClick={() => void controller.connectCamera({ facingMode: 'environment' })}
          disabled={cameraBusy}
        >
          {t('アウトカメラ')}
        </Button>
      </CardContent>
    </Card>
  )
}

function PerformanceModeCard({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('パフォーマンスモード')}</CardTitle>
        <CardDescription>
          {t('モバイル端末では描画負荷を抑え、デスクトップ相当の品質にも戻せます。')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Button
          variant={controller.performanceMode === 'mobile' ? 'default' : 'outline'}
          aria-pressed={controller.performanceMode === 'mobile'}
          onClick={() => controller.setPerformanceMode('mobile')}
        >
          {t('モバイル')}
        </Button>
        <Button
          variant={controller.performanceMode === 'desktop' ? 'default' : 'outline'}
          aria-pressed={controller.performanceMode === 'desktop'}
          onClick={() => controller.setPerformanceMode('desktop')}
        >
          {t('デスクトップ')}
        </Button>
      </CardContent>
    </Card>
  )
}

function PanelSection({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 p-1 pb-4">{children}</div>
}

export function SimulatorMobileSurface({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<PanelTab>('operate')
  const { inputs } = controller.deviceProfile

  const openTab = (tab: PanelTab) => {
    setActiveTab(tab)
    setSheetOpen(true)
  }

  return (
    // `100dvh` (not `100vh`) tracks the visible viewport as the mobile browser chrome shows or
    // hides, and `landscape:`/`portrait:` are plain CSS media-query variants, not a JS branch —
    // rotating the device restyles this same tree instead of remounting the canvas.
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden landscape:flex-row">
      <div className="relative min-h-0 flex-1 landscape:h-full">
        <SimulatorViewport
          viewportRef={controller.viewportRef}
          screenRef={controller.screenRef}
          className="size-full rounded-none border-0"
        />
        {/* Loading the WASM firmware takes seconds on a phone, and it can fail.
            The desktop surface has room for a permanent status strip; here it
            floats over the viewport so it costs no layout while idle, and
            OperationStatus renders nothing once the status goes back to idle. */}
        {controller.operation.status !== 'idle' && (
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

      <nav
        className="grid shrink-0 grid-cols-4 gap-1 border-t bg-background p-1.5 landscape:h-full landscape:w-20 landscape:grid-cols-1 landscape:grid-rows-4 landscape:border-t-0 landscape:border-l"
        aria-label={t('シミュレーター操作パネル')}
      >
        {PANEL_TABS.map(({ value, label, icon: Icon, translate = true }) => (
          <Button
            key={value}
            variant="ghost"
            className="h-auto flex-col gap-1 py-2"
            onClick={() => openTab(value)}
          >
            <Icon />
            <span className="text-xs">{translate ? t(label) : label}</span>
          </Button>
        ))}
      </nav>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          closeLabel={t('閉じる')}
          className={cn(
            'flex h-[80dvh] max-h-[80dvh] flex-col p-0',
            'landscape:inset-y-0 landscape:top-0 landscape:right-0 landscape:bottom-auto landscape:left-auto',
            'landscape:h-dvh landscape:max-h-dvh landscape:w-[min(24rem,calc(100vw-5rem))] landscape:border-t-0 landscape:border-l'
          )}
        >
          <SheetHeader className="shrink-0 border-b pb-3">
            <SheetTitle>{t('シミュレーター操作パネル')}</SheetTitle>
          </SheetHeader>
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as PanelTab)}
            className="flex min-h-0 flex-1 flex-col px-4"
          >
            <TabsList className="w-full shrink-0">
              {PANEL_TABS.map(({ value, label, translate = true }) => (
                <TabsTrigger key={value} value={value}>
                  {translate ? t(label) : label}
                </TabsTrigger>
              ))}
            </TabsList>
            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="operate">
                <PanelSection>
                  <DeviceProfileCard controller={controller} />
                  {inputs.virtualButtons && <VirtualButtonCard controller={controller} />}
                  {inputs.headTouch && <HeadTouchCard controller={controller} />}
                </PanelSection>
              </TabsContent>
              <TabsContent value="sensors">
                <PanelSection>
                  {inputs.imu && <ImuCard controller={controller} />}
                  <MobileSensorCard controller={controller} />
                  <MobileCameraCard controller={controller} />
                  <PerformanceModeCard controller={controller} />
                </PanelSection>
              </TabsContent>
              <TabsContent value="mod">
                <PanelSection>
                  <ModRuntimeControl controller={controller} />
                </PanelSection>
              </TabsContent>
              <TabsContent value="log">
                <PanelSection>
                  <SimulatorLogPanel controller={controller} viewportClassName="h-[50dvh]" />
                </PanelSection>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  )
}
