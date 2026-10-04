import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/app/i18n-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  parseQuizDeck,
  STUDIO_MOTIONS,
  STUDIO_REACTIONS,
  validateStudio,
  type QuizDeck,
  type StudioTimeline,
} from '../../../../firmware/host/app/workshop-model'
import type { useSimulatorEngine } from './use-simulator-engine'
import { uploadQuizToDevice } from './quiz-upload'

const initialDeck: QuizDeck = {
  version: 1,
  id: 'my-quiz',
  title: 'My quiz',
  questions: [
    { id: 'one', prompt: '1 + 1 = ?', choices: ['1', '2', '3'], answer: 1, explanation: '1 + 1 = 2' },
    { id: 'two', prompt: '2 + 2 = ?', choices: ['2', '3', '4'], answer: 2, explanation: '2 + 2 = 4' },
    { id: 'three', prompt: '3 + 3 = ?', choices: ['6', '7', '8'], answer: 0, explanation: '3 + 3 = 6' },
  ],
}
const initialStudio: StudioTimeline = {
  version: 1,
  title: 'My greeting',
  durationMs: 6000,
  cues: [
    { at: 0, motion: 'nod' },
    { at: 3000, reaction: 'greeting' },
  ],
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function WorkshopPanel({ controller }: { controller: ReturnType<typeof useSimulatorEngine> }) {
  const { t } = useI18n()
  const current = useRef(controller)
  current.current = controller
  const [deck, setDeck] = useState<QuizDeck>(initialDeck)
  const [studio, setStudio] = useState<StudioTimeline>(initialStudio)
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false)
  const [endpoint, setEndpoint] = useState('http://localhost:8765'),
    [deviceId, setDeviceId] = useState('stackchan-01'),
    [token, setToken] = useState('')
  useEffect(
    () => () => {
      void current.current.workshopCommand({ action: 'stop' }).catch(() => undefined)
    },
    []
  )
  const run = async (task: () => unknown | Promise<unknown>, message: string) => {
    if (busy) return
    setBusy(true)
    try {
      await task()
      setStatus(t(message))
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const saveStudio = () => {
    validateStudio(studio)
    localStorage.setItem('stackchan.studio.v1', JSON.stringify(studio))
  }
  const question = (index: number, patch: Partial<QuizDeck['questions'][number]>) =>
    setDeck({ ...deck, questions: deck.questions.map((item, i) => (i === index ? { ...item, ...patch } : item)) })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('暮らし工房')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <details>
          <summary className="cursor-pointer font-semibold">{t('クイズ教材を作る')}</summary>
          <div className="mt-3 grid gap-3">
            <label>
              {t('教材名')}
              <Input
                aria-label={t('教材名')}
                value={deck.title}
                maxLength={32}
                onChange={(event) => setDeck({ ...deck, title: event.target.value })}
              />
            </label>
            {deck.questions.map((item, index) => (
              <fieldset key={item.id} className="grid gap-2 rounded-lg border p-3">
                <legend>
                  {t('問題')} {index + 1}
                </legend>
                <Input
                  aria-label={`${t('問題文')} ${index + 1}`}
                  value={item.prompt}
                  maxLength={80}
                  onChange={(event) => question(index, { prompt: event.target.value })}
                />
                {item.choices.map((choice, choiceIndex) => (
                  <label key={choiceIndex} className="flex items-center gap-2">
                    <input
                      type="radio"
                      aria-label={`${t('正解')} ${index + 1}-${choiceIndex + 1}`}
                      checked={item.answer === choiceIndex}
                      onChange={() => question(index, { answer: choiceIndex })}
                    />
                    <Input
                      aria-label={`${t('選択肢')} ${index + 1}-${choiceIndex + 1}`}
                      value={choice}
                      maxLength={36}
                      onChange={(event) =>
                        question(index, {
                          choices: item.choices.map((old, i) => (i === choiceIndex ? event.target.value : old)),
                        })
                      }
                    />
                  </label>
                ))}
                <Input
                  aria-label={`${t('解説')} ${index + 1}`}
                  value={item.explanation}
                  maxLength={120}
                  onChange={(event) => question(index, { explanation: event.target.value })}
                />
                <Button
                  variant="outline"
                  disabled={deck.questions.length <= 3}
                  onClick={() => setDeck({ ...deck, questions: deck.questions.filter((_, i) => i !== index) })}
                >
                  {t('問題を削除')}
                </Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              disabled={deck.questions.length >= 32}
              onClick={() =>
                setDeck({
                  ...deck,
                  questions: [
                    ...deck.questions,
                    {
                      id: `q-${Date.now().toString(36)}`,
                      prompt: '',
                      choices: ['', '', ''],
                      answer: 0,
                      explanation: '',
                    },
                  ],
                })
              }
            >
              {t('問題を追加')}
            </Button>
            <label>
              {t('教材JSONを読み込む')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file)
                    void run(async () => {
                      if (file.size > 60000) throw Error(t('ファイルが大きすぎます'))
                      setDeck(parseQuizDeck(await file.text()))
                    }, '教材を読み込みました')
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => {
                    const checked = parseQuizDeck(JSON.stringify(deck))
                    download('quiz.json', checked)
                  }, '教材を保存しました')
                }
              >
                {t('教材を保存')}
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const checked = parseQuizDeck(JSON.stringify(deck))
                    await controller.workshopCommand({ action: 'quiz', value: JSON.stringify(checked) })
                  }, '取り込みました。クイズを開き直してください')
                }
              >
                {t('Simulatorに取り込む')}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(
                    () => uploadQuizToDevice(JSON.stringify(deck)),
                    '本体に保存しました。設定画面を閉じてクイズを開いてください'
                  )
                }
              >
                {t('本体に取り込む（BLE設定モード）')}
              </Button>
            </div>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer font-semibold">{t('仕草ミニスタジオ')}</summary>
          <div className="mt-3 grid gap-3">
            <label>
              {t('作品名')}
              <Input
                value={studio.title}
                maxLength={32}
                onChange={(event) => setStudio({ ...studio, title: event.target.value })}
              />
            </label>
            <label>
              {t('長さ（秒、最大30）')}
              <Input
                type="number"
                min={0.5}
                max={30}
                step={0.5}
                value={studio.durationMs / 1000}
                onChange={(event) => setStudio({ ...studio, durationMs: Number(event.target.value) * 1000 })}
              />
            </label>
            {studio.cues.map((cue, index) => (
              <fieldset key={index} className="grid gap-2 rounded-lg border p-3">
                <legend>
                  {t('仕草')} {index + 1}
                </legend>
                <label>
                  {t('開始（秒）')}
                  <Input
                    type="number"
                    min={0}
                    max={29.5}
                    step={0.5}
                    value={cue.at / 1000}
                    onChange={(event) =>
                      setStudio({
                        ...studio,
                        cues: studio.cues.map((old, i) =>
                          i === index ? { ...old, at: Number(event.target.value) * 1000 } : old
                        ),
                      })
                    }
                  />
                </label>
                <select
                  className="rounded border p-2"
                  aria-label={`${t('仕草')} ${index + 1}`}
                  value={cue.motion ? `motion:${cue.motion}` : `reaction:${cue.reaction}`}
                  onChange={(event) => {
                    const [kind, name] = event.target.value.split(':')
                    setStudio({
                      ...studio,
                      cues: studio.cues.map((old, i) =>
                        i === index ? { at: old.at, [kind!]: name } : old
                      ) as StudioTimeline['cues'],
                    })
                  }}
                >
                  {STUDIO_MOTIONS.map((name) => (
                    <option key={name} value={`motion:${name}`}>
                      {t(name)}
                    </option>
                  ))}
                  {STUDIO_REACTIONS.map((name) => (
                    <option key={name} value={`reaction:${name}`}>
                      {t(name)}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  onClick={() => setStudio({ ...studio, cues: studio.cues.filter((_, i) => i !== index) })}
                >
                  {t('仕草を削除')}
                </Button>
              </fieldset>
            ))}
            <Button
              variant="outline"
              disabled={studio.cues.length >= 32}
              onClick={() =>
                setStudio({
                  ...studio,
                  cues: [...studio.cues, { at: (studio.cues.at(-1)?.at ?? -3000) + 3000, motion: 'nod' }],
                })
              }
            >
              {t('仕草を追加')}
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    validateStudio(studio)
                    await controller.workshopCommand({ action: 'studio', value: studio })
                  }, '再生を開始しました')
                }
              >
                {t('再生')}
              </Button>
              <Button
                variant="outline"
                onClick={() => void run(() => controller.workshopCommand({ action: 'stop' }), '停止しました')}
              >
                {t('停止')}
              </Button>
              <Button variant="outline" onClick={() => void run(saveStudio, '作品を保存しました')}>
                {t('作品を保存')}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(() => {
                    const value = JSON.parse(localStorage.getItem('stackchan.studio.v1') ?? 'null')
                    validateStudio(value)
                    setStudio(value)
                  }, '作品を読み込みました')
                }
              >
                {t('保存した作品を読む')}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void run(() => {
                    validateStudio(studio)
                    download('studio.json', studio)
                  }, '作品を書き出しました')
                }
              >
                {t('JSONを書き出す')}
              </Button>
            </div>
            <label>
              {t('作品JSONを読み込む')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file)
                    void run(async () => {
                      if (file.size > 12000) throw Error(t('ファイルが大きすぎます'))
                      const value = JSON.parse(await file.text())
                      validateStudio(value)
                      setStudio(value)
                    }, '作品を読み込みました')
                }}
              />
            </label>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer font-semibold">{t('通知と伝言を受け取る')}</summary>
          <form
            className="mt-3 grid gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                () => controller.workshopCommand({ action: 'gateway', value: { endpoint, token, deviceId } }),
                '受信を開始しました。本体の暮らし工房で確認できます'
              )
            }}
          >
            <label>
              Gateway URL
              <Input required value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
            </label>
            <label>
              Device ID
              <Input required value={deviceId} onChange={(event) => setDeviceId(event.target.value)} />
            </label>
            <label>
              {t('Gatewayトークン')}
              <Input
                required
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <Button disabled={busy}>{t('受信を開始')}</Button>
            <p className="text-sm">{t('会話やマイクは開始しません。送信者の登録は本体の伝言箱で行います。')}</p>
          </form>
        </details>
        <p role="status" className="break-words text-sm">
          {status}
        </p>
      </CardContent>
    </Card>
  )
}
