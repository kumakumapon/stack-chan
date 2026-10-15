import { Outline } from 'commodetto/outline'
import type { FaceSkinPalette } from 'face-skin'
import {
  DEFAULT_FACE_PRIMARY_COLOR,
  DEFAULT_FACE_SECONDARY_COLOR,
  Emotion,
  type FaceEyeKey,
  type FaceState,
  toPiuColorNumber,
} from 'face-state'
import { graphicEyeOutline, isGraphicEmotion } from 'parts/graphic-expression'
import { FULL_TURN, getFillSkin, quantizeUnit, rememberCachedValue, unitFromStep } from 'parts/shape-utils'
import type { Container as PiuContainer, Skin as PiuSkin } from 'piu/MC'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export type EyeShape = 'circle' | 'roundRect'

export type EyeOptions = {
  cx: number
  cy: number
  shape?: EyeShape
  radius?: number
  width?: number
  height?: number
  r?: number
  side: FaceEyeKey
  eyelidWidth?: number
  eyelidHeight?: number
}

type IrisOptions = {
  shape: EyeShape
  width: number
  height: number
  r: number
  left: number
  top: number
  canvasWidth: number
  canvasHeight: number
  side: FaceEyeKey
}

type EyelidOptions = {
  cx: number
  cy: number
  width: number
  height: number
  side: FaceEyeKey
}

type PositionedShape = Omit<PiuShape, 'fillOutline' | 'strokeOutline'> & {
  skin?: PiuSkin
  state?: number
  fillOutline?: Outline
  strokeOutline?: Outline
}

type PositionedContent = PiuShape & {
  coordinates?: { left?: number; top?: number; width?: number; height?: number }
}

let irisOutlineCache: Map<string, Outline> | null = null
let eyelidOutlineCache: Map<string, Outline> | null = null

function getIrisFillOutline(shape: EyeShape, width: number, height: number, r: number): Outline {
  if (!irisOutlineCache) irisOutlineCache = new Map()
  const key = `${shape}:${width}:${height}:${r}`
  const cached = irisOutlineCache.get(key)
  if (cached) return cached

  let outline: Outline
  if (shape === 'roundRect') {
    outline = Outline.fill(Outline.RoundRectPath(0, 0, width, height, r))
  } else {
    const circle = new Outline.CanvasPath()
    circle.arc(r, r, r, 0, FULL_TURN)
    circle.closePath()
    outline = Outline.fill(circle)
  }
  return rememberCachedValue(irisOutlineCache, key, outline)
}

