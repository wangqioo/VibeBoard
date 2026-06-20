import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createHuangshanBuildCommand,
  createHuangshanFlashCommand,
  createHuangshanMonitorSetupCommand,
  createHuangshanReadbackChunks,
  createHuangshanReadbackVerifyCommand,
  healthPayload,
  listHuangshanSerialPorts,
  resolveWorkspace,
} from '../backend/huangshan-service/server.mjs'

const ports = listHuangshanSerialPorts({
  platform: 'darwin',
  devices: ['/dev/cu.Bluetooth-Incoming-Port', '/dev/cu.usbserial-110', '/dev/cu.debug-console'],
})

assert.deepEqual(ports, [{ path: '/dev/cu.usbserial-110', recommended: true }])

const healthRoot = mkdtempSync(join(tmpdir(), 'huangshan-health-'))
const healthWorkspace = join(healthRoot, 'huangshan-pi-sf32-dev')
const healthSdk = join(healthRoot, 'sifli-sdk')
const healthSftool = join(healthRoot, 'sftool')
mkdirSync(join(healthWorkspace, 'scripts'), { recursive: true })
mkdirSync(healthSdk, { recursive: true })
writeFileSync(join(healthWorkspace, 'scripts/build.sh'), '#!/bin/sh\n')
writeFileSync(join(healthSdk, 'export.sh'), '#!/bin/sh\n')
writeFileSync(healthSftool, '#!/bin/sh\n')

const readyHealth = healthPayload({
  env: {
    HUANGSHAN_WORKSPACE: healthWorkspace,
    SIFLI_SDK_PATH: healthSdk,
    SIFLI_SFTOOL_PATH: healthSftool,
  },
  platform: 'darwin',
  devices: ['/dev/cu.usbserial-110'],
})

assert.equal(readyHealth.service, 'huangshan-service')
assert.equal(readyHealth.boardFamily, 'huangshan')
assert.equal(readyHealth.bridge.mode, 'local')
assert.equal(readyHealth.bridge.status, 'device-ready')
assert.deepEqual(readyHealth.bridge.issues, [])
assert.deepEqual(readyHealth.serialPorts, [{ path: '/dev/cu.usbserial-110', recommended: true }])
assert.equal(readyHealth.checks.buildScript, true)
assert.equal(readyHealth.checks.sdkExport, true)
assert.equal(readyHealth.checks.sftool, true)
assert.equal(readyHealth.checks.serialPort, true)
assert.equal(readyHealth.tools.sftool.path, healthSftool)
assert.equal(readyHealth.tools.sftool.ok, true)

const missingDeviceHealth = healthPayload({
  env: {
    HUANGSHAN_WORKSPACE: healthWorkspace,
    SIFLI_SDK_PATH: healthSdk,
    SIFLI_SFTOOL_PATH: healthSftool,
  },
  platform: 'darwin',
  devices: [],
})

assert.equal(missingDeviceHealth.bridge.status, 'no-device')
assert.deepEqual(missingDeviceHealth.bridge.issues, ['no-device'])
assert.equal(missingDeviceHealth.checks.serialPort, false)

const missingToolHealth = healthPayload({
  env: {
    HUANGSHAN_WORKSPACE: healthWorkspace,
    SIFLI_SDK_PATH: healthSdk,
    SIFLI_SFTOOL_PATH: join(healthRoot, 'missing-sftool'),
  },
  platform: 'darwin',
  devices: ['/dev/cu.usbserial-110'],
})

assert.equal(missingToolHealth.bridge.status, 'missing-flasher')
assert.deepEqual(missingToolHealth.bridge.issues, ['missing-flasher'])
assert.equal(missingToolHealth.checks.sftool, false)

const command = createHuangshanFlashCommand({
  port: '/dev/cu.usbserial-110',
  buildDir: '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu',
})

assert.equal(command.command, 'sftool')
assert.deepEqual(command.args, [
  '-p',
  '/dev/cu.usbserial-110',
  '-c',
  'SF32LB52',
  '-m',
  'nor',
  'write_flash',
  'bootloader/bootloader.bin@0x12010000',
  'main.bin@0x12020000',
  'ftab/ftab.bin@0x12000000',
])
assert.equal(command.cwd, '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu')

