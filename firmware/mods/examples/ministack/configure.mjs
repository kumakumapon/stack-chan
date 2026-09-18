import { writeFileSync } from 'node:fs'

import { sharedKeyProblem } from './controller.js'

const key = process.env.MINISTACK_SHARED_KEY
// Validated with the transport's own rule rather than a string-length
// approximation: a key this script accepts but localPeer.open() refuses builds
// into the MOD and only fails on the device, where nothing names the length.
const problem = sharedKeyProblem(key)
if (problem) throw new Error(`Set MINISTACK_SHARED_KEY: ${problem}`)
writeFileSync(new URL('./config.local.js', import.meta.url), `export default ${JSON.stringify(key)}\n`, { mode: 0o600 })
console.log('Created ignored local MOD configuration. Do not distribute the resulting private MOD archive.')
