import assert from 'node:assert/strict'
import test from 'node:test'
import { runProcess } from './process.ts'

test('process runner preserves Japanese split across stdout chunks and treats shell characters as data', async () => {
  const output = await runProcess({
    command: process.execPath,
    cwd: process.cwd(),
    args: [
      '-e',
      'process.stdin.on("data",data=>{const bytes=Buffer.from("日本語:"+data);process.stdout.write(bytes.subarray(0,1));setTimeout(()=>process.stdout.write(bytes.subarray(1)),10)})',
    ],
    input: '& echo injected',
  })
  assert.equal(output, '日本語:& echo injected')
})

test('timeouts and cancellation terminate an invocation without waiting for its normal exit', async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      cwd: process.cwd(),
      args: ['-e', 'setTimeout(()=>{},10000)'],
      timeoutMs: 100,
    }),
    /タイムアウト/,
  )
  const controller = new AbortController()
  const pending = runProcess({
    command: process.execPath,
    cwd: process.cwd(),
    args: ['-e', 'setTimeout(()=>{},10000)'],
    signal: controller.signal,
  })
  setTimeout(() => controller.abort(), 100)
  await assert.rejects(pending, /中断/)
})
