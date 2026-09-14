import Serial from 'embedded:io/serial'
import config from 'mc/config'
import {
  encodeSCServoCommand,
  fromBigEndianBytes,
  SCSERVO_ADDRESS,
  SCSERVO_COMMAND,
  type SCServoAddress,
  type SCServoCommand,
  toBigEndianBytes,
  WRITE_POSITION_VALUE_COUNT,
  writePositionValues,
} from 'protocols/scservo-codec'
import { SCServoDecoder, type SCServoDecoderStats } from 'protocols/scservo-decoder'

import { CommandTimeoutError } from 'servo-command-error'
import SingleWaitSlot from 'single-wait-slot'
import Timer from 'timer'

type Maybe<T> =
  | {
      success: true
      value: T
    }
  | {
      success: false
      reason?: string
    }

export type SCServoGoalTimeMilliseconds = number

// utilities
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
const le = toBigEndianBytes
const el = fromBigEndianBytes

// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const BROADCAST_ID = 0xfe // 254
// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const MAX_ID = 0xfc // 252
// biome-ignore lint/correctness/noUnusedVariables: constant for future use
const SCS_END = 0

const COMMAND = SCSERVO_COMMAND
type Command = SCServoCommand

const ADDRESS = SCSERVO_ADDRESS
type Address = SCServoAddress

class PacketHandler extends Serial {
  #callbacks = new Map<number, (buffer: Uint8Array, length: number) => void>()
  #decoder: SCServoDecoder
  // Reused snapshot: the receive path must not allocate.
  #busDiagnostics: SCServoBusDiagnostics = {
    framesDecoded: 0,
    discardedBytes: 0,
    checksumErrors: 0,
    lengthErrors: 0,
    overflowBytes: 0,
    echoesIgnored: 0,
    framesWithoutListener: 0,
  }
  constructor(option) {
    const onReadable = function (this: PacketHandler, bytes: number) {
      for (let i = 0; i < bytes; i++) this.#decoder.push(this.read() as number)
    }
    super({ ...option, format: 'number', onReadable })
    this.#decoder = new SCServoDecoder(({ id, status, payload }) => {
      // Preserve existing echo filtering; status/error classification is separate.
      if (status === COMMAND.READ || status === COMMAND.WRITE) {
        this.#busDiagnostics.echoesIgnored++
        return
      }
      const callback = this.#callbacks.get(id)
      if (callback == null) {
        this.#busDiagnostics.framesWithoutListener++
        return
      }
      callback(payload, payload.length)
    })
  }
  hasCallbackOf(id: number): boolean {
    return this.#callbacks.has(id)
  }
  registerCallback(id: number, callback: (buffer: Uint8Array, length: number) => void) {
    this.#callbacks.set(id, callback)
  }
  removeCallback(id: number) {
    this.#callbacks.delete(id)
  }
  /**
   * Bus counters, refreshed from the decoder on every call. The same instance is
   * reused, so read the fields immediately or copy them.
   */
  getBusDiagnostics(): Readonly<SCServoBusDiagnostics> {
    const stats = this.#decoder.getStats()
    const diagnostics = this.#busDiagnostics
    diagnostics.framesDecoded = stats.framesDecoded
    diagnostics.discardedBytes = stats.discardedBytes
    diagnostics.checksumErrors = stats.checksumErrors
    diagnostics.lengthErrors = stats.lengthErrors
    diagnostics.overflowBytes = stats.overflowBytes
    return diagnostics
  }
}

/**
 * Bus-wide receive counters shared by every servo on the same UART, plus the
 * frames the dispatcher chose to drop. These separate "the bus is silent" from
 * "the bus is noisy", which otherwise look identical from the application.
 */
export type SCServoBusDiagnostics = SCServoDecoderStats & {
  /** Frames recognised as our own transmission echoed back by the half-duplex bus. */
  echoesIgnored: number
  /** Valid frames addressed to an id no servo instance is listening for. */
  framesWithoutListener: number
}

