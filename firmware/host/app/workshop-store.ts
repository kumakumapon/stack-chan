import type { MiniAppStorage } from './life-quest.js'
import { parseQuizDeck, type QuizDeck } from './workshop-model.js'

export type WorkshopSettings = { version: 1; gestures: boolean; sound: boolean; pet: boolean; receiving: boolean }
export const defaultWorkshopSettings = (): WorkshopSettings => ({
  version: 1,
  gestures: false,
  sound: false,
  pet: false,
  receiving: false,
})

export class WorkshopStore {
  #settings = defaultWorkshopSettings()
  #deck: QuizDeck | undefined
  #revision = 0
  constructor(
    private settingsStorage: MiniAppStorage,
    private deckStorage: MiniAppStorage,
  ) {
    try {
      const raw = settingsStorage.get()
      if (typeof raw === 'string' && raw.length <= 512) {
        const value = JSON.parse(raw)
        if (
          value?.version === 1 &&
          ['gestures', 'sound', 'pet', 'receiving'].every((key) => typeof value[key] === 'boolean')
        )
          this.#settings = {
            version: 1,
            gestures: value.gestures,
            sound: value.sound,
            pet: value.pet,
            receiving: value.receiving,
          }
      }
      const deck = deckStorage.get()
      if (typeof deck === 'string') this.#deck = parseQuizDeck(deck)
    } catch {
      /* A corrupt custom deck falls back to the bundled questions. */
    }
  }
  settings(): Readonly<WorkshopSettings> {
    return { ...this.#settings }
  }
  set(key: keyof Omit<WorkshopSettings, 'version'>, value: boolean): void {
    if (!['gestures', 'sound', 'pet', 'receiving'].includes(key) || typeof value !== 'boolean')
      throw new Error('Invalid setting')
    const next = { ...this.#settings, [key]: value }
    this.settingsStorage.set(JSON.stringify(next))
    this.#settings = next
  }
  importDeck(json: string): void {
    const next = parseQuizDeck(json)
    this.deckStorage.set(JSON.stringify(next))
    this.#deck = next
    this.#revision++
  }
  deck(): QuizDeck | undefined {
    return this.#deck
  }
  revision(): number {
    return this.#revision
  }
}
