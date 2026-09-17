import { useI18n } from '@/app/i18n-provider'
import { type SimulatorSurfaceController } from '@/components/stackchan/simulator-surface'
import { Button } from '@/components/ui/button'

// Never inside the dock: these are the controls #32 calls out as most-used, and keeping them out
// here is what removes the open panel / press button / close panel / watch reaction round trip.
export function SimulatorMobileQuickControls({
  controller,
  onInput,
}: {
  controller: SimulatorSurfaceController
  onInput: (label: string) => void
}) {
  const { t } = useI18n()
  const { inputs } = controller.deviceProfile

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-1.5 border-t bg-background p-1.5 landscape:border-t-0 landscape:border-b"
      role="group"
      aria-label={t('クイック操作')}
    >
      {inputs.headTouch && (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              controller.headSwipe('forward')
              onInput(t('前方スワイプ'))
            }}
          >
            {t('前方スワイプ')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              controller.headSwipe('backward')
              onInput(t('後方スワイプ'))
            }}
          >
            {t('後方スワイプ')}
          </Button>
        </>
      )}
      {inputs.virtualButtons &&
        (['a', 'b', 'c'] as const).map((name) => (
          <Button
            key={name}
            size="sm"
            variant="outline"
            onClick={() => {
              controller.pushButton(name)
              onInput(name.toUpperCase())
            }}
          >
            {name.toUpperCase()}
          </Button>
        ))}
      {inputs.imu && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            controller.shakeImu()
            onInput(t('シェイク'))
          }}
        >
          {t('シェイク')}
        </Button>
      )}
    </div>
  )
}
