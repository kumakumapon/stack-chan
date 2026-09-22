import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeAliasPackage } from '../../../../modules/testing/node-alias-package.js'

/**
 * Publishes the bare specifiers the Gateway Dock imports at runtime. Moddable
 * resolves them from the Dock manifest; `node --test` needs a real package.
 */
export function installGatewayDockTestAliases(): void {
  const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
  const remoteSessionRoot = resolve(hostRoot, 'app/remote-session')
  const gatewayRoot = resolve(hostRoot, 'modules/conversation/gateway')
  const gatewayDockRoot = resolve(hostRoot, 'app/docks/gateway')
  writeAliasPackage(hostRoot, 'stackchan-gateway-pcm', resolve(gatewayDockRoot, 'pcm.js'))
  writeAliasPackage(hostRoot, 'stackchan-application-event', resolve(remoteSessionRoot, 'application-event.js'))
  writeAliasPackage(hostRoot, 'stackchan-remote-session-facade', resolve(remoteSessionRoot, 'facade.js'))
  writeAliasPackage(hostRoot, 'stackchan-gateway-protocol', resolve(gatewayRoot, 'gateway-protocol.js'))
  writeAliasPackage(hostRoot, 'stackchan-gateway-config', resolve(gatewayRoot, 'gateway-config.js'))
  // The bridge lives under the app layer (it depends on app-layer contracts
  // such as StackchanContext and the realtime session types), unlike the
  // pure, module-layer protocol and config above.
  writeAliasPackage(hostRoot, 'stackchan-gateway-bridge', resolve(gatewayDockRoot, 'bridge.js'))
  writeAliasPackage(hostRoot, 'stackchan-gateway-dock-presentation', resolve(gatewayDockRoot, 'presentation.js'))
}
