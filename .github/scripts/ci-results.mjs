import { pathToFileURL } from 'node:url'

const firmwareJobs = ['biome', 'test-moddable', 'test-smoke']
const requiredJobs = {
  web: ['web-build', 'web-browser'],
  test: ['changes', 'test-fast', 'web-visual', ...firmwareJobs],
}

export function verifyResults(mode, needs, eventName) {
  const jobs = requiredJobs[mode]
  if (!jobs) throw new Error(`Unknown CI result group: ${mode}`)
  if (!needs || typeof needs !== 'object' || Array.isArray(needs)) {
    throw new Error('CI needs must be an object')
  }
  if (Object.keys(needs).sort().join(',') !== [...jobs].sort().join(',')) {
    throw new Error(`Expected CI dependencies: ${jobs.join(', ')}`)
  }

  let firmwareRequired = true
  if (mode === 'test') {
    if (!['push', 'pull_request', 'workflow_dispatch'].includes(eventName)) {
      throw new Error(`Unsupported CI event: ${eventName}`)
    }
    if (eventName !== 'workflow_dispatch') {
      const changed = needs.changes?.outputs?.firmware
      if (changed !== 'true' && changed !== 'false') {
        throw new Error('Firmware change detection must return true or false')
      }
      firmwareRequired = changed === 'true'
    }
  }

  for (const job of jobs) {
    const result = needs[job]?.result
    const expectedSkip = mode === 'test' && !firmwareRequired && firmwareJobs.includes(job)
    if (result !== 'success' && !(expectedSkip && result === 'skipped')) {
      throw new Error(`CI dependency ${job} did not pass: ${result ?? 'missing result'}`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyResults(process.argv[2], JSON.parse(process.env.CI_NEEDS ?? ''), process.env.GITHUB_EVENT_NAME)
    console.log(`All ${process.argv[2]} CI dependencies passed`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