function getEyelidFillOutline(
  width: number,
  height: number,
  side: FaceEyeKey,
  openStep: number,
  emotion: FaceState['emotion'],
): Outline {
  if (!eyelidOutlineCache) eyelidOutlineCache = new Map()
  const key = `${width}:${height}:${side}:${openStep}:${emotion}`
  const cached = eyelidOutlineCache.get(key)
  if (cached) return cached

  const w = width
  const h = height
  const x = 0
  const y = 0
  const open = unitFromStep(openStep)
  const closedH = h * (1 - open)
  const path = new Outline.CanvasPath()

  switch (emotion) {
    case Emotion.ANGRY:
    case Emotion.SAD: {
      let h1 = y + (h + closedH) / 2
      let h2 = y + closedH
      if (side === 'left') {
        ;[h1, h2] = [h2, h1]
      }
      if (emotion === Emotion.SAD) {
        ;[h1, h2] = [h2, h1]
      }
      path.moveTo(x, y)
      path.lineTo(x, h1)
      path.lineTo(x + w, h2)
      path.lineTo(x + w, y)
      path.closePath()
      break
    }
    case Emotion.CURIOUS:
    case Emotion.DOUBTFUL:
      path.rect(x, y, w, closedH + (side === 'left' ? h * 0.35 * open : 0))
      break
    case Emotion.SHY:
      path.rect(x, y, w, h * 0.25 + closedH * 0.75)
      path.rect(x, y + h * 0.85, w, h * 0.15)
      break
    case Emotion.SURPRISED:
      path.rect(x, y, w, closedH * 0.7)
      break
    case Emotion.WINK:
      path.rect(x, y, w, side === 'left' ? h * 0.9 + closedH * 0.1 : closedH)
      break
    case Emotion.CONFIDENT:
      path.moveTo(x, y)
      path.lineTo(x, closedH + h * (side === 'left' ? 0.15 : 0.3) * open)
      path.lineTo(x + w, closedH + h * (side === 'left' ? 0.3 : 0.15) * open)
      path.lineTo(x + w, y)
      path.closePath()
      break
    case Emotion.WORRIED:
      path.moveTo(x, y)
      path.lineTo(x, closedH + h * (side === 'left' ? 0.45 : 0.1) * open)
      path.quadraticCurveTo(w / 2, closedH + h * 0.1 * open, w, closedH + h * (side === 'left' ? 0.1 : 0.45) * open)
      path.lineTo(w, y)
      path.closePath()
      break
    case Emotion.RELAXED:
      path.rect(x, y, w, h * 0.35 + closedH * 0.65)
      path.rect(x, y + h * 0.8, w, h * 0.2)
      break
    case Emotion.EXCITED:
      path.rect(x, y, w, closedH * 0.5)
      path.rect(x, y + h * 0.5, w, h * 0.5)
      break
    case Emotion.SLEEPY:
      path.rect(x, y, w, h * 0.5 + closedH * 0.5)
      break
    case Emotion.HAPPY:
      path.rect(x, y, w, closedH * 0.6)
      path.rect(x, y + h * 0.6, w, h * 0.4)
      break
    default:
      path.rect(x, y, w, closedH)
      break
  }

  const outline = Outline.fill(path)
  return rememberCachedValue(eyelidOutlineCache, key, outline)
}

export const Eyelid = defineShapeTemplate((opts: EyelidOptions) => {
  const { width, height, side } = opts
  return {
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    skin: getFillSkin(DEFAULT_FACE_SECONDARY_COLOR),
    Behavior: class extends Behavior {
      #lastOpenStep = -1
      #lastEmotion: FaceState['emotion'] | null = null
      #palette: FaceSkinPalette | null = null
      #secondary = DEFAULT_FACE_SECONDARY_COLOR

      onCreate(shape: PositionedShape) {
        this.#updatePath(shape, quantizeUnit(1), Emotion.NEUTRAL)
      }

      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.#palette = palette
        shape.skin = palette.secondary
      }

      onFaceState(shape: PositionedShape, face: FaceState) {
        if (!this.#palette) {
          const secondary = toPiuColorNumber(face.theme.secondary)
          if (secondary !== this.#secondary) {
            this.#secondary = secondary
            shape.skin = getFillSkin(secondary)
          }
        }

        const eye = face.eyes[side]
        const openStep = quantizeUnit(eye.open)
        const emotion = face.emotion
        if (openStep === this.#lastOpenStep && emotion === this.#lastEmotion) return

        this.#updatePath(shape, openStep, emotion)
      }

      #updatePath(shape: PositionedShape, openStep: number, emotion: FaceState['emotion']) {
        this.#lastOpenStep = openStep
        this.#lastEmotion = emotion
        shape.fillOutline = getEyelidFillOutline(width, height, side, openStep, emotion)
        shape.strokeOutline = undefined
      }
    },
  }
})

