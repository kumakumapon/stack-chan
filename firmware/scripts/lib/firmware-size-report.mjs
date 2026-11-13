import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/** Read the actual linked resource table, excluding intermediate PNG/BMP files. */
export function resourceSizes(source, directory) {
  return [...source.matchAll(/\{"([^"\n]+)",\s*_\d+,\s*sizeof\(_\d+\)\}/g)]
    .map(([, name]) => {
      if (path.basename(name) !== name) throw new Error('Invalid compiled resource name')
      return { name, bytes: statSync(path.join(directory, name)).size }
    })
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
}

export function firmwareCapacity(directory) {
  const table = readFileSync(path.join(directory, 'partition-table.bin'))
  let capacity
  for (let offset = 0; offset + 32 <= table.length && table.readUInt16LE(offset) === 0x50aa; offset += 32) {
    if (table[offset + 2] === 0 && table[offset + 3] === 0) capacity = table.readUInt32LE(offset + 8)
  }
  if (!capacity) throw new Error('Factory app partition is missing')
  const used = statSync(path.join(directory, 'xs_esp32.bin')).size
  if (used > capacity) throw new Error(`Firmware exceeds factory app partition (${used} > ${capacity})`)
  return { used, capacity, free: capacity - used, percent: (100 * used) / capacity }
}

export function renderSizeReport(target, capacity, resources, keys) {
  return (
    `## Firmware capacity: ${target}\n\n` +
    `| Firmware bytes | Factory bytes | Free bytes | Used |\n| ---: | ---: | ---: | ---: |\n` +
    `| ${capacity.used} | ${capacity.capacity} | ${capacity.free} | ${capacity.percent.toFixed(2)}% |\n\n` +
    (keys
      ? `| XS keys | Limit | Free | Minimum free |\n| ---: | ---: | ---: | ---: |\n| ${keys.used} | ${keys.capacity} | ${keys.free} | ${keys.minimumFree} |\n\n`
      : '') +
    `Largest linked resources (subset of firmware size):\n\n| Resource | Bytes |\n| --- | ---: |\n` +
    resources
      .slice(0, 15)
      .map(({ name, bytes }) => `| ${name.replaceAll('|', '\\|')} | ${bytes} |\n`)
      .join('') +
    '\n'
  )
}

// Moddable SDK 9.0.0 xsl writes this count into the generated mc.xs.c.
export const XS_KEY_LIMIT = 8192
export const XS_MINIMUM_FREE_KEYS = 256

export function xsKeyCapacity(source) {
  const definitions = [...source.matchAll(/^[ \t]*#[ \t]*define[ \t]+mxKeysCount[ \t]+([0-9]+)[ \t]*\r?$/gm)]
  if (definitions.length !== 1) throw new Error('Expected one generated mxKeysCount definition')
  const used = Number(definitions[0][1])
  if (!Number.isSafeInteger(used) || used <= 0 || used > XS_KEY_LIMIT) {
    throw new Error(`Invalid XS key count: ${used} (limit ${XS_KEY_LIMIT})`)
  }
  return { used, capacity: XS_KEY_LIMIT, free: XS_KEY_LIMIT - used, minimumFree: XS_MINIMUM_FREE_KEYS }
}

export function assertXsKeyReserve(keys) {
  if (keys.free < XS_MINIMUM_FREE_KEYS) {
    throw new Error(
      `XS key reserve below ${XS_MINIMUM_FREE_KEYS}: ${keys.used}/${keys.capacity} used, ${keys.free} free`,
    )
  }
}
