import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createHuangshanBuildCommand,
  createHuangshanFlashCommand,
  createHuangshanMonitorSetupCommand,
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

assert.throws(() => createHuangshanMonitorSetupCommand({
  port: '/tmp/not-serial',
  baud: 1000000,
}), /Unsafe serial port/)

console.log('huangshan device action tests passed')
