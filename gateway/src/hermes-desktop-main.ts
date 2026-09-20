import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  createHermesDesktopBackend,
  createHermesDesktopClient,
  createHermesDesktopStt,
  createHermesDesktopTts,
} from './agent/hermes-desktop.ts'
import { createWindowsTts } from './audio/windows-tts.ts'
import { parseGatewayConfig } from './config.ts'
import { createGatewayServer } from './server/gateway-server.ts'

// Runtime secrets live only in the ignored build tree, never in source control.
const runtime = new URL('./runtime/', import.meta.url)
await mkdir(runtime, { recursive: true })
const credentialFile = new URL('device-token', runtime)
let token: string
try {
  token = (await readFile(credentialFile, 'utf8')).trim()
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  token = randomBytes(32).toString('hex')
  await writeFile(credentialFile, token, { mode: 0o600, flag: 'wx' })
}
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid device credential file')
const config = parseGatewayConfig({
  gateway: {
    listen: {
      host: process.env.STACKCHAN_LISTEN_HOST ?? '127.0.0.1',
      port: Number(process.env.STACKCHAN_PORT ?? 8766),
      path: '/',
    },
    token,
  },
})
if (!process.env.HERMES_DESKTOP_URL) throw new Error('Set HERMES_DESKTOP_URL to the running local Hermes backend')
const client = createHermesDesktopClient(process.env.HERMES_DESKTOP_URL)
const server = createGatewayServer({
  config,
  backend: createHermesDesktopBackend(client),
  stt: createHermesDesktopStt(client),
  tts:
    process.env.STACKCHAN_TTS === 'windows'
      ? createWindowsTts()
      : createHermesDesktopTts(client, process.env.FFMPEG_PATH ?? 'ffmpeg'),
  logger: console.log,
  diagnostics: process.env.STACKCHAN_DIAGNOSTICS === '1',
})
const address = await server.listen()
console.log(`Stack-chan Hermes bridge listening on ws://${address.host}:${address.port}/`)
console.log(`Device credential stored at ${fileURLToPath(credentialFile)} (not logged)`)
console.log('Text-only Hermes inference; no agent tools. Microphone is opt-in on the device.')
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
