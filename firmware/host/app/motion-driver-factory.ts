import { M5StackChanServoDriver } from 'm5stackchan-servo-driver'
import type { MotionDriver } from 'motion-controller'
import { NoneDriver } from 'none-driver'

type HostMotionDriverOptions = NonNullable<ConstructorParameters<typeof M5StackChanServoDriver>[0]> & {
  type?: string
}

/** The product uses its calibrated servo driver; desktop hosts use the no-hardware driver. */
export function createHostMotionDriver(preferences: HostMotionDriverOptions = {}): MotionDriver {
  switch (preferences.type ?? 'm5stackchan') {
    case 'm5stackchan':
      return new M5StackChanServoDriver(preferences)
    case 'none':
      return new NoneDriver()
    default:
      throw new Error(`Unsupported motion driver: ${preferences.type}`)
  }
}
