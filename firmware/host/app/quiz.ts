import type { MiniAppStorage } from './life-quest.js'

export const QUIZ_DOMAIN = 'stackchan_quiz'
export const QUIZ_KEY = 'state'
export type QuizQuestion = Readonly<{
  id: string
  prompt: string
  choices: readonly string[]
  answer: number
  explanation: string
}>
export type QuizSnapshot = Readonly<{
  phase: 'ready' | 'question' | 'feedback' | 'complete'
  question: QuizQuestion | undefined
  position: number
  score: number
  selected: number | undefined
  reviewCount: number
  storageFailed: boolean
}>

/** Limits are also suitable for a future import path; no JSON import UI is exposed yet. */
export function validateQuizQuestions(value: unknown): asserts value is readonly QuizQuestion[] {
  const text = (item: unknown, limit: number) =>
    typeof item === 'string' && item.trim().length > 0 && item.length <= limit
  if (!Array.isArray(value) || value.length < 3 || value.length > 32) throw new Error('Quiz requires 3–32 questions')
  const ids = new Set<string>()
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      !text(item.id, 32) ||
      !/^[a-z0-9-]+$/.test(item.id) ||
      ids.has(item.id) ||
      !text(item.prompt, 80) ||
      !text(item.explanation, 120) ||
      !Array.isArray(item.choices) ||
      item.choices.length < 2 ||
      item.choices.length > 3 ||
      !item.choices.every((choice: unknown) => text(choice, 36)) ||
      !Number.isInteger(item.answer) ||
      item.answer < 0 ||
      item.answer >= item.choices.length
    )
      throw new Error('Invalid quiz question')
    ids.add(item.id)
  }
}

export class Quiz {
  #questions: readonly QuizQuestion[]
  #storage: MiniAppStorage
  #review: string[] = []
  #cursor = 0
  #round: QuizQuestion[] = []
  #position = 0
  #score = 0
  #selected: number | undefined
  #phase: QuizSnapshot['phase'] = 'ready'
  #storageFailed = false
  #closed = false

  constructor(questions: readonly QuizQuestion[], storage: MiniAppStorage) {
    validateQuizQuestions(questions)
    this.#questions = questions.map((question) =>
      Object.freeze({ ...question, choices: Object.freeze(question.choices.slice()) }),
    )
    this.#storage = storage
    try {
      const raw = storage.get()
      if (raw === undefined) return
      if (typeof raw !== 'string' || raw.length > 4096) throw new Error('Invalid quiz state')
      const saved = JSON.parse(raw)
      if (
        saved?.version !== 1 ||
        !Number.isInteger(saved.cursor) ||
        saved.cursor < 0 ||
        saved.cursor >= questions.length ||
        !Array.isArray(saved.review) ||
        saved.review.length > questions.length ||
        !saved.review.every(
          (id: unknown) => typeof id === 'string' && questions.some((question) => question.id === id),
        ) ||
        new Set(saved.review).size !== saved.review.length
      )
        throw new Error('Invalid quiz state')
      this.#cursor = saved.cursor
      this.#review = saved.review.slice()
    } catch {
      this.#storageFailed = true
    }
  }

  snapshot(): QuizSnapshot {
    return Object.freeze({
      phase: this.#phase,
      question: this.#round[this.#position],
      position: this.#position + 1,
      score: this.#score,
      selected: this.#selected,
      reviewCount: this.#review.length,
      storageFailed: this.#storageFailed,
    })
  }

  start(): boolean {
    if (this.#closed || (this.#phase !== 'ready' && this.#phase !== 'complete')) return false
    const ids = this.#review.slice(0, 3)
    let scanned = 0
    while (ids.length < 3) {
      const question = this.#questions[(this.#cursor + scanned++) % this.#questions.length]
      if (!ids.includes(question.id)) ids.push(question.id)
    }
    this.#cursor = (this.#cursor + scanned) % this.#questions.length
    this.#round = ids.map((id) => this.#questions.find((question) => question.id === id) as QuizQuestion)
    this.#position = 0
    this.#score = 0
    this.#selected = undefined
    this.#phase = 'question'
    this.#save()
    return true
  }

  answer(questionId: string, choice: number): boolean {
    const question = this.#round[this.#position]
    if (
      this.#closed ||
      this.#phase !== 'question' ||
      question?.id !== questionId ||
      !Number.isInteger(choice) ||
      choice < 0 ||
      choice >= question.choices.length
    )
      return false
    this.#selected = choice
    this.#phase = 'feedback'
    if (choice === question.answer) {
      this.#score++
      this.#review = this.#review.filter((id) => id !== question.id)
    } else if (!this.#review.includes(question.id)) this.#review.push(question.id)
    this.#save()
    return true
  }

  next(): boolean {
    if (this.#closed || this.#phase !== 'feedback') return false
    if (this.#position === 2) this.#phase = 'complete'
    else {
      this.#position++
      this.#phase = 'question'
    }
    this.#selected = undefined
    return true
  }

  retrySave(): void {
    if (!this.#closed) this.#save()
  }
  close(): void {
    this.#closed = true
  }

  #save(): void {
    try {
      this.#storage.set(JSON.stringify({ version: 1, cursor: this.#cursor, review: this.#review }))
      this.#storageFailed = false
    } catch {
      this.#storageFailed = true
    }
  }
}