const Iris = defineShapeTemplate((opts: IrisOptions) => {
  const normalOutline = getIrisFillOutline(opts.shape, opts.width, opts.height, opts.r)
    .clone()
    .translate((opts.canvasWidth - opts.width) / 2, (opts.canvasHeight - opts.height) / 2)
  return {
    left: opts.left,
    top: opts.top,
    width: opts.canvasWidth,
    height: opts.canvasHeight,
    skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
    Behavior: class extends Behavior {
      #palette: FaceSkinPalette | null = null
      #primary = DEFAULT_FACE_PRIMARY_COLOR
      #emotion: FaceState['emotion'] = Emotion.NEUTRAL

      onCreate(shape: PositionedShape) {
        shape.fillOutline = normalOutline
        shape.strokeOutline = undefined
      }

      onFaceSkin(shape: PositionedShape, palette: FaceSkinPalette) {
        this.#palette = palette
        shape.skin = palette.primary
      }

      onFaceState(shape: PositionedShape, face: FaceState) {
        if (!this.#palette) {
          const primary = toPiuColorNumber(face.theme.primary)
          if (primary !== this.#primary) {
            this.#primary = primary
            shape.skin = getFillSkin(primary)
          }
        }
        if (face.emotion === this.#emotion) return
        this.#emotion = face.emotion
        shape.fillOutline = isGraphicEmotion(face.emotion)
          ? graphicEyeOutline(opts.canvasWidth, opts.canvasHeight, face.emotion, opts.side)
          : normalOutline
      }
    },
  }
})

export const Eye = Container.template((opts: EyeOptions) => {
  const shape = opts.shape ?? 'circle'
  const radius = opts.radius ?? 8
  const diameter = radius * 2
  const irisWidth = shape === 'roundRect' ? Math.max(2, opts.width ?? 16) : diameter
  const irisHeight = shape === 'roundRect' ? Math.max(2, opts.height ?? 16) : diameter
  const irisRadius = shape === 'roundRect' ? Math.max(0, Math.min(opts.r ?? 4, irisWidth / 2, irisHeight / 2)) : radius
  const eyelidWidth = opts.eyelidWidth ?? (shape === 'circle' ? radius * 3 : irisWidth)
  const eyelidHeight = opts.eyelidHeight ?? (shape === 'circle' ? radius * 3 : irisHeight)
  const width = Math.max(irisWidth, eyelidWidth)
  const height = Math.max(irisHeight, eyelidHeight)
  // Keep a positioning margin for gaze, while giving graphic eyes more room
  // than the normal iris. The normal outline remains at its original center.
  const irisCanvasWidth = Math.max(irisWidth, width - 2)
  const irisCanvasHeight = Math.max(irisHeight, height - 2)
  const irisBaseLeft = (width - irisCanvasWidth) / 2
  const irisBaseTop = (height - irisCanvasHeight) / 2
  const irisBaseCoordinates = {
    left: irisBaseLeft,
    top: irisBaseTop,
    width: irisCanvasWidth,
    height: irisCanvasHeight,
  }
  const iris = new Iris({
    shape,
    width: irisWidth,
    height: irisHeight,
    r: irisRadius,
    canvasWidth: irisCanvasWidth,
    canvasHeight: irisCanvasHeight,
    side: opts.side,
    left: irisBaseLeft,
    top: irisBaseTop,
  }) as PositionedContent

  return {
    clip: true,
    left: opts.cx - width / 2,
    top: opts.cy - height / 2,
    width,
    height,
    Behavior: class extends Behavior {
      #lastGazeX = NaN
      #lastGazeY = NaN

      onFaceState(_container: PiuContainer, face: FaceState) {
        const eye = face.eyes[opts.side]
        const offsetX = (eye.gazeX ?? 0) * 2
        const offsetY = (eye.gazeY ?? 0) * 2
        if (offsetX === this.#lastGazeX && offsetY === this.#lastGazeY) return

        this.#lastGazeX = offsetX
        this.#lastGazeY = offsetY
        iris.coordinates = {
          ...irisBaseCoordinates,
          left: irisBaseLeft + offsetX,
          top: irisBaseTop + offsetY,
        }
      }
    },
    contents: [
      iris,
      new Eyelid({
        cx: width / 2,
        cy: height / 2,
        width: eyelidWidth,
        height: eyelidHeight,
        side: opts.side,
      }),
    ],
  }
})
