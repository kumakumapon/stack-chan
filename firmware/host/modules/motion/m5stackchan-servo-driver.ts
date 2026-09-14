import {
  angleToRawPosition,
  createM5StackChanServoConfig,
  M5STACKCHAN_SCSCL_GOAL_TIME_MS,
  type M5StackChanServoConfig,
  RAD_TO_01_DEGREE,
  rawPositionToAngle,
  rotationToM5StackChanServoAngles,
} from 'm5stackchan-servo'
import type { MotionCompletion, MotionDurationSeconds, MotionResultCallback } from 'motion-controller'
import SCServo, { type SCServoBusDiagnostics, type SCServoDiagnostics } from 'protocols/scservo'
import { type PY32IOExpander, tryGetSharedPY32IOExpander } from 'py32-io-expander'
import type { Maybe, Rotation } from 'stackchan-util'

type M5StackChanServoDriverProps = Partial<{
  panId: number
  tiltId: number
  yawZeroPosition: number
  pitchZeroPosition: number
  config: Partial<{
    serial: Partial<M5StackChanServoConfig['serial']>
    yaw: Partial<M5StackChanServoConfig['yaw']>
    pitch: Partial<M5StackChanServoConfig['pitch']>
  }>
  serial: Partial<M5StackChanServoConfig['serial']>
  servoPower: {
    type?: 'py32' | 'none'
    pin?: number
    address?: number
  }
}>

/**
 * Everything needed to tell apart a power failure, a silent bus, a noisy bus and
 * a command that was accepted but did not move the head. Collected without
 * reflashing so one device session can answer more than one hypothesis.
 */
export type M5StackChanServoDriverDiagnostics = {
  pan: Readonly<SCServoDiagnostics>
  tilt: Readonly<SCServoDiagnostics>
  /** Undefined until a servo has opened the shared UART. */
  bus: Readonly<SCServoBusDiagnostics> | undefined
  power: {
    /** False when the driver was constructed with servoPower.type 'none'. */
    configured: boolean
    /** Null until the driver is attached or detached. */
    enabled: boolean | null
    /** False when the PY32 expander could not be reached. */
    available: boolean
  }
  serial: M5StackChanServoConfig['serial']
  goalTimeMilliseconds: number
}

export class M5StackChanServoDriver {
  #pan: SCServo
  #tilt: SCServo
  #config: M5StackChanServoConfig
  #rotation: Rotation = { y: 0, p: 0, r: 0 }
  #rotationResult: Maybe<Rotation> = { success: true, value: this.#rotation }
  #rotationErrorResult: { success: false; reason?: string } = { success: false }
  #servoPower?: PY32ServoPower
  // Reused snapshot: diagnostics are polled while the head is moving.
  #diagnostics: M5StackChanServoDriverDiagnostics

