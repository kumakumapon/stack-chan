import { writeFileSync } from 'node:fs'

const key = process.env.MINISTACK_SHARED_KEY
if (typeof key !== 'string' || key.length < 16 || key.length > 128)
  throw new Error('Set MINISTACK_SHARED_KEY to 16–128 characters')
writeFileSync(new URL('./config.local.js', import.meta.url), `export default ${JSON.stringify(key)}\n`, { mode: 0o600 })
console.log('Created ignored local MOD configuration. Do not distribute the resulting private MOD archive.')
