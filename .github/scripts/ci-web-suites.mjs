import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const suites = Object.freeze({
  pages: 'visual-pages-test.mjs',
  simulator: 'simulator/visual-test.mjs',
  i18n: 'i18n-visual-test.mjs',
  pet: 'simulator/pet-test.mjs',
  focus: 'simulator/focus-timer-test.mjs',
  memory: 'simulator/memory-game-test.mjs',
  rhythm: 'simulator/rhythm-game-test.mjs',
  'play-pack': 'simulator/play-pack-test.mjs',
  'daily-mini-apps': 'simulator/daily-mini-apps-test.mjs',
  workshop: 'simulator/workshop-test.mjs',
  companion: 'simulator/companion-test.mjs',
})

export function suiteEntry(name) {
  if (!Object.hasOwn(suites, name)) throw new Error(`Unknown web suite: ${name}`)
  return suites[name]
}

// Tests serve the downloaded dist but also check these generated source files.
// Restore them from that same artifact; never rebuild WASM or the web app here.
export function restoreRuntime(webRoot) {
  const files = ['simulator/mc.js', 'simulator/mc.wasm', 'mod-gallery/samples/stackchan-pet/stackchan-pet.xsa']
  for (const file of ['index.html', ...files]) {
    const path = resolve(webRoot, 'dist', file)
    if (!statSync(path).isFile() || statSync(path).size === 0) throw new Error(`Missing web runtime: ${file}`)
  }
  for (const file of files) {
    const target = resolve(webRoot, file)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(resolve(webRoot, 'dist', file), target)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'matrix') {
      console.log(JSON.stringify({ suite: Object.keys(suites) }))
    } else if (process.argv[2] === 'run') {
      const entry = suiteEntry(process.env.STACKCHAN_WEB_SUITE)
      const webRoot = fileURLToPath(new URL('../../web/', import.meta.url))
      restoreRuntime(webRoot)
      console.log(`Running ${entry} against the shared web runtime`)
      const result = spawnSync(process.execPath, [entry], { cwd: webRoot, stdio: 'inherit' })
      if (result.error) throw result.error
      process.exitCode = result.status ?? 1
    } else {
      throw new Error('Usage: ci-web-suites.mjs matrix|run')
    }
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