/** Per-servo command counters. Cumulative since the instance was created. */
export type SCServoDiagnostics = {
  id: number
  /** Commands handed to the serial port. */
  commandsSent: number
  /** Response frames delivered for this id, including unawaited write ACKs. */
  responsesReceived: number
  /** Reads that gave up after COMMAND_TIMEOUT_MS. */
  responseTimeouts: number
  /** Commands rejected because the previous one had not finished. */
  busyRejections: number
  /** Commands whose serial write itself failed. */
  writeFailures: number
  /** Commands still queued behind the running one. */
  queued: number
  /** Last goal position written, or -1 when none has been written. */
  lastGoalPosition: number
  /** Goal time register value of that write, or -1. */
  lastGoalTimeMilliseconds: number
  /** Last raw position read back, or -1 when none has been read. */
  lastReadPosition: number
  lastErrorMessage: string | null
  /** Date.now() of the last error, or -1. */
  lastErrorAtMilliseconds: number
}

type SCServoConstructorParam = {
  id: number
  awaitWriteResponse?: boolean
  serial?: Partial<{
    receive: number
    transmit: number
    baud: number
    port: number
  }>
}
type CommandCallback = (values: Uint8Array | undefined) => void
type ErrorCallback = (error: unknown) => void
type CompletionCallback = (error?: unknown) => void
type ResultCallback<T> = (result: Maybe<T>) => void
type PendingCommand = {
  command: Command
  address: Address
  onResult: CommandCallback
  onError: ErrorCallback
  values: number[]
}
const COMMAND_BUSY_ERROR = 'command is already waiting for response'
const COMMAND_TIMEOUT_MS = 120
const COMMAND_RECOVERY_DELAY_MS = 20

function reasonFromError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function failureFromError<T>(error: unknown): Maybe<T> {
  return {
    success: false,
    reason: reasonFromError(error),
  }
}

function deferNoResponseResult(onResult: CommandCallback, onError: ErrorCallback): void {
  // The M5StackChan driver chains pan/tilt writes. Keep no-response writes off the
  // current Serial.onReadable stack so nested callbacks cannot exhaust the XS stack.
  Timer.set(() => {
    try {
      onResult(undefined)
    } catch (error) {
      onError(error)
    }
  }, 0)
}

