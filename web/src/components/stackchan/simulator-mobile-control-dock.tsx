import { Compass } from 'lucide-react'
import { type ReactNode } from 'react'

import { useI18n } from '@/app/i18n-provider'
import {
  DeviceProfileCard,
  HeadTouchCard,
  ImuCard,
  ModRuntimeControl,
  SimulatorLogPanel,
  VirtualButtonCard,
  type SimulatorSurfaceController,
} from '@/components/stackchan/simulator-surface'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useMobileDeviceSensors } from '@/features/simulator/use-mobile-device-sensors'

export type MobileDockTab = 'operate' | 'sensors' | 'mod' | 'details'

const MOBILE_SENSOR_STATE_LABEL: Record<ReturnType<typeof useMobileDeviceSensors>['state'], string> = {
  unsupported: 'このブラウザでは端末センサーを利用できません。IMUのボタンで手動操作してください。',
  denied: '端末センサーの利用が許可されていません。IMUのボタンで手動操作してください。',
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
            {t('端末を傾けたりシェイクしたりする代わりに、IMUのボタンで姿勢を、クイック操作のシェイクで振動を試せます。')}
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

function ViewCard({ controller }: { controller: SimulatorSurfaceController }) {
  const { t } = useI18n()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('3D表示')}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => controller.resetViewportCamera()}>
          {t('正面に戻す')}
        </Button>
        <Button
          aria-pressed={controller.viewportControlsLocked}
          variant={controller.viewportControlsLocked ? 'default' : 'outline'}
          onClick={() => controller.setViewportControlsLocked(!controller.viewportControlsLocked)}
        >
          {t('3D回転ロック')}
        </Button>
      </CardContent>
    </Card>
  )
}

function PanelSection({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 p-1 pb-4">{children}</div>
}

// The dock's own scroll container (native overflow-y-auto, not the base-ui ScrollArea — see #32:
// the ScrollArea version was hard to drag to the bottom of on real phones) so it can size itself
// independently of the always-visible viewport above it and never has to unmount that viewport.
export function SimulatorMobileControlDock({
  controller,
  activeTab,
}: {
  controller: SimulatorSurfaceController
  activeTab: MobileDockTab
}) {
  const { inputs } = controller.deviceProfile

  return (
    <div className="max-h-[40dvh] min-h-0 overflow-y-auto overscroll-contain border-t px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] landscape:max-h-none landscape:flex-1 landscape:pb-3">
      {activeTab === 'operate' && (
        <PanelSection>
          {inputs.headTouch && <HeadTouchCard controller={controller} />}
          {inputs.virtualButtons && <VirtualButtonCard controller={controller} />}
        </PanelSection>
      )}
      {activeTab === 'sensors' && (
        <PanelSection>
          <MobileSensorCard controller={controller} />
          <MobileCameraCard controller={controller} />
          {inputs.imu && <ImuCard controller={controller} />}
        </PanelSection>
      )}
      {activeTab === 'mod' && (
        <PanelSection>
          <ModRuntimeControl controller={controller} />
        </PanelSection>
      )}
      {activeTab === 'details' && (
        <PanelSection>
          <ViewCard controller={controller} />
          <DeviceProfileCard controller={controller} />
          <PerformanceModeCard controller={controller} />
          <SimulatorLogPanel controller={controller} viewportClassName="h-48" />
        </PanelSection>
      )}
    </div>
  )
}
