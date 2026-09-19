import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export function resolveChromium() {
  const executablePath = [
    process.env.CHROMIUM_PATH,
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate))
  if (!executablePath) throw new Error('Chromium executable not found; set CHROMIUM_PATH')
  return executablePath
}

async function previewReady(baseUrl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1_000)
  try {
    return await fetch(baseUrl, { signal: controller.signal })
      .then((response) => response.ok)
      .catch(() => false)
  } finally {
    clearTimeout(timeout)
  }
}

export async function startPreview({ port, url }) {
  const baseUrl = url ?? `http://127.0.0.1:${port}`
  const server = url
    ? undefined
    : spawn(
        process.execPath,
        [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        { cwd: process.cwd(), stdio: 'inherit' }
      )
  let startupFinished = false
  const startupFailure = server
    ? new Promise((_, reject) => {
        server.once('error', (error) => {
          if (!startupFinished) reject(new Error(`Vite preview could not start: ${error.message}`, { cause: error }))
        })
        server.once('exit', (code, signal) => {
          if (!startupFinished) {
            reject(
              new Error(
                `Vite preview exited before readiness with exit code ${String(code)}${
                  signal ? ` (signal ${signal})` : ''
                }`
              )
            )
          }
        })
      })
    : new Promise(() => {})

  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const ready = await Promise.race([previewReady(baseUrl), startupFailure])
      if (ready) {
        startupFinished = true
        return { baseUrl, server }
      }
      await Promise.race([new Promise((resolveDelay) => setTimeout(resolveDelay, 100)), startupFailure])
    }
    throw new Error(`Vite preview did not start at ${baseUrl}`)
  } catch (error) {
    startupFinished = true
    server?.kill('SIGTERM')
    throw error
  }
}
