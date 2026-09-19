import loadPreferences from 'loadPreference'
import { DOMAIN } from 'consts'
import type { StackchanDock } from 'dock'
import config from 'mc/config'
import Modules from 'modules'

const router: StackchanDock = {
  start(modConfig) {
    try {
      const conversation = loadPreferences(DOMAIN.conversation)
      let browser: Record<string, unknown> | undefined
      if (Modules.has('stackchan-gateway-browser')) {
        const exchange = Modules.importNow('stackchan-gateway-browser') as (request: object) => Record<string, unknown>
        browser = exchange({ action: 'config' })
        if (browser) conversation.backend = browser.backend
      }
      const defaults = config as {
        usbAudio?: { enabled?: boolean; autoStart?: boolean }
        gateway?: { enabled?: boolean; autoStart?: boolean }
      }
      const backend =
        conversation.backend ??
        ((modConfig as { gateway?: { enabled?: boolean }; usbAudio?: { enabled?: boolean } })?.gateway?.enabled
          ? 'gateway'
          : (modConfig as { usbAudio?: { enabled?: boolean } })?.usbAudio?.enabled
            ? 'usb'
            : defaults.gateway?.enabled
              ? 'gateway'
              : defaults.usbAudio?.enabled
                ? 'usb'
                : 'none')
      if (backend === 'none') return
      if (backend !== 'gateway' && backend !== 'usb') throw new Error('Unknown conversation backend')
      const specifier = backend === 'gateway' ? 'stackchan-gateway-dock' : 'stackchan-usb-dock'
      if (!Modules.has(specifier)) throw new Error(`Conversation backend unavailable: ${backend}`)
      const dock = Modules.importNow(specifier) as StackchanDock
      const key = backend === 'gateway' ? 'gateway' : 'usbAudio'
      const source = (modConfig ?? {}) as Record<string, unknown>
      return dock.start({
        ...source,
        [key]: {
          ...((source[key] as object) ?? {}),
          ...browser,
          enabled: true,
          autoStart:
            conversation.autoStart === undefined
              ? defaults[key]?.autoStart
              : conversation.autoStart === 1 || conversation.autoStart === true,
        },
      })
    } catch (error) {
      const message = `Conversation setup: ${String(error)}`
      trace(`${message}\n`)
      return {
        onContextCreated(context) {
          context.showBalloon(message)
        },
        close() {},
      }
    }
  },
}
export default router
