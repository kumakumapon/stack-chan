import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { firmwareCapacity, renderSizeReport, resourceSizes } from './lib/firmware-size-report.mjs'

const target = process.argv[2]
const targets = ['m5stack', 'm5stack_core2', 'm5stack_cores3', 'm5stackchan_cores3', 'stackchan_rt', 'takao_core2_sg90']
if (!targets.includes(target)) throw new Error('A supported release target is required')
const binary = path.resolve('dist/bin/esp32', target, 'release/stack-chan-host')
const temporary = path.resolve('dist/tmp/esp32', target, 'release/stack-chan-host')
const capacity = firmwareCapacity(binary)
const resources = resourceSizes(
  readFileSync(path.join(temporary, 'mc.resources.c'), 'utf8'),
  path.join(temporary, 'resources'),
)
const report = renderSizeReport(target, capacity, resources)
mkdirSync('dist/size-reports', { recursive: true })
writeFileSync(`dist/size-reports/${target}.json`, JSON.stringify({ target, ...capacity, resources }, null, 2))
writeFileSync(`dist/size-reports/${target}.md`, report)
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)
