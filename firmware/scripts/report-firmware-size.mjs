import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  assertXsKeyReserve,
  firmwareCapacity,
  renderSizeReport,
  resourceSizes,
  xsKeyCapacity,
} from './lib/firmware-size-report.mjs'

const target = process.argv[2]
const targets = ['m5stackchan_cores3']
if (!targets.includes(target)) throw new Error('A supported release target is required')
const binary = path.resolve('dist/bin/esp32', target, 'release/stack-chan-host')
const temporary = path.resolve('dist/tmp/esp32', target, 'release/stack-chan-host')
const capacity = firmwareCapacity(binary)
const resources = resourceSizes(
  readFileSync(path.join(temporary, 'mc.resources.c'), 'utf8'),
  path.join(temporary, 'resources'),
)
const keys = xsKeyCapacity(readFileSync(path.join(temporary, 'mc.xs.c'), 'utf8'))
const report = renderSizeReport(target, capacity, resources, keys)
mkdirSync('dist/size-reports', { recursive: true })
writeFileSync(`dist/size-reports/${target}.json`, JSON.stringify({ target, ...capacity, keys, resources }, null, 2))
writeFileSync(`dist/size-reports/${target}.md`, report)
console.log(report)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report)

assertXsKeyReserve(keys)
