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

export function renderSizeReport(target, capacity, resources) {
  return (
    `## Firmware capacity: ${target}\n\n` +
    `| Firmware bytes | Factory bytes | Free bytes | Used |\n| ---: | ---: | ---: | ---: |\n` +
    `| ${capacity.used} | ${capacity.capacity} | ${capacity.free} | ${capacity.percent.toFixed(2)}% |\n\n` +
    `Largest linked resources (subset of firmware size):\n\n| Resource | Bytes |\n| --- | ---: |\n` +
    resources
      .slice(0, 15)
      .map(({ name, bytes }) => `| ${name.replaceAll('|', '\\|')} | ${bytes} |\n`)
      .join('') +
    '\n'
  )
}
