import { type QuizQuestion, validateQuizQuestions } from './quiz.js'

export type QuizDeck = Readonly<{ version: 1; id: string; title: string; questions: readonly QuizQuestion[] }>
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,32}$/.test(value)
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export function parseQuizDeck(json: string): QuizDeck {
  if (typeof json !== 'string' || json.length > 20000) throw new Error('Quiz deck is too large')
  const value: unknown = JSON.parse(json)
  if (!record(value) || value.version !== 1 || !identifier(value.id) || !text(value.title, 32))
    throw new Error('Invalid quiz deck')
  validateQuizQuestions(value.questions)
  return {
    version: 1,
    id: value.id,
    title: value.title,
    questions: value.questions.map((q) => ({ ...q, choices: q.choices.slice() })),
  }
}

export const STUDIO_REACTIONS = [
  'yes',
  'no',
  'greeting',
  'thinking',
  'delighted',
  'sleepy-yawn',
  'success',
  'failure',
] as const
export const STUDIO_MOTIONS = [
  'nod',
  'shake',
  'sway-left',
  'sway-right',
  'bounce',
  'look-up',
  'look-down',
  'head-left',
  'head-right',
  'center',
] as const
export type StudioCue = Readonly<{
  at: number
  reaction?: (typeof STUDIO_REACTIONS)[number]
  motion?: (typeof STUDIO_MOTIONS)[number]
}>
export type StudioTimeline = Readonly<{ version: 1; title: string; durationMs: number; cues: readonly StudioCue[] }>

/** A deliberately small subset of Performance, without raw poses, speech or remote URLs. */
export function validateStudio(value: unknown): asserts value is StudioTimeline {
  if (
    !record(value) ||
    value.version !== 1 ||
    !text(value.title, 32) ||
    !Number.isInteger(value.durationMs) ||
    (value.durationMs as number) < 500 ||
    (value.durationMs as number) > 30000 ||
    !Array.isArray(value.cues) ||
    value.cues.length < 1 ||
    value.cues.length > 32
  )
    throw new Error('Invalid studio timeline')
  let previous = -1000
  for (const cue of value.cues) {
    if (
      !record(cue) ||
      !Number.isInteger(cue.at) ||
      (cue.at as number) < 0 ||
      (cue.at as number) + 500 > (value.durationMs as number) ||
      (cue.at as number) - previous < 500 ||
      Object.keys(cue).some((key) => !['at', 'reaction', 'motion'].includes(key)) ||
      (cue.reaction !== undefined) === (cue.motion !== undefined) ||
      (cue.reaction !== undefined && !(STUDIO_REACTIONS as readonly unknown[]).includes(cue.reaction)) ||
      (cue.motion !== undefined && !(STUDIO_MOTIONS as readonly unknown[]).includes(cue.motion))
    )
      throw new Error('Invalid studio cue (spacing >= 500 ms)')
    previous = cue.at as number
  }
}

export type StoryScene = Readonly<{
  id: string
  text: string
  reaction?: (typeof STUDIO_REACTIONS)[number]
  choices: readonly Readonly<{ label: string; next: string }>[]
}>
export type Story = Readonly<{ version: 1; start: string; scenes: readonly StoryScene[] }>

export function validateStory(value: unknown): asserts value is Story {
  if (
    !record(value) ||
    value.version !== 1 ||
    !identifier(value.start) ||
    !Array.isArray(value.scenes) ||
    value.scenes.length < 3 ||
    value.scenes.length > 16
  )
    throw new Error('Invalid story')
  const scenes = new Map<string, StoryScene>()
  for (const scene of value.scenes) {
    if (
      !record(scene) ||
      !identifier(scene.id) ||
      scenes.has(scene.id) ||
      !text(scene.text, 120) ||
      !Array.isArray(scene.choices) ||
      scene.choices.length > 2 ||
      (scene.reaction !== undefined && !(STUDIO_REACTIONS as readonly unknown[]).includes(scene.reaction)) ||
      !scene.choices.every((choice) => record(choice) && text(choice.label, 24) && identifier(choice.next))
    )
      throw new Error('Invalid story scene')
    scenes.set(scene.id, scene as StoryScene)
  }
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('Story contains a cycle')
    if (visited.has(id)) return
    const scene = scenes.get(id)
    if (!scene) throw new Error('Story references a missing scene')
    visiting.add(id)
    for (const choice of scene.choices) visit(choice.next)
    visiting.delete(id)
    visited.add(id)
  }
  visit(value.start)
  if (visited.size !== scenes.size) throw new Error('Story contains unreachable scenes')
}

export class StorySession {
  #story: Story
  #scene: string
  #closed = false
  constructor(story: Story) {
    validateStory(story)
    this.#story = JSON.parse(JSON.stringify(story))
    this.#scene = story.start
  }
  current(): StoryScene {
    return this.#story.scenes.find((scene) => scene.id === this.#scene) as StoryScene
  }
  choose(sceneId: string, index: number): boolean {
    if (this.#closed || sceneId !== this.#scene || !Number.isInteger(index)) return false
    const next = this.current().choices[index]?.next
    if (!next) return false
    this.#scene = next
    return true
  }
  restart(): void {
    if (!this.#closed) this.#scene = this.#story.start
  }
  close(): void {
    this.#closed = true
  }
}
