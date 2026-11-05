import type { Port as PiuPort } from 'piu/MC'

/** Tiny pixel art shared by the play pack Mini Apps. Coordinates are relative to a center point. */
export type PlayDirection = 'up' | 'down' | 'left' | 'right'
export type PlayHand = 'rock' | 'scissors' | 'paper'
export type PlayMood = 'neutral' | 'happy' | 'sad' | 'surprised' | 'sleepy'
type Rect = readonly [x: number, y: number, width: number, height: number]

const HANDS: Readonly<Record<PlayHand, readonly Rect[]>> = {
  rock: [
    [-16, -12, 32, 26],
    [-21, -2, 6, 12],
  ],
  scissors: [
    [-14, -22, 7, 8],
    [-12, -14, 7, 8],
    [-10, -6, 7, 8],
    [7, -22, 7, 8],
    [5, -14, 7, 8],
    [3, -6, 7, 8],
    [-14, 2, 28, 18],
  ],
  paper: [
    [-14, -20, 6, 20],
    [-6, -24, 6, 24],
    [2, -24, 6, 24],
    [10, -20, 6, 20],
    [-14, -2, 30, 22],
    [-22, 4, 8, 8],
  ],
}
/** Gaps carved back out of a hand so fingers stay readable at this size. */
const HAND_GAPS: Readonly<Record<PlayHand, readonly Rect[]>> = {
  rock: [
    [-8, -12, 2, 7],
    [0, -12, 2, 7],
    [8, -12, 2, 7],
  ],
  scissors: [
    [-8, 8, 16, 2],
    [-8, 14, 16, 2],
  ],
  paper: [],
}
const ARROW_UP: readonly Rect[] = [
  [-3, -4, 6, 22],
  ...[0, 1, 2, 3, 4, 5].map((step): Rect => [-(2 + 2 * step), -20 + 3 * step, 4 + 4 * step, 3]),
]

function orient([x, y, width, height]: Rect, direction: PlayDirection): Rect {
  if (direction === 'down') return [x, -y - height, width, height]
  if (direction === 'left') return [y, x, height, width]
  if (direction === 'right') return [-y - height, x, height, width]
  return [x, y, width, height]
}

function fill(port: PiuPort, color: string, cx: number, cy: number, rects: readonly Rect[]): void {
  for (const [x, y, width, height] of rects) port.fillColor(color, cx + x, cy + y, width, height)
}

export function drawHand(port: PiuPort, hand: PlayHand, cx: number, cy: number, color: string, gap: string): void {
  fill(port, color, cx, cy, HANDS[hand])
  fill(port, gap, cx, cy, HAND_GAPS[hand])
}

export function drawArrow(port: PiuPort, direction: PlayDirection, cx: number, cy: number, color: string): void {
  fill(
    port,
    color,
    cx,
    cy,
    ARROW_UP.map((rect) => orient(rect, direction)),
  )
}

/** Stack-chan's eyes and mouth. `gaze` shifts both eyes toward a screen direction. */
export function drawMiniFace(
  port: PiuPort,
  cx: number,
  cy: number,
  color: string,
  options: { gaze?: PlayDirection | null; mood?: PlayMood } = {},
): void {
  const mood = options.mood ?? 'neutral'
  const gaze = options.gaze ?? null
  const dx = gaze === 'left' ? -7 : gaze === 'right' ? 7 : 0
  const dy = gaze === 'up' ? -5 : gaze === 'down' ? 5 : 0
  for (const x of [cx - 28 + dx, cx + 20 + dx]) {
    const y = cy - 10 + dy
    if (mood === 'happy') {
      port.fillColor(color, x - 4, y + 4, 4, 4)
      port.fillColor(color, x, y, 8, 4)
      port.fillColor(color, x + 8, y + 4, 4, 4)
    } else if (mood === 'sad' || mood === 'sleepy') port.fillColor(color, x - 2, y + 4, 12, 3)
    else if (mood === 'surprised') port.fillColor(color, x, y - 3, 8, 14)
    else port.fillColor(color, x, y, 8, 8)
  }
  const mouthY = cy + 12
  if (mood === 'happy') {
    port.fillColor(color, cx - 12, mouthY, 24, 3)
    port.fillColor(color, cx - 15, mouthY - 3, 3, 3)
    port.fillColor(color, cx + 12, mouthY - 3, 3, 3)
  } else if (mood === 'sad') {
    port.fillColor(color, cx - 12, mouthY, 24, 3)
    port.fillColor(color, cx - 15, mouthY + 3, 3, 3)
    port.fillColor(color, cx + 12, mouthY + 3, 3, 3)
  } else if (mood === 'surprised') port.fillColor(color, cx - 5, mouthY - 3, 10, 10)
  else port.fillColor(color, cx - 12, mouthY, 24, 3)
}