let packetHandler: PacketHandler = null
let packetHandlerSerialKey: string | null = null
class SCServo {
  #id: number
  #onCommandRead: (buffer: Uint8Array, length: number) => void
  #txBuf: Uint8Array
  #waitSlot: SingleWaitSlot<Uint8Array>
  #commandQueue: PendingCommand[] = []
  #offset: number
  #awaitWriteResponse: boolean
  #isWriting = false
  // Reused snapshot: getDiagnostics is called from the MiniStack request path.
  #diagnostics: SCServoDiagnostics = {
    id: 0,
    commandsSent: 0,
    responsesReceived: 0,
    responseTimeouts: 0,
    busyRejections: 0,
    writeFailures: 0,
    queued: 0,
    lastGoalPosition: -1,
    lastGoalTimeMilliseconds: -1,
    lastReadPosition: -1,
    lastErrorMessage: null,
    lastErrorAtMilliseconds: -1,
  }
  // Reused between position commands; #sendCommand copies the values it needs.
  #writePositionValues: number[] = new Array(WRITE_POSITION_VALUE_COUNT).fill(0)
  constructor({ id, awaitWriteResponse = true, serial: serialOverride }: SCServoConstructorParam) {
    this.#id = id
    this.#diagnostics.id = id
    this.#waitSlot = new SingleWaitSlot<Uint8Array>(Timer.set, Timer.clear)
    this.#offset = 0
    this.#awaitWriteResponse = awaitWriteResponse
    this.#onCommandRead = (values, _length) => {
      this.#diagnostics.responsesReceived++
      this.#waitSlot.resolve(values)
    }
    this.#txBuf = new Uint8Array(64)
    const serial = (serialOverride ?? config.serial ?? {}) as NonNullable<SCServoConstructorParam['serial']>
    const port = serial.port ?? 2
    const receive = serial.receive ?? 16
    const transmit = serial.transmit ?? 17
    const baud = serial.baud ?? 1_000_000
    const serialKey = `${port}:${transmit}:${receive}:${baud}`
    if (packetHandler == null) {
      trace(`[scservo] serial port=${port} tx=${transmit} rx=${receive} baud=${baud}\n`)
      packetHandler = new PacketHandler({
        receive,
        transmit,
        baud,
        port,
      })
      packetHandlerSerialKey = serialKey
    } else if (packetHandlerSerialKey !== serialKey) {
      throw new Error(
        `SCServo PacketHandler serial config mismatch: existing=${packetHandlerSerialKey}, requested=${serialKey}`,
      )
    }
    if (packetHandler.hasCallbackOf(id)) {
      throw new Error('This id is already instantiated')
    }
    packetHandler.registerCallback(this.#id, this.#onCommandRead)
  }
  teardown(): void {
    packetHandler.removeCallback(this.#id)
  }
  get id(): number {
    return this.#id
  }

  /**
   * Command counters for this servo. The returned object is reused, so copy the
   * fields when a snapshot has to outlive the call.
   */
  getDiagnostics(): Readonly<SCServoDiagnostics> {
    this.#diagnostics.id = this.#id
    this.#diagnostics.queued = this.#commandQueue.length
    return this.#diagnostics
  }

  /**
   * Receive counters of the shared bus, or undefined before any servo opened it.
   */
  static getBusDiagnostics(): Readonly<SCServoBusDiagnostics> | undefined {
    return packetHandler?.getBusDiagnostics()
  }

  #recordError(error: unknown): void {
    this.#diagnostics.lastErrorMessage = reasonFromError(error)
    this.#diagnostics.lastErrorAtMilliseconds = Date.now()
  }

  #dispatchCommand(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): boolean {
    const waitsForResponse = command === COMMAND.READ || this.#awaitWriteResponse
    if (this.#isWriting || (waitsForResponse && this.#waitSlot.isWaiting)) {
      this.#diagnostics.busyRejections++
      this.#recordError(COMMAND_BUSY_ERROR)
      onError(new Error(COMMAND_BUSY_ERROR))
      return false
    }
    this.#isWriting = true
    const length = encodeSCServoCommand(this.#txBuf, this.#id, command, address, values)
    // trace(`writing: ${this.#txBuf.subarray(0, length)}\n`)
    this.#writePacket(
      length,
      () => {
        this.#isWriting = false
        this.#diagnostics.commandsSent++
        if (!waitsForResponse) {
          deferNoResponseResult(onResult, onError)
          return
        }
        const waiting = this.#waitSlot.wait(COMMAND_TIMEOUT_MS, onResult, () => {
          trace(`[scservo] timeout id=${this.#id} command=${command} address=${address}\n`)
          this.#diagnostics.responseTimeouts++
          const timeout = new CommandTimeoutError('scservo', COMMAND_TIMEOUT_MS)
          this.#recordError(timeout)
          onError(timeout)
        })
        if (!waiting) {
          this.#diagnostics.busyRejections++
          this.#recordError(COMMAND_BUSY_ERROR)
          onError(new Error(COMMAND_BUSY_ERROR))
        } else {
          Timer.set(this.#drainCommandQueue, 0)
        }
      },
      (error) => {
        this.#isWriting = false
        this.#diagnostics.writeFailures++
        this.#recordError(error)
        onError(error)
        Timer.set(this.#drainCommandQueue, 0)
      },
    )
    return true
  }

  #writePacket(length: number, onWritten: () => void, onError: ErrorCallback, attempt = 0): void {
    const originalFormat = packetHandler.format
    let written = false
    packetHandler.format = 'buffer'
    try {
      packetHandler.write(this.#txBuf.subarray(0, length))
      written = true
    } catch (error) {
      if (attempt >= 1) {
        onError(error)
      } else {
        Timer.set(() => this.#writePacket(length, onWritten, onError, attempt + 1), 1)
      }
    } finally {
      packetHandler.format = originalFormat
    }
    if (!written) {
      return
    }
    try {
      onWritten()
    } catch (error) {
      onError(error)
    }
  }

  #sendCommand(
    command: Command,
    address: Address,
    onResult: CommandCallback,
    onError: ErrorCallback,
    ...values: number[]
  ): boolean {
    this.#commandQueue.push({ command, address, onResult, onError, values })
    this.#drainCommandQueue()
    return true
  }

  #drainCommandQueue = (): void => {
    if (this.#isWriting || this.#waitSlot.isWaiting) return
    const pending = this.#commandQueue.shift()
    if (pending == null) return
    this.#dispatchCommand(
      pending.command,
      pending.address,
      (values) => {
        try {
          pending.onResult(values)
        } finally {
          Timer.set(this.#drainCommandQueue, 0)
        }
      },
      (error) => {
        try {
          pending.onError(error)
        } finally {
          Timer.set(this.#drainCommandQueue, error instanceof CommandTimeoutError ? COMMAND_RECOVERY_DELAY_MS : 0)
        }
      },
      ...pending.values,
    )
  }

  #lock(callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.LOCK, () => callback?.(), callback ?? (() => {}), 1)
  }

  #unlock(callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.LOCK, () => callback?.(), callback ?? (() => {}), 0)
  }

  /**
   * reads offset angle
   * @note SCS series does not have zero position calibration function.
   *  The offset value should be handled by the application.
   */
  readOffsetAngle(callback: ResultCallback<number>): void {
    this.#sendCommand(
      COMMAND.READ,
      ADDRESS.OFFSET,
      (values) => {
        if (values == null || values.length < 2) {
          callback({
            success: false,
            reason: 'response corrupted',
          })
          return
        }
        const raw = el(values[0], values[1])
        const isCcw = (raw & 0x8000) !== 0
        let offset = raw & 0x7fff
        if (isCcw) {
          offset *= -1
        }
        callback({
          success: true,
          value: offset,
        })
      },
      (error) => callback(failureFromError(error)),
      2,
    )
  }

  /**
   * sets offset angle
   * @param angle offset angle (-2000 to 2000)
   */
  setOffsetAngle(angle: number, callback?: CompletionCallback): void {
    this.#offset = angle
    const isCcw = angle < 0
    const a = isCcw ? angle * -1 : angle
    const value = (Number(isCcw) << 15) | (a & 0x7fff)
    this.#sendCommand(COMMAND.WRITE, ADDRESS.OFFSET, () => callback?.(), callback ?? (() => {}), ...le(value))
  }

  /**
   * load settings from the servo
   */
  loadSettings(callback?: CompletionCallback): void {
    // Offset angle
    this.readOffsetAngle((result) => {
      if (result.success === false) {
        callback?.(result.reason ?? 'failed to read offset angle')
        return
      }
      this.#offset = result.value

      // Further configuration to be loaded below
      callback?.()
    })
  }

  /**
   * save settings to the servo
   */
  saveSettings(callback?: CompletionCallback): void {
    // Offset angle
    this.#unlock((unlockError) => {
      if (unlockError != null) {
        callback?.(unlockError)
        return
      }
      this.setOffsetAngle(this.#offset, (offsetError) => {
        if (offsetError != null) {
          callback?.(offsetError)
          return
        }
        this.#lock(callback)
      })
    })
  }

  flashId(id: number, callback?: CompletionCallback): void {
    if (packetHandler.hasCallbackOf(id)) {
      callback?.(new Error(`id(${id}) is already used\n`))
      return
    }
    // trace('unlocking\n')
    this.#unlock((unlockError) => {
      if (unlockError != null) {
        callback?.(unlockError)
        return
      }
      // trace('setting new id\n')
      const oldId = this.#id
      if (
        !this.#sendCommand(
          COMMAND.WRITE,
          ADDRESS.ID,
          () => {
            this.#lock((lockError) => {
              if (lockError != null) {
                callback?.(lockError)
                return
              }
              packetHandler.removeCallback(oldId)
              callback?.()
            })
          },
          callback ?? (() => {}),
          id,
        )
      ) {
        return
      }
      this.#id = id
      packetHandler.registerCallback(this.#id, this.#onCommandRead)
      // trace(`now we use new id(${id}\n`)
    })
  }

  /**
   * sets angle immediately
   * @param angle angle(degree)
   * @returns TBD
   */
  setAngle(angle: number, callback?: CompletionCallback): void {
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    this.setRawPosition(a, callback)
  }

  /**
   * sets angle within goal time
   * @param angle angle(degree)
   * @param goalTimeMilliseconds time in milliseconds
   * @returns TBD
   */
  setAngleInTime(
    angle: number,
    goalTimeMilliseconds: SCServoGoalTimeMilliseconds,
    callback?: CompletionCallback,
  ): void {
    // 0 <= a <= 1023
    const a = Math.floor(clamp(((angle + this.#offset) * 1024) / 200, 0, 0x03ff))
    this.setRawPositionInTime(a, goalTimeMilliseconds, callback)
  }

  setRawPosition(rawPosition: number, callback?: CompletionCallback): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#diagnostics.lastGoalPosition = position
    this.#diagnostics.lastGoalTimeMilliseconds = 0
    this.#sendCommand(COMMAND.WRITE, ADDRESS.GOAL_POSITION, () => callback?.(), callback ?? (() => {}), ...le(position))
  }

  setRawPositionInTime(
    rawPosition: number,
    goalTimeMilliseconds: SCServoGoalTimeMilliseconds,
    callback?: CompletionCallback,
  ): void {
    const position = Math.floor(clamp(rawPosition, 0, 0x03ff))
    this.#diagnostics.lastGoalPosition = position
    this.#diagnostics.lastGoalTimeMilliseconds = goalTimeMilliseconds
    // SCSCL WritePos writes the complete position/time/speed register window.
    // Sending only the first four bytes can retain a stale goal-speed field.
    const values = writePositionValues(this.#writePositionValues, position, goalTimeMilliseconds)
    this.#sendCommand(COMMAND.WRITE, ADDRESS.GOAL_POSITION, () => callback?.(), callback ?? (() => {}), ...values)
  }
  readRawPosition(callback: ResultCallback<{ position: number }>): void {
    this.#sendCommand(
      COMMAND.READ,
      ADDRESS.PRESENT_POSITION,
      (values) => {
        if (values == null || values.length < 2) {
          callback({
            success: false,
            reason: 'response corrupted.',
          })
          return
        }
        const position = el(values[0], values[1])
        this.#diagnostics.lastReadPosition = position
        callback({
          success: true,
          value: { position },
        })
      },
      (error) => callback(failureFromError(error)),
      2,
    )
  }

  /**
   * sets torque
   * @param enable enable
   * @returns TBD
   */
  setTorque(enable: boolean, callback?: CompletionCallback): void {
    this.#sendCommand(COMMAND.WRITE, ADDRESS.TORQUE_ENABLE, () => callback?.(), callback ?? (() => {}), Number(enable))
  }

  /**
   * reads servo's present status
   * @returns angle(degree)
   */
  readStatus(callback: ResultCallback<{ angle: number }>): void {
    this.readRawPosition((raw) => {
      if (raw.success === false) {
        callback({
          success: false,
          reason: raw.reason,
        })
        return
      }
      const angle = (raw.value.position * 200) / 1024 - this.#offset
      callback({
        success: true,
        value: { angle },
      })
    })
  }
}

export default SCServo
