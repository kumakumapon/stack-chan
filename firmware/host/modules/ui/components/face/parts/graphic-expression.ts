import { Outline } from 'commodetto/outline'
import { Emotion, type FaceEyeKey } from 'face-state'
import { rememberCachedValue, unitFromStep } from 'parts/shape-cache'

// These designs use normalized vector paths, so the same face works on the
// standard and compact layouts without textures or additional image assets.
export function isGraphicEmotion(emotion: Emotion): boolean {
  return emotion >= Emotion.LOVE && emotion <= Emotion.ELECTRIC
}

// Preloaded modules are frozen by xsl. Allocate mutable caches at runtime.
let eyes: Map<string, Outline> | null = null
let mouths: Map<string, Outline> | null = null

export function graphicEyeOutline(width: number, height: number, emotion: Emotion, side: FaceEyeKey): Outline {
  if (!eyes) eyes = new Map()
  const key = `${width}:${height}:${emotion}:${side}`
  const cached = eyes.get(key)
  if (cached) return cached
  const path = new Outline.CanvasPath()
  let stroke = false
  switch (emotion) {
    case Emotion.LOVE:
      path.moveTo(50, 88)
      path.bezierCurveTo(5, 60, 0, 25, 26, 17)
      path.bezierCurveTo(40, 12, 48, 24, 50, 30)
      path.bezierCurveTo(68, 0, 98, 16, 90, 44)
      path.bezierCurveTo(86, 60, 65, 79, 50, 88)
      path.closePath()
      break
    case Emotion.STARSTRUCK:
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        const radius = i % 2 ? 19 : 44
        const x = 50 + Math.cos(angle) * radius
        const y = 50 + Math.sin(angle) * radius
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      }
      path.closePath()
      break
    case Emotion.DIZZY:
      stroke = true
      for (let i = 0; i <= 64; i++) {
        const angle = (i / 64) * Math.PI * 4
        const radius = 4 + (i / 64) * 36
        const x = 50 + Math.cos(angle) * radius
        const y = 50 + Math.sin(angle) * radius
        if (i === 0) path.moveTo(x, y)
        else path.lineTo(x, y)
      }
      break
    case Emotion.LAUGHING:
      stroke = true
      path.moveTo(13, 64)
      path.quadraticCurveTo(50, 8, 87, 64)
      break
    case Emotion.CRYING:
      path.moveTo(10, 35)
      path.quadraticCurveTo(50, 8, 90, 35)
      path.quadraticCurveTo(50, 26, 10, 42)
      path.closePath()
      path.moveTo(60, 48)
      path.bezierCurveTo(38, 74, 38, 91, 60, 91)
      path.bezierCurveTo(82, 91, 82, 74, 60, 48)
      path.closePath()
      break
    case Emotion.MISCHIEVOUS:
      path.moveTo(9, 28)
      path.lineTo(90, 52)
      path.quadraticCurveTo(49, 97, 9, 28)
      path.closePath()
      break
    case Emotion.FOCUSED:
      stroke = true
      path.arc(50, 50, 28, 0, Math.PI * 2)
      path.moveTo(50, 12)
      path.lineTo(50, 34)
      path.moveTo(50, 66)
      path.lineTo(50, 88)
      path.moveTo(12, 50)
      path.lineTo(34, 50)
      path.moveTo(66, 50)
      path.lineTo(88, 50)
      break
    case Emotion.GLITCH:
      path.rect(10, 15, 32, 22)
      path.rect(55, 25, 35, 18)
      path.rect(22, 46, 55, 18)
      path.rect(10, 74, 25, 16)
      path.rect(50, 70, 40, 16)
      break
    case Emotion.ROBOT:
      for (let i = 0; i < 3; i++) path.rect(12 + i * 28, 20, 20, 60)
      break
    case Emotion.DREAMING:
      path.moveTo(76, 12)
      path.bezierCurveTo(5, 2, 0, 99, 76, 88)
      path.bezierCurveTo(35, 73, 35, 27, 76, 12)
      path.closePath()
      break
    case Emotion.SPARKLING:
      path.moveTo(48, 6)
      path.lineTo(60, 36)
      path.lineTo(90, 48)
      path.lineTo(60, 60)
      path.lineTo(48, 90)
      path.lineTo(36, 60)
      path.lineTo(6, 48)
      path.lineTo(36, 36)
      path.closePath()
      path.moveTo(81, 8)
      path.lineTo(91, 18)
      path.lineTo(81, 28)
      path.lineTo(71, 18)
      path.closePath()
      break
    case Emotion.ELECTRIC:
      path.moveTo(58, 6)
      path.lineTo(14, 58)
      path.lineTo(43, 58)
      path.lineTo(34, 94)
      path.lineTo(88, 37)
      path.lineTo(56, 37)
      path.closePath()
      break
  }
  const outline = stroke ? Outline.stroke(path, 9, Outline.LINECAP_ROUND, Outline.LINEJOIN_ROUND) : Outline.fill(path)
  if (side === 'right' && emotion !== Emotion.ROBOT) outline.scale(-1, 1).translate(100, 0)
  outline.scale(width / 100, height / 100)
  return rememberCachedValue(eyes, key, outline)
}

