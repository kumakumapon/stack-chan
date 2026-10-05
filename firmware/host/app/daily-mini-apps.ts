import { LIFE_QUEST_TASKS, LifeQuest, type MiniAppStorage } from 'life-quest'
import { localize } from 'localization'
import type { MiniAppDefinition } from 'mini-app'
import { Container, Label, type Content as PiuContent, Text } from 'piu/MC'
import { Quiz, type QuizQuestion } from 'quiz'
import { bundledQuizQuestions } from 'quiz-questions'
import { ActionButton } from 'ui-controls'
import { uiStyles } from 'ui-theme'

export const LIFE_QUEST_APP_ID = 'stackchan.life-quest'
export const QUIZ_APP_ID = 'stackchan.quiz'
type Options = {
  storage: MiniAppStorage
  suppressIdle(): () => void
  activity?(kind: 'quest-complete' | 'quiz-complete', score: number): void
  react?(): () => void
  quizSession?(): { questions: readonly QuizQuestion[]; storage: MiniAppStorage } | undefined
}

function button(name: string, label: string, onTap: () => void, top: number, selected = false): PiuContent {
  const control = new ActionButton(
    { name, icon: 'play', label, onTap, selected },
    { left: 8, right: 8, top, height: 32 },
  )
  if (control.first) control.first.coordinates = { ...control.first.coordinates, top: 0 }
  return control
}

function label(name: string, string: string, top: number): PiuContent {
  return new Label(null, { name, string, left: 8, right: 8, top, height: 20, style: uiStyles().body })
}

function paragraph(name: string, string: string, top: number, height: number): PiuContent {
  return new Text(null, { name, string, left: 8, right: 8, top, height, style: uiStyles().body })
}

export function createLifeQuestApp(options: Options): MiniAppDefinition {
  return {
    id: LIFE_QUEST_APP_ID,
    title: localize('quest.title'),
    icon: 'play',
    create() {
      const model = new LifeQuest(options.storage)
      const releaseIdle = options.suppressIdle()
      const content = new Container(null, {
        name: 'lifeQuest',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: uiStyles().screen,
      })
      let confirming = false
      let disposed = false
      let cancelReaction: (() => void) | undefined
      const render = () => {
        if (disposed) return
        const state = model.snapshot()
        content.empty()
        if (confirming) {
          content.add(paragraph('questConfirm', localize('quest.confirmReset'), 30, 60))
          content.add(
            button(
              'questResetConfirm',
              localize('quest.newRound'),
              () => {
                if (!confirming || disposed) return
                confirming = false
                model.newRound()
                render()
              },
              110,
            ),
          )
          content.add(
            button(
              'questResetCancel',
              localize('quest.keep'),
              () => {
                confirming = false
                render()
              },
              152,
            ),
          )
          return
        }
        content.add(
          label(
            'questStatus',
            localize(state.celebration ? 'quest.celebrate' : state.complete ? 'quest.complete' : 'quest.hint'),
            0,
          ),
        )
        for (let index = 0; index < LIFE_QUEST_TASKS.length; index++) {
          content.add(
            button(
              `questTask:${index}`,
              `${state.done[index] ? '[x]' : '[ ]'} ${localize(`quest.task.${LIFE_QUEST_TASKS[index]}`)}`,
              () => {
                if (disposed) return
                if (
                  model.setDone(index, !state.done[index]) &&
                  model.snapshot().celebration &&
                  !model.snapshot().storageFailed
                ) {
                  options.activity?.('quest-complete', 3)
                  cancelReaction?.()
                  cancelReaction = options.react?.()
                }
                render()
              },
              24 + index * 36,
              state.done[index],
            ),
          )
        }
        content.add(
          button(
            'questNewRound',
            localize('quest.newRound'),
            () => {
              confirming = true
              render()
            },
            132,
          ),
        )
        content.add(
          state.storageFailed
            ? button(
                'questRetrySave',
                localize('daily.retrySave'),
                () => {
                  model.retrySave()
                  render()
                },
                164,
              )
            : label('questSaveStatus', localize('quest.manualReset'), 176),
        )
      }
      render()
      return {
        content,
        dispose() {
          disposed = true
          model.close()
          cancelReaction?.()
          releaseIdle()
        },
      }
    },
  }
}

export function createQuizApp(options: Options): MiniAppDefinition {
  return {
    id: QUIZ_APP_ID,
    title: localize('quiz.title'),
    icon: 'play',
    create() {
      const session = options.quizSession?.()
      const model = new Quiz(session?.questions ?? bundledQuizQuestions(localize), session?.storage ?? options.storage)
      const releaseIdle = options.suppressIdle()
      const content = new Container(null, {
        name: 'quizApp',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        skin: uiStyles().screen,
      })
      let disposed = false
      let cancelReaction: (() => void) | undefined
      const render = () => {
        if (disposed) return
        const state = model.snapshot()
        content.empty()
        content.add(
          label(
            'quizStatus',
            state.phase === 'ready'
              ? localize('quiz.hint')
              : state.phase === 'complete'
                ? `${localize('quiz.score')} ${state.score}/3`
                : `${localize('quiz.progress')} ${state.position}/3`,
            0,
          ),
        )
        if (state.phase === 'ready' || state.phase === 'complete') {
          content.add(
            paragraph(
              'quizReview',
              `${localize('quiz.review')} ${state.reviewCount}\n${localize('quiz.reviewHint')}`,
              64,
              68,
            ),
          )
          content.add(
            button(
              'quizStart',
              localize(state.phase === 'ready' ? 'quiz.start' : 'quiz.again'),
              () => {
                model.start()
                render()
              },
              24,
            ),
          )
        } else {
          const question = state.question
          if (!question) return
          if (state.phase === 'question') {
            content.add(paragraph('quizQuestion', question.prompt, 24, 40))
            question.choices.forEach((choice, index) => {
              content.add(
                button(
                  `quizChoice:${index}`,
                  choice,
                  () => {
                    if (disposed) return
                    model.answer(question.id, index)
                    render()
                  },
                  64 + index * 33,
                ),
              )
            })
          } else {
            content.add(
              label(
                'quizVerdict',
                localize(state.selected === question.answer ? 'quiz.correct' : 'quiz.incorrect'),
                64,
              ),
            )
            content.add(
              paragraph(
                'quizExplanation',
                `${localize('quiz.answer')} ${question.choices[question.answer]}\n${question.explanation}`,
                86,
                58,
              ),
            )
            content.add(
              button(
                'quizNext',
                localize(state.position === 3 ? 'quiz.result' : 'quiz.next'),
                () => {
                  if (model.next() && model.snapshot().phase === 'complete' && !model.snapshot().storageFailed) {
                    options.activity?.('quiz-complete', model.snapshot().score)
                    cancelReaction?.()
                    cancelReaction = options.react?.()
                  }
                  render()
                },
                24,
              ),
            )
          }
        }
        content.add(
          state.storageFailed
            ? button(
                'quizRetrySave',
                localize('daily.retrySave'),
                () => {
                  model.retrySave()
                  render()
                },
                164,
              )
            : label('quizSaveStatus', localize('quiz.savedHint'), 176),
        )
      }
      render()
      return {
        content,
        dispose() {
          disposed = true
          model.close()
          cancelReaction?.()
          releaseIdle()
        },
      }
    },
  }
}
