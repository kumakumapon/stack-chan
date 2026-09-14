import Timer from '../../../testing/fakes/timer.js'

/**
 * Scriptable stand-in for `embedded:io/serial`.
 *
 * The SCServo protocol failures that cost real device cycles (a lost write
 * acknowledgement, a response split across reads, line noise in front of a
 * header, a corrupted checksum) are all transport faults. Injecting them here
 * keeps them reproducible without a servo attached.
 */

export type FakeSerialOptions = {
  receive?: number
  transmit?: number
  baud?: number
  port?: number
  format?: string
  onReadable?: (this: FakeSerial, bytes: number) => void
}

let instance: FakeSerial | undefined

/** The serial instance opened by the code under test. */
export function getFakeSerial(): FakeSerial {
  if (instance == null) throw new Error('serial has not been opened')
  return instance
}

export default class FakeSerial {
  /** Every packet handed to write(), in order. */
  written: Uint8Array[] = []
  format: string
  options: FakeSerialOptions
  /** Set to make the next write() throw, as a full transmit buffer does. */
  failWrites = false
  /** Bytes the device sends back for a written packet. */
  respond: (packet: Uint8Array) => number[] = () => []
  /** Deliver received bytes one onReadable call at a time. */
  fragmentReceive = false
  #onReadable?: (this: FakeSerial, bytes: number) => void
  #receiveQueue: number[] = []

  constructor(options: FakeSerialOptions) {
    this.options = options
    this.format = options.format ?? 'buffer'
    this.#onReadable = options.onReadable
    instance = this
  }

  read(): number {
    return this.#receiveQueue.shift() ?? 0
  }

  write(buffer: Uint8Array): void {
    if (this.failWrites) throw new Error('serial write failed')
    this.written.push(buffer.slice())
    const response = this.respond(buffer.slice())
    if (response.length === 0) return
    // A servo cannot answer inside our own write call; answer on the next turn.
    Timer.set(() => this.receive(response), 0)
  }

  /** Delivers bytes as if the servo had sent them. */
  receive(bytes: number[]): void {
    if (this.fragmentReceive) {
      for (const byte of bytes) {
        this.#receiveQueue.push(byte)
        this.#onReadable?.call(this, 1)
      }
      return
    }
    for (const byte of bytes) this.#receiveQueue.push(byte)
    this.#onReadable?.call(this, bytes.length)
  }

  close(): void {}
}

/** Appends the SCS checksum to a frame body that starts at the 0xff 0xff header. */
export function withChecksum(frame: number[]): number[] {
  let sum = 0
  for (let i = 2; i < frame.length; i++) sum += frame[i]
  return [...frame, ~(sum & 0xff) & 0xff]
}

export type FakeServoFaults = {
  /** Drop every response, as a servo whose acknowledgement is lost does. */
  dropResponses?: boolean
  /** Bytes prepended to every response. */
  noisePrefix?: number[]
  /** Corrupt the checksum of every response. */
  corruptChecksum?: boolean
  /** Echo the request back first, as the half-duplex bus does. */
  echoRequests?: boolean
}

/**
 * Minimal SCSCL servo model: acknowledges writes and answers present-position
 * reads from the last goal position it was given.
 */
export function createFakeServoBus(faults: FakeServoFaults = {}): (packet: Uint8Array) => number[] {
  const positions = new Map<number, number>()
  return (packet) => {
    const id = packet[2]
    const command = packet[4]
    const address = packet[5]
    if (command === 0x03 && address === 42) positions.set(id, (packet[6] << 8) + packet[7])
    if (faults.dropResponses) return faults.echoRequests ? [...packet] : []
    const position = positions.get(id) ?? 512
    const body =
      command === 0x02
        ? withChecksum([0xff, 0xff, id, 4, 0, (position & 0xff00) >> 8, position & 0xff])
        : withChecksum([0xff, 0xff, id, 2, 0])
    if (faults.corruptChecksum) body[body.length - 1] = (body[body.length - 1] + 1) & 0xff
    return [...(faults.echoRequests ? [...packet] : []), ...(faults.noisePrefix ?? []), ...body]
  }
}
