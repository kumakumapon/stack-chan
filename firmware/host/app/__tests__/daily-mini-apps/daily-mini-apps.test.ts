import { AppController } from 'app-controller'
import { ChatStatusBar } from 'chat-status-bar'
import { isCompanionIdleSuppressed, suppressCompanionIdle } from 'companion-idle'
import { createLifeQuestApp, createQuizApp, LIFE_QUEST_APP_ID, QUIZ_APP_ID } from 'daily-mini-apps'
import { localize } from 'localization'
import { MiniAppLauncher } from 'mini-app-launcher'
import {
  Application,
  Container,
  type Container as PiuContainer,
  type Label as PiuLabel,
  type Scroller as PiuScroller,
} from 'piu/MC'
import { assert, equal } from 'testing/assert'

const application = new Application(
  { face: new Container(null, { left: 0, right: 0, top: 0, bottom: 0 }), appBar: new ChatStatusBar() },
  { contents: [], Behavior: AppController, displayListLength: 4096 },
)
const controller = application.behavior as AppController
const view = application.first as PiuContainer
const host = view.behavior as { main: PiuContainer; faceMain: PiuContainer; appBar: PiuContainer }
let questSaved: string | undefined
let quizSaved: string | undefined
let failSave = false
let results = 0
const activities: string[] = []
let cancellations = 0
const effects = {
  activity: (kind: string) => {
    activities.push(kind)
  },
  react: () => () => {
    cancellations++
  },
}
controller.miniApps.subscribeResult(() => results++)
const suppressIdle = () => suppressCompanionIdle(controller)
const unregisterQuest = controller.miniApps.register(
  createLifeQuestApp({
    suppressIdle,
    ...effects,
    storage: {
      get: () => questSaved,
      set: (value) => {
        if (failSave) throw new Error('full')
        questSaved = value
      },
    },
  }),
)
const unregisterQuiz = controller.miniApps.register(
  createQuizApp({
    suppressIdle,
    ...effects,
    storage: {
      get: () => quizSaved,
      set: (value) => {
        quizSaved = value
      },
    },
  }),
)
controller.miniApps.register({ id: 'test.pet', title: 'PET STATUS', create: () => new Container() })
function control(name: string): PiuContainer {
  return (host.main.first as PiuContainer).content(name) as PiuContainer
}
function tapContent(target: PiuContainer): void {
  assert(target?.active, 'control must be active')
  const input = target.behavior as {
    onTouchBegan(content: PiuContainer, id: number, x: number, y: number): void
    onTouchEnded(content: PiuContainer): void
  }
  input.onTouchBegan(target, 0, target.x + 10, target.y + 10)
  input.onTouchEnded(target)
}
function tap(name: string): void {
  tapContent(control(name))
}
function text(name: string): string {
  return (control(name) as unknown as PiuLabel).string
}

assert(controller.launchMiniApp(LIFE_QUEST_APP_ID), 'launch quest')
assert((host.appBar.content('backButton') as PiuContainer).active, 'Back remains available')
const stale = control('questTask:0')
tapContent(stale)
tapContent(stale)
equal(JSON.parse(questSaved as string).done.filter(Boolean).length, 1, 'repeated callback does not undo task')
tap('questTask:1')
tap('questTask:2')
equal(text('questStatus'), localize('quest.celebrate'), 'first completion celebrates')
tap('questTask:2')
tap('questTask:2')
equal(text('questStatus'), localize('quest.complete'), 'undo and redo does not celebrate again')
equal(activities.join(','), 'quest-complete', 'undo and redo emit one activity')
controller.onMiniAppBack()
equal(cancellations, 1, 'closing quest cancels its owned reaction')
assert(!isCompanionIdleSuppressed(controller), 'quest releases idle suppression')
assert(controller.launchMiniApp(LIFE_QUEST_APP_ID), 'quest reopens')
equal(text('questStatus'), localize('quest.complete'), 'saved progress restores')
tap('questNewRound')
tap('questResetCancel')
equal(text('questStatus'), localize('quest.complete'), 'cancel preserves progress')
tap('questNewRound')
tap('questResetConfirm')
equal(text('questStatus'), localize('quest.hint'), 'confirmed new round clears progress')
failSave = true
tap('questTask:0')
assert(control('questRetrySave'), 'save failure visible')
failSave = false
tap('questRetrySave')
assert(control('questSaveStatus'), 'retry saves progress')
const questBefore = questSaved
controller.onMiniAppBack()
tapContent(stale)
equal(questSaved, questBefore, 'closed screen ignores stale callback')

assert(controller.launchMiniApp(QUIZ_APP_ID), 'launch quiz')
tap('quizStart')
const answer = control('quizChoice:0')
tapContent(answer)
tapContent(answer)
equal(text('quizVerdict'), localize('quiz.incorrect'), 'wrong answer shows feedback')
assert(control('quizExplanation'), 'feedback includes explanation')
assert(!control('quizChoice:0'), 'no answer buttons remain during feedback')
equal(JSON.parse(quizSaved as string).review.length, 1, 'wrong answer saved once')
controller.onMiniAppBack()
assert(controller.launchMiniApp(QUIZ_APP_ID), 'reopen quiz')
tap('quizStart')
equal(text('quizQuestion'), localize('quiz.question.sum'), 'missed question comes first')
tap('quizChoice:1')
tap('quizNext')
for (let index = 0; index < 2; index++) {
  tap('quizChoice:0')
  tap('quizNext')
}
equal(text('quizStatus'), `${localize('quiz.score')} 2/3`, 'round ends after three answers')
equal(questSaved, questBefore, 'quiz leaves quest storage intact')
equal(results, 0, 'quest and quiz do not emit legacy game results')
equal(activities.join(','), 'quest-complete,quiz-complete', 'one activity per completed round')
unregisterQuiz()
assert(!isCompanionIdleSuppressed(controller), 'unregister releases active quiz')
assert(controller.launchMiniApp('test.pet'), 'Pet remains available')
unregisterQuest()
controller.onMiniAppBack()
const launcher = new MiniAppLauncher(
  {
    apps: Array.from({ length: 7 }, (_, index) => ({ id: `test.${index}`, title: `App ${index}` })),
    onLaunch: () => undefined,
  },
  { left: 0, top: 0, width: 320, height: 196 },
)
application.add(launcher)
const scroller = launcher.first as PiuScroller
const scrollBehavior = scroller.behavior as {
  onTouchBegan(content: PiuScroller, id: number, x: number, y: number): void
  onTouchMoved(content: PiuScroller, id: number, x: number, y: number, ticks: number): void
  waiting: boolean
}
scrollBehavior.onTouchBegan(scroller, 0, 20, 150)
scrollBehavior.onTouchMoved(scroller, 0, 20, 146, 0)
equal(scroller.scroll.y, 0, 'small movement preserves taps')
// Native touch capture needs an LCD touch stream; this checks scroll behavior only.
scrollBehavior.waiting = false
scrollBehavior.onTouchMoved(scroller, 0, 20, 20, 0)
assert((scroller.scroll.y ?? 0) > 0, 'drag scrolls launcher')
application.remove(launcher)
trace('ok\n')