  constructor(param: M5StackChanServoDriverProps = {}) {
    this.#config = createM5StackChanServoConfig({
      serial: {
        ...param.config?.serial,
        ...param.serial,
      },
      yaw: {
        ...param.config?.yaw,
        ...(param.panId !== undefined ? { id: param.panId } : {}),
        ...(param.yawZeroPosition !== undefined ? { zeroPosition: param.yawZeroPosition } : {}),
      },
      pitch: {
        ...param.config?.pitch,
        ...(param.tiltId !== undefined ? { id: param.tiltId } : {}),
        ...(param.pitchZeroPosition !== undefined ? { zeroPosition: param.pitchZeroPosition } : {}),
      },
    })
    this.#pan = new SCServo({ id: this.#config.yaw.id, serial: this.#config.serial, awaitWriteResponse: false })
    this.#tilt = new SCServo({ id: this.#config.pitch.id, serial: this.#config.serial, awaitWriteResponse: false })
    if (param.servoPower?.type !== 'none') {
      this.#servoPower = new PY32ServoPower(param.servoPower?.pin ?? 0, param.servoPower?.address)
    }
    this.#diagnostics = {
      pan: this.#pan.getDiagnostics(),
      tilt: this.#tilt.getDiagnostics(),
      bus: undefined,
      power: { configured: this.#servoPower != null, enabled: null, available: false },
      serial: this.#config.serial,
      goalTimeMilliseconds: M5STACKCHAN_SCSCL_GOAL_TIME_MS,
    }
  }

  /**
   * Servo counters, bus counters and power state. The returned object and its
   * servo entries are reused, so copy the fields to keep a snapshot.
   */
  getDiagnostics(): Readonly<M5StackChanServoDriverDiagnostics> {
    const diagnostics = this.#diagnostics
    diagnostics.pan = this.#pan.getDiagnostics()
    diagnostics.tilt = this.#tilt.getDiagnostics()
    diagnostics.bus = SCServo.getBusDiagnostics()
    diagnostics.power.enabled = this.#servoPower?.enabled ?? null
    diagnostics.power.available = this.#servoPower?.available ?? false
    return diagnostics
  }

  onAttached() {
    this.#servoPower?.setEnabled(true)
  }

  onDetached() {
    this.#servoPower?.setEnabled(false)
  }

  setTorque(torque: boolean, callback?: MotionCompletion): void {
    this.#pan.setTorque(torque, (panError) => {
      if (panError != null) {
        callback?.(panError)
        return
      }
      this.#tilt.setTorque(torque, callback)
    })
  }

  applyRotation(ori: Rotation, time: MotionDurationSeconds = 0.5, callback?: MotionCompletion): void {
    const angles = rotationToM5StackChanServoAngles(ori)
    const panRawPosition = angleToRawPosition(angles.yaw, this.#config.yaw)
    const tiltRawPosition = angleToRawPosition(angles.pitch, this.#config.pitch)
    if (time === 0) {
      this.#pan.setRawPosition(panRawPosition, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPosition(tiltRawPosition, callback)
      })
    } else {
      const goalTimeMilliseconds = M5STACKCHAN_SCSCL_GOAL_TIME_MS
      this.#pan.setRawPositionInTime(panRawPosition, goalTimeMilliseconds, (panError) => {
        if (panError != null) {
          callback?.(panError)
          return
        }
        this.#tilt.setRawPositionInTime(tiltRawPosition, goalTimeMilliseconds, callback)
      })
    }
  }

  getRotation(callback: MotionResultCallback<Maybe<Rotation>>): void {
    this.#pan.readRawPosition((panStatus) => {
      if (panStatus.success === false) {
        this.#returnRotationError(callback, panStatus.reason)
        return
      }
      this.#tilt.readRawPosition((tiltStatus) => {
        if (tiltStatus.success === false) {
          this.#returnRotationError(callback, tiltStatus.reason)
          return
        }
        const yawAngle = rawPositionToAngle(panStatus.value.position, this.#config.yaw)
        const pitchAngle = rawPositionToAngle(tiltStatus.value.position, this.#config.pitch)
        this.#rotation.y = yawAngle / RAD_TO_01_DEGREE
        this.#rotation.p = -(pitchAngle / RAD_TO_01_DEGREE)
        this.#rotation.r = 0.0
        callback(this.#rotationResult)
      })
    })
  }

  #returnRotationError(callback: MotionResultCallback<Maybe<Rotation>>, reason?: string): void {
    this.#rotationErrorResult.reason = reason
    callback(this.#rotationErrorResult)
  }
}

class PY32ServoPower {
  #pin: number
  #expander?: PY32IOExpander
  #enabled: boolean | null = null

  get available(): boolean {
    return this.#expander != null
  }

  get enabled(): boolean | null {
    return this.#enabled
  }

  constructor(pin: number, address?: number) {
    this.#pin = pin
    const expander = tryGetSharedPY32IOExpander(address === undefined ? undefined : { address }, (error) => {
      trace(`[m5stackchan-servo] PY32 servo power init failed: ${error}\n`)
    })
    if (!expander) return
    this.#expander = expander
    expander.setDirection(this.#pin, true)
    expander.setPullMode(this.#pin, true)
    trace(`[m5stackchan-servo] configured PY32 servo power pin ${this.#pin}\n`)
  }

  setEnabled(enabled: boolean) {
    const expander = this.#expander
    this.#enabled = enabled
    if (!expander) return
    expander.digitalWrite(this.#pin, enabled)
    trace(`[m5stackchan-servo] servo power ${enabled ? 'on' : 'off'} (${expander.getWriteValue(this.#pin)})\n`)
  }
}
