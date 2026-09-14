/**
 * Pure SCS/SCSCL packet encoding. Kept free of Serial and Timer so the wire
 * format can be verified on the host without a device attached.
 */

export const SCSERVO_COMMAND = {
  RESPONSE: 0x00,
  // NOTE: Some servo returns response with command 0x01. Dunno why.
  RESPONSE_ALT: 0x01,
  WRITE: 0x03,
  READ: 0x02,
} as const
export type SCServoCommand = (typeof SCSERVO_COMMAND)[keyof typeof SCSERVO_COMMAND]

export const SCSERVO_ADDRESS = {
  ID: 5,
  OFFSET: 31,
  TORQUE_ENABLE: 40,
  GOAL_ACC: 41,
  GOAL_POSITION: 42,
  GOAL_TIME: 44,
  LOCK: 48,
  PRESENT_POSITION: 56,
} as const
export type SCServoAddress = (typeof SCSERVO_ADDRESS)[keyof typeof SCSERVO_ADDRESS]

/** Bytes written by a WritePos command: goal position, goal time and goal speed. */
export const WRITE_POSITION_VALUE_COUNT = 6

/** Header (2) + id + length + command + address + checksum. */
const PACKET_OVERHEAD = 7

export function toBigEndianBytes(value: number): [number, number] {
  return [(value & 0xff00) >> 8, value & 0xff]
}

export function fromBigEndianBytes(high: number, low: number): number {
  return ((high << 8) & 0xff00) + (low & 0xff)
}

/**
 * calculates checksum of the SCS packets
 * @param buffer packet bytes starting at the 0xff 0xff header
 * @param length number of bytes preceding the checksum
 * @returns checksum byte
 */
export function scservoChecksum(buffer: Uint8Array, length: number): number {
  let sum = 0
  for (let i = 2; i < length; i++) {
    sum += buffer[i]
  }
  return ~(sum & 0xff)
}

/**
 * writes a command packet into a caller-owned buffer
 * @param buffer transmit buffer, reused between commands
 * @param id servo id
 * @param command read or write
 * @param address first register address
 * @param values register values, or the read length for a read command
 * @returns number of bytes written, including the checksum
 */
export function encodeSCServoCommand(
  buffer: Uint8Array,
  id: number,
  command: SCServoCommand,
  address: SCServoAddress,
  values: ArrayLike<number>,
): number {
  if (buffer.length < values.length + PACKET_OVERHEAD) {
    throw new Error('scservo transmit buffer too small')
  }
  buffer[0] = 0xff
  buffer[1] = 0xff
  buffer[2] = id
  buffer[3] = values.length + 3
  buffer[4] = command
  buffer[5] = address
  let index = 6
  for (let i = 0; i < values.length; i++) {
    buffer[index] = values[i]
    index++
  }
  buffer[index] = scservoChecksum(buffer, index)
  return index + 1
}

/**
 * fills the SCSCL WritePos register window
 *
 * The window spans goal position, goal time and goal speed. Sending only the
 * first four bytes leaves a stale goal-speed value in the servo, which makes a
 * correct position command look like a dead servo.
 *
 * @param values destination of at least WRITE_POSITION_VALUE_COUNT bytes
 * @param position raw goal position
 * @param goalTimeMilliseconds goal time register value
 * @returns the same array, filled
 */
export function writePositionValues<T extends Uint8Array | number[]>(
  values: T,
  position: number,
  goalTimeMilliseconds: number,
): T {
  values[0] = (position & 0xff00) >> 8
  values[1] = position & 0xff
  values[2] = (goalTimeMilliseconds & 0xff00) >> 8
  values[3] = goalTimeMilliseconds & 0xff
  // Goal speed is always rewritten so a previous command cannot leak into this one.
  values[4] = 0
  values[5] = 0
  return values
}
