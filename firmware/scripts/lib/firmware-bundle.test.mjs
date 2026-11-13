import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { firmwareDirectory } from './build-output.mjs'
import { devices } from './devices.mjs'
import {
  assembleFirmwareBundle,
  buildFirmwareBundleTarget,
  firmwareBundleName,
  firmwareBundleTargetMetadataName,
  firmwareBundleTargets,
  packageFirmwareBundle,
  resolveFirmwareBundleTarget,
} from './firmware-bundle.mjs'

test('bundle targets match the supported command registry and manifest devices', () => {
  const manifest = JSON.parse(readFileSync(path.join(firmwareDirectory, 'host/app/manifest.json'), 'utf8'))
  const configuredIds = firmwareBundleTargets.map(({ bundleId }) => bundleId)

  assert.equal(firmwareBundleName, manifest.bundle.id)
  assert.deepEqual(configuredIds.sort(), [...manifest.bundle.devices].sort())
  assert.deepEqual(firmwareBundleTargets.map(({ name }) => name).sort(), Object.keys(devices).sort())
  assert.equal(new Set(configuredIds).size, configuredIds.length)
  assert.equal(resolveFirmwareBundleTarget('m5stackchan_cores3').bundleId, 'm5stackchan_cores3')
})

test('builds a release target through a final sdkconfig manifest override', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-bundle-target-'))
  const moddableDirectory = path.join(root, 'moddable')
  const outputDirectory = path.join(root, 'output')
  const sdkconfigDirectory = path.join(moddableDirectory, 'build/devices/esp32/targets/m5stack_cores3/sdkconfig')
  const moddableVersion = '8.3.1'
  const firmwareVersion = '8.3.1+stackchan.1'
  let wrapperManifestPath
  let linkedKeyCount = 7800

  try {
    mkdirSync(path.join(moddableDirectory, 'tools'), { recursive: true })
    mkdirSync(sdkconfigDirectory, { recursive: true })
    writeFileSync(path.join(moddableDirectory, 'tools', 'VERSION'), `${moddableVersion}\n`)
    writeFileSync(path.join(sdkconfigDirectory, 'sdkconfig.defaults'), 'CONFIG_SPIRAM=y\n')
    writeFileSync(path.join(sdkconfigDirectory, 'partitions.csv'), 'fixture partitions\n')

    const options = {
      moddableDirectory,
      outputDirectory,
      runCommand(command, args, cwd, env) {
        assert.equal(command, 'mcconfig')
        assert.equal(cwd, firmwareDirectory)
        assert.equal(env.MODDABLE, moddableDirectory)
        assert.equal(args[args.indexOf('-p') + 1], 'esp32:./host/platforms/m5stackchan_cores3')

        wrapperManifestPath = args.at(-1)
        assert.equal(path.dirname(wrapperManifestPath), path.join(firmwareDirectory, 'host/app'))
        const wrapper = JSON.parse(readFileSync(wrapperManifestPath, 'utf8'))
        assert.equal(wrapper.include[0], path.join(firmwareDirectory, 'host/app/manifest_m5stackchan_cores3.json'))
        const override = JSON.parse(readFileSync(wrapper.include[1], 'utf8'))
        assert.equal(override.build.SDKCONFIGPATH, path.join(outputDirectory, 'generated/sdkconfig/m5stackchan_cores3'))

        const buildDirectory = path.join(outputDirectory, 'bin/esp32/m5stackchan_cores3/release/stack-chan-host')
        mkdirSync(buildDirectory, { recursive: true })
        const linkerDirectory = path.join(outputDirectory, 'tmp/esp32/m5stackchan_cores3/release/stack-chan-host')
        mkdirSync(linkerDirectory, { recursive: true })
        writeFileSync(path.join(linkerDirectory, 'mc.xs.c'), `#define mxKeysCount ${linkedKeyCount}\n`)
        writeFileSync(path.join(buildDirectory, 'bootloader.bin'), Buffer.from([1]))
        writePartitionTable(path.join(buildDirectory, 'partition-table.bin'), 256)
        writeFirmware(path.join(buildDirectory, 'xs_esp32.bin'), firmwareVersion)
      },
    }
    const result = buildFirmwareBundleTarget('m5stackchan_cores3', options)

    assert.equal(result.target.bundleId, 'm5stackchan_cores3')
    assert.equal(result.firmwareVersion, firmwareVersion)
    assert.equal(existsSync(wrapperManifestPath), false)
    assert.deepEqual(readdirSync(result.directory).sort(), [
      'bootloader.bin',
      'bundle-target.json',
      'partition-table.bin',
      'xs_esp32.bin',
    ])
    const metadataPath = path.join(result.directory, firmwareBundleTargetMetadataName)
    assert.equal(JSON.parse(readFileSync(metadataPath, 'utf8')).keys.used, linkedKeyCount)
    linkedKeyCount = 8087
    assert.throws(() => buildFirmwareBundleTarget('m5stackchan_cores3', options), /XS key reserve below/)
    assert.equal(
      JSON.parse(readFileSync(metadataPath, 'utf8')).keys.used,
      7800,
      'rejected builds preserve the staged valid target',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('assembles validated target artifacts without publishing staging metadata', () => {
  const fixture = createBundleFixture()

  try {
    const result = assembleFirmwareBundle({
      inputDirectory: fixture.inputDirectory,
      outputDirectory: fixture.outputDirectory,
    })

    assert.equal(result.firmwareVersion, fixture.firmwareVersion)
    assert.equal(result.bundleDirectory, path.join(fixture.outputDirectory, firmwareBundleName))
    for (const { bundleId } of firmwareBundleTargets) {
      assert.deepEqual(readdirSync(path.join(result.bundleDirectory, bundleId)).sort(), [
        'bootloader.bin',
        'partition-table.bin',
        'xs_esp32.bin',
      ])
    }
  } finally {
    fixture.remove()
  }
})

test('creates the distributable archive only after target validation', () => {
  const fixture = createBundleFixture()
  const commands = []

  try {
    const result = packageFirmwareBundle({
      inputDirectory: fixture.inputDirectory,
      outputDirectory: fixture.outputDirectory,
      runCommand(command, args, cwd) {
        commands.push({ command, args, cwd })
        writeFileSync(path.join(cwd, args[1]), 'fixture archive')
      },
    })

    assert.deepEqual(commands, [
      {
        command: 'zip',
        args: ['-r', `${firmwareBundleName}.zip`, firmwareBundleName],
        cwd: fixture.outputDirectory,
      },
    ])
    assert.equal(readFileSync(result.bundleZipPath, 'utf8'), 'fixture archive')
  } finally {
    fixture.remove()
  }
})

test('rejects incomplete target sets and firmware that exceeds its factory partition', () => {
  const incomplete = createBundleFixture()
  const oversized = createBundleFixture()

  try {
    rmSync(path.join(incomplete.inputDirectory, firmwareBundleTargets[0].bundleId), {
      recursive: true,
      force: true,
    })
    assert.throws(
      () =>
        assembleFirmwareBundle({
          inputDirectory: incomplete.inputDirectory,
          outputDirectory: incomplete.outputDirectory,
        }),
      /Bundle target set mismatch/,
    )

    const targetDirectory = path.join(oversized.inputDirectory, firmwareBundleTargets[0].bundleId)
    writeFirmware(path.join(targetDirectory, 'xs_esp32.bin'), oversized.firmwareVersion, 320)
    assert.throws(
      () =>
        assembleFirmwareBundle({
          inputDirectory: oversized.inputDirectory,
          outputDirectory: oversized.outputDirectory,
        }),
      /Firmware exceeds factory app partition/,
    )
  } finally {
    incomplete.remove()
    oversized.remove()
  }
})

test('rejects a firmware image that disagrees with its staged metadata', () => {
  const fixture = createBundleFixture()

  try {
    const { bundleId } = firmwareBundleTargets[0]
    const targetDirectory = path.join(fixture.inputDirectory, bundleId)
    writeFirmware(path.join(targetDirectory, 'xs_esp32.bin'), '9.9.9')

    assert.throws(
      () =>
        assembleFirmwareBundle({
          inputDirectory: fixture.inputDirectory,
          outputDirectory: fixture.outputDirectory,
        }),
      /Bundle firmware version mismatch/,
    )
  } finally {
    fixture.remove()
  }
})

function createBundleFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'stackchan-firmware-bundle-'))
  const inputDirectory = path.join(root, 'input')
  const outputDirectory = path.join(root, 'output')
  const firmwareVersion = '8.3.1'
  mkdirSync(inputDirectory, { recursive: true })
  mkdirSync(outputDirectory, { recursive: true })

  for (const { bundleId } of firmwareBundleTargets) {
    const targetDirectory = path.join(inputDirectory, bundleId)
    mkdirSync(targetDirectory, { recursive: true })
    writeFileSync(path.join(targetDirectory, 'bootloader.bin'), Buffer.from([1]))
    writePartitionTable(path.join(targetDirectory, 'partition-table.bin'), 256)
    writeFirmware(path.join(targetDirectory, 'xs_esp32.bin'), firmwareVersion)
    writeMetadata(targetDirectory, bundleId, firmwareVersion)
  }

  return {
    inputDirectory,
    outputDirectory,
    firmwareVersion,
    remove() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function writePartitionTable(filePath, factorySize) {
  const partitionTable = Buffer.alloc(64)
  partitionTable.writeUInt16LE(0x50aa, 0)
  partitionTable.writeUInt8(0, 2)
  partitionTable.writeUInt8(0, 3)
  partitionTable.writeUInt32LE(0x10000, 4)
  partitionTable.writeUInt32LE(factorySize, 8)
  writeFileSync(filePath, partitionTable)
}

function writeFirmware(filePath, version, size = 128) {
  const firmware = Buffer.alloc(size)
  firmware.writeUInt32LE(0xabcd5432, 0x20)
  firmware.write(version, 0x30, 'utf8')
  writeFileSync(filePath, firmware)
}

function writeMetadata(directory, target, firmwareVersion) {
  writeFileSync(
    path.join(directory, firmwareBundleTargetMetadataName),
    JSON.stringify({
      format: 'tech.moddable.stackchan.bundle-target',
      formatVersion: 1,
      target,
      firmwareVersion,
    }),
  )
}

test('rejects retired targets and stale staged firmware before packaging', () => {
  for (const target of ['m5stack', 'm5stack_core2', 'm5stack_cores3', 'stackchan_rt', 'takao_core2_sg90']) {
    assert.throws(() => resolveFirmwareBundleTarget(target), /Unknown firmware bundle target/)
  }
  const fixture = createBundleFixture()
  try {
    mkdirSync(path.join(fixture.inputDirectory, 'com.m5stack'))
    assert.throws(() => assembleFirmwareBundle(fixture), /Bundle target set mismatch/)
  } finally {
    fixture.remove()
  }
})
