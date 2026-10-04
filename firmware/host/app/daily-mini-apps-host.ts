import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { createLifeQuestApp, createQuizApp } from 'daily-mini-apps'
import { LIFE_QUEST_DOMAIN, LIFE_QUEST_KEY } from 'life-quest'
import Preference from 'preference'
import { QUIZ_DOMAIN, QUIZ_KEY } from 'quiz'
import { workshopFor } from 'workshop-service'

export function installDailyMiniApps(context: StackchanContext): void {
  const storage = (domain: string, key: string) => ({
    get: () => Preference.get(domain, key),
    set: (value: string) => Preference.set(domain, key, value),
  })
  const workshop = workshopFor(context)
  const effects = { activity: workshop.activity.bind(workshop), react: () => workshop.react('success') }
  const quizSession = () => {
    const deck = workshop.store.deck()
    if (!deck) return undefined
    let hash = 2166136261
    for (const char of JSON.stringify(deck)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    const identity = `${deck.id}:${hash >>> 0}`
    return {
      questions: deck.questions,
      storage: {
        get() {
          const raw = Preference.get('sc_quiz', 'state')
          if (typeof raw !== 'string') return undefined
          const saved = JSON.parse(raw)
          return saved.identity === identity ? saved.state : undefined
        },
        set(state: string) {
          Preference.set('sc_quiz', 'state', JSON.stringify({ identity, state }))
        },
      },
    }
  }
  const suppressIdle = () => suppressCompanionIdle(context)
  for (const definition of [
    createLifeQuestApp({ storage: storage(LIFE_QUEST_DOMAIN, LIFE_QUEST_KEY), suppressIdle, ...effects }),
    createQuizApp({ storage: storage(QUIZ_DOMAIN, QUIZ_KEY), suppressIdle, quizSession, ...effects }),
  ]) {
    context.lifecycle.onClose(context.ui.miniApps.register(definition))
  }
}
