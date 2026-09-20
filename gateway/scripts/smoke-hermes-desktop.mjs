// Explicit live check: sends one short synthetic text turn, never records a mic.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { WebSocket } from 'ws'

const token = (await readFile(new URL('../dist/runtime/device-token', import.meta.url), 'utf8')).trim()
const socket = new WebSocket(process.env.STACKCHAN_SMOKE_URL ?? 'ws://127.0.0.1:8766/')
const counts = new Map()
let output = ''
let started = false
const timer = setTimeout(() => { console.error('Smoke timed out'); socket.terminate(); process.exitCode = 1 }, 120000)
socket.on('error', () => { clearTimeout(timer); console.error('Smoke connection failed'); process.exitCode = 1 })
socket.on('open', () => socket.send(JSON.stringify({
  schema: 'stackchan.gateway.v1', type: 'session.hello', protocolVersion: 1,
  deviceId: 'stackchan-smoke', clientId: 'smoke', token,
  capabilities: { audioInput: [{ codec: 'pcm16', sampleRate: 16000, channels: 1 }], audioOutput: [{ codec: 'pcm16', sampleRate: 16000, channels: 1 }], embodiment: [], approval: true },
})))
socket.on('message', data => {
  const frame = JSON.parse(data.toString())
  counts.set(frame.type, (counts.get(frame.type) ?? 0) + 1)
  if (frame.type === 'session.created') socket.send(JSON.stringify({ schema: 'stackchan.event.v1', type: 'conversation.start', requestId: 'smoke-start', source: 'headTouch', gesture: 'forwardSwipe' }))
  if (frame.type === 'conversation.result' && frame.success && frame.state === 'listening' && !started) {
    started = true
    socket.send(JSON.stringify({ schema: 'stackchan.gateway.v1', type: 'text.input', text: '接続テストです。「こんにちは、スタックちゃんです」とだけ答えてください。' }))
  }
  if (frame.type === 'transcript.output') output = frame.text
  if (frame.type === 'agent.error') { clearTimeout(timer); console.error('Gateway error:', frame.code); socket.close(); process.exitCode = 1 }
  if (frame.type === 'audio.completed') {
    clearTimeout(timer)
    assert.ok(output.length > 0)
    assert.ok(counts.get('audio.chunk') > 0)
    console.log(JSON.stringify({ transcript: output, audioChunks: counts.get('audio.chunk'), complete: true }))
    socket.send(JSON.stringify({ schema: 'stackchan.event.v1', type: 'conversation.stop', requestId: 'smoke-stop' }))
    socket.close()
  }
})