const readback = createHuangshanReadbackVerifyCommand({
  port: '/dev/cu.usbserial-110',
  buildDir: '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu',
  outputDir: '/tmp/vibeboard-readback',
  artifact: {
    name: 'main.bin',
    address: '0x12020000',
    size: 2608744,
    sha256: 'e313669960f70d46140f69fa69c7e28f4fbde81293c8403f9175212cd32c364c',
  },
})

assert.equal(readback.command, 'sftool')
assert.deepEqual(readback.args, [
  '-p',
  '/dev/cu.usbserial-110',
  '-c',
  'SF32LB52',
  '-m',
  'nor',
  'read_flash',
  '/tmp/vibeboard-readback/main.bin@0x12020000:2608744',
])
assert.equal(readback.cwd, '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu')
assert.equal(readback.expectedSha256, 'e313669960f70d46140f69fa69c7e28f4fbde81293c8403f9175212cd32c364c')
assert.equal(readback.outputPath, '/tmp/vibeboard-readback/main.bin')

const readbackChunks = createHuangshanReadbackChunks({
  artifact: {
    name: 'main.bin',
    address: '0x12020000',
    size: 600000,
    sha256: 'e313669960f70d46140f69fa69c7e28f4fbde81293c8403f9175212cd32c364c',
  },
  chunkSize: 262144,
})

assert.deepEqual(readbackChunks.map(chunk => ({
  name: chunk.name,
  address: chunk.address,
  size: chunk.size,
  offset: chunk.offset,
})), [
  { name: 'main.bin.part000', address: '0x12020000', size: 262144, offset: 0 },
  { name: 'main.bin.part001', address: '0x12060000', size: 262144, offset: 262144 },
  { name: 'main.bin.part002', address: '0x120a0000', size: 75712, offset: 524288 },
])

const monitor = createHuangshanMonitorSetupCommand({
  port: '/dev/cu.usbserial-110',
  baud: 921600,
  platform: 'darwin',
})
assert.equal(monitor.command, 'stty')
assert.deepEqual(monitor.args, ['-f', '/dev/cu.usbserial-110', '921600', 'raw', '-echo'])

const linuxMonitor = createHuangshanMonitorSetupCommand({
  port: '/dev/ttyUSB0',
  baud: 1000000,
  platform: 'linux',
})
assert.deepEqual(linuxMonitor.args, ['-F', '/dev/ttyUSB0', '1000000', 'raw', '-echo'])

const windowsPaths = resolveWorkspace({
  env: {
    HUANGSHAN_WORKSPACE: 'C:\\Users\\100448405\\huangshan-pi-sf32-dev',
    SIFLI_SDK_PATH: 'C:\\Users\\100448405\\sifli-sdk',
  },
  platform: 'win32',
})
assert.match(windowsPaths.buildScript, /scripts[\\/]build\.ps1$/)
assert.match(windowsPaths.sdkExport, /export\.ps1$/)
const windowsBuild = createHuangshanBuildCommand(windowsPaths)
assert.equal(windowsBuild.command, 'powershell.exe')
assert.deepEqual(windowsBuild.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'])
assert.equal(windowsBuild.label, '.\\scripts\\build.ps1')

assert.throws(() => createHuangshanFlashCommand({
  port: '../bad',
  buildDir: '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu',
}), /Unsafe serial port/)

assert.throws(() => createHuangshanReadbackVerifyCommand({
  port: '../bad',
  buildDir: '/workspace/project/build_sf32lb52-lchspi-ulp_hcpu',
  outputDir: '/tmp/vibeboard-readback',
  artifact: { name: 'main.bin', address: '0x12020000', size: 1, sha256: 'a'.repeat(64) },
}), /Unsafe serial port/)

assert.throws(() => createHuangshanMonitorSetupCommand({
  port: '/tmp/not-serial',
  baud: 1000000,
}), /Unsafe serial port/)

console.log('huangshan device action tests passed')
