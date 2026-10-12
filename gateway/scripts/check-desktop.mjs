// Explicit live diagnostic; never part of npm test or CI.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { checkProvider, checkSpeech } from '../dist/desktop/checks.js'
import { createModelResponder } from '../dist/desktop/model.js'
import { REPLY_SCHEMA, parseReply } from '../dist/desktop/reply.js'
import { defaultSettings, PROVIDERS } from '../dist/desktop/settings.js'

const directory = fileURLToPath(new URL('../.runtime/live-check/', import.meta.url))
await mkdir(directory, { recursive: true })
const schemaPath = `${directory}/reply.schema.json`
await writeFile(schemaPath, JSON.stringify(REPLY_SCHEMA))
const settings = defaultSettings()
const requested = process.argv.filter(value => PROVIDERS.includes(value))
const providers = requested.length ? requested : PROVIDERS
const modelFlag = process.argv.indexOf('--model')
const selectedModel = modelFlag >= 0 ? process.argv[modelFlag + 1] : undefined
if (selectedModel && providers.length !== 1) throw new Error('--model は1プロバイダーだけを指定した場合に利用できます')
const respond = createModelResponder({ cwd: directory, schemaPath })
for (const provider of providers) {
  try {
    const check = await checkProvider(settings, provider, directory)
    console.log(`${provider}: ${check.message}`)
    if (process.argv.includes('--live')) {
      settings.provider = provider
      if (selectedModel) settings.providers[provider].model = selectedModel
      if (!selectedModel && check.models.length > 1) {
        console.log(`${provider}: 返答テストはモデル未選択のため省略。管理画面でモデルを選んでください`)
        continue
      }
      if (!selectedModel && check.models.length === 1) settings.providers[provider].model = check.models[0]
      const reply = parseReply(await respond({ settings, history: [], text: 'こんにちは。短く自己紹介してください。', signal: AbortSignal.timeout(120000) }))
      console.log(`${provider}: 日本語の構造化返答を確認 (${reply.text.length}文字)`)
    }
  } catch (error) { console.log(`${provider}: ${error instanceof Error ? error.message : '接続失敗'}`) }
}
const speech = await checkSpeech(settings)
console.log(speech.stt.message)
console.log(speech.tts.message)
