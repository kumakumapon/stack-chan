import type { StackchanContext } from 'capabilities'
import { suppressCompanionIdle } from 'companion-idle'
import { createLifeQuestApp, createQuizApp } from 'daily-mini-apps'
import { LIFE_QUEST_DOMAIN, LIFE_QUEST_KEY } from 'life-quest'
import Preference from 'preference'
import { QUIZ_DOMAIN, QUIZ_KEY } from 'quiz'

export function installDailyMiniApps(context: StackchanContext): void {
  const storage = (domain: string, key: string) => ({
    get: () => Preference.get(domain, key),
    set: (value: string) => Preference.set(domain, key, value),
  })
  const suppressIdle = () => suppressCompanionIdle(context)
  for (const definition of [
    createLifeQuestApp({ storage: storage(LIFE_QUEST_DOMAIN, LIFE_QUEST_KEY), suppressIdle }),
    createQuizApp({ storage: storage(QUIZ_DOMAIN, QUIZ_KEY), suppressIdle }),
  ]) {
    context.lifecycle.onClose(context.ui.miniApps.register(definition))
  }
}