export function graphicMouthOutline(width: number, height: number, emotion: Emotion, openStep: number): Outline {
  if (!mouths) mouths = new Map()
  const key = `${width}:${height}:${emotion}:${openStep}`
  const cached = mouths.get(key)
  if (cached) return cached
  const path = new Outline.CanvasPath()
  const open = unitFromStep(openStep)
  const bottom = 55 + open * 33
  let fill = false
  switch (emotion) {
    case Emotion.STARSTRUCK:
    case Emotion.LAUGHING:
      fill = true
      path.moveTo(15, 25)
      path.lineTo(85, 25)
      path.bezierCurveTo(85, bottom, 15, bottom, 15, 25)
      path.closePath()
      break
    case Emotion.DIZZY:
    case Emotion.CRYING:
      path.moveTo(12, 50)
      path.bezierCurveTo(30, 10 - open * 8, 34, bottom + 5, 50, 50)
      path.bezierCurveTo(66, 10 - open * 8, 70, bottom + 5, 88, 50)
      break
    case Emotion.MISCHIEVOUS:
      path.moveTo(12, 35)
      path.quadraticCurveTo(30, bottom, 50, 35)
      path.quadraticCurveTo(70, bottom, 88, 35)
      break
    case Emotion.FOCUSED:
      path.moveTo(28, 45)
      path.lineTo(72, 45)
      path.lineTo(72, 50 + open * 30)
      path.lineTo(28, 50 + open * 30)
      path.closePath()
      break
    case Emotion.GLITCH:
      path.moveTo(12, 40)
      path.lineTo(35, 40)
      path.lineTo(35, bottom)
      path.lineTo(60, bottom)
      path.lineTo(60, 30)
      path.lineTo(88, 30)
      break
    case Emotion.ROBOT:
      path.rect(15, 30, 70, bottom - 30)
      for (let i = 1; i < 5; i++) {
        path.moveTo(15 + i * 14, 30)
        path.lineTo(15 + i * 14, bottom)
      }
      break
    case Emotion.DREAMING:
      path.ellipse(50, 50, 13, 12 + open * 24, 0, 0, Math.PI * 2)
      break
    case Emotion.ELECTRIC:
      path.moveTo(12, 35)
      path.lineTo(31, bottom)
      path.lineTo(50, 28)
      path.lineTo(69, bottom)
      path.lineTo(88, 35)
      break
    default:
      path.moveTo(15, 32)
      path.quadraticCurveTo(50, bottom, 85, 32)
      if (emotion === Emotion.SPARKLING) {
        path.moveTo(10, 23)
        path.lineTo(10, 39)
        path.moveTo(90, 23)
        path.lineTo(90, 39)
      }
      break
  }
  const outline = fill ? Outline.fill(path) : Outline.stroke(path, 6, Outline.LINECAP_ROUND, Outline.LINEJOIN_ROUND)
  outline.scale(width / 100, height / 100)
  return rememberCachedValue(mouths, key, outline)
}
