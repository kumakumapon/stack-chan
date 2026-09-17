import { SimulatorMobileSurface } from '@/components/stackchan/simulator-mobile-surface'
import { SimulatorSurface } from '@/components/stackchan/simulator-surface'
import { useSimulatorEngine } from '@/features/simulator/use-simulator-engine'
import { useMediaQuery } from '@/hooks/use-media-query'

// `(pointer: coarse) and (max-width: 1023px)` on purpose: a touch pointer plus a phone-class
// width, not an aspect ratio or plain width breakpoint. A portrait phone (390x844) and the same
// phone rotated to landscape (844x390) both satisfy this query, so flipping the device never
// flips which surface is mounted. If it did, the mobile/desktop switch below would remount the
// canvas and tear down and restart the running firmware on every rotation.
const MOBILE_SURFACE_QUERY = '(pointer: coarse) and (max-width: 1023px)'

export function SimulatorPage() {
  const isMobile = useMediaQuery(MOBILE_SURFACE_QUERY)
  const simulator = useSimulatorEngine(isMobile ? { performanceMode: 'mobile' } : undefined)
  return isMobile ? <SimulatorMobileSurface controller={simulator} /> : <SimulatorSurface controller={simulator} />
}
