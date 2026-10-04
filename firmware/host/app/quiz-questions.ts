import type { QuizQuestion } from './quiz.js'

/** Small original fact set. Answer indices are locale-independent. */
export function bundledQuizQuestions(localize: (key: string) => string): readonly QuizQuestion[] {
  return [
    { id: 'sum', choices: ['4', '5', '6'], answer: 1 },
    { id: 'byte', choices: ['4', '8', '16'], answer: 1 },
    { id: 'minute', choices: ['30', '60', '100'], answer: 1 },
    { id: 'triangle', choices: ['3', '4', '5'], answer: 0 },
    { id: 'week', choices: ['5', '6', '7'], answer: 2 },
    { id: 'binary', choices: ['2', '8', '10'], answer: 0 },
  ].map((question) => ({
    ...question,
    prompt: localize(`quiz.question.${question.id}`),
    explanation: localize(`quiz.explanation.${question.id}`),
  }))
}
