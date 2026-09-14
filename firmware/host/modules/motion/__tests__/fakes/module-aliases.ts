/**
 * Node resolution hooks for the motion modules.
 *
 * The SCServo protocol imports Moddable module names, and `embedded:io/serial`
 * is not loadable by Node at all because `embedded:` parses as a URL scheme.
 * Mapping the names here lets the real protocol implementation run against a
 * fake serial port, so transport faults can be reproduced without a device.
 *
 * Register it before importing the modules under test:
 *
 * ```ts
 * register(new URL('./fakes/module-aliases.js', import.meta.url))
 * ```
 */

const ALIASES: Record<string, string> = {
  'embedded:io/serial': './serial.js',
  'py32-io-expander': './py32-io-expander-stub.js',
  'mc/config': '../../../testing/fakes/mc-config.js',
  timer: '../../../testing/fakes/timer.js',
  'servo-command-error': '../../internal/servo-command-error.js',
  'single-wait-slot': '../../internal/single-wait-slot.js',
  'm5stackchan-servo': '../../m5stackchan-servo.js',
  'motion-controller': '../../motion-controller.js',
  'stackchan-util': '../../../util/stackchan-util.js',
  'protocols/scservo': '../../protocols/scservo.js',
  'protocols/scservo-codec': '../../protocols/scservo-codec.js',
  'protocols/scservo-decoder': '../../protocols/scservo-decoder.js',
}

type ResolveContext = { parentURL?: string }
type ResolveResult = { url: string; shortCircuit?: boolean }
type NextResolve = (specifier: string, context: ResolveContext) => ResolveResult | Promise<ResolveResult>

export function resolve(specifier: string, context: ResolveContext, next: NextResolve) {
  const target = ALIASES[specifier]
  if (target === undefined) return next(specifier, context)
  return { url: new URL(target, import.meta.url).href, shortCircuit: true }
}
