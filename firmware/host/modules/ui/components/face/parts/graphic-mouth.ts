import { DEFAULT_FACE_PRIMARY_COLOR, Emotion, type FaceState } from 'face-state'
import { graphicMouthOutline, isGraphicEmotion } from 'parts/graphic-expression'
import { FacePrimaryColorBehavior, getFillSkin, quantizeUnit } from 'parts/shape-utils'
import type { Shape as PiuShape } from 'piu/shape'
import { defineShapeTemplate } from 'template'

export const GraphicMouth = defineShapeTemplate((opts: { width: number; height: number }) => ({
  left: 0,
  top: 0,
  width: opts.width,
  height: opts.height,
  visible: false,
  skin: getFillSkin(DEFAULT_FACE_PRIMARY_COLOR),
  Behavior: class extends FacePrimaryColorBehavior {
    #emotion: FaceState['emotion'] = Emotion.NEUTRAL
    #openStep = -1

    onFaceState(shape: PiuShape, face: FaceState) {
      super.onFaceState(shape, face)
      shape.visible = isGraphicEmotion(face.emotion)
      if (!shape.visible) return
      const openStep = quantizeUnit(face.mouth.open)
      if (this.#emotion === face.emotion && this.#openStep === openStep) return
      this.#emotion = face.emotion
      this.#openStep = openStep
      shape.fillOutline = graphicMouthOutline(opts.width, opts.height, face.emotion, openStep)
    }
  },
}))
