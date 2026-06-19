import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashUsbTool } from '../backend/mcp-server/tools/usbFlash.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-usb-flash-'))
const projectId = 'usb-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
const bootloaderPath = join(projectDir, 'bootloader.bin')
const partitionPath = join(projectDir, 'partition-table.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4]))
await writeFile(bootloaderPath, Buffer.from([5, 6]))
await writeFile(partitionPath, Buffer.from([7, 8]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 4 },
    flashFiles: [
      { name: 'bootloader', offset: 0, path: bootloaderPath, size: 2 },
      { name: 'partition-table', offset: 0x8000, path: partitionPath, size: 2 },
      { name: 'app', offset: 0x10000, path: firmwarePath, size: 4 },
    ],
  },
})

const missingPort = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  confirm: true,
  dryRun: false,
})
assert.equal(missingPort.status, 'blocked')
assert.equal(missingPort.category, 'port-required')

const dryRun = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(dryRun.status, 'dry-run')
assert.deepEqual(dryRun.flashPlan.map(file => file.offset), [0, 0x8000, 0x10000])
assert.equal(dryRun.flashPlan[2].path, firmwarePath)

let adapterRequest = null
const confirmed = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  portPath: '/dev/cu.usbmodem1101',
  confirm: true,
  dryRun: false,
}, {
  flasher: async request => {
    adapterRequest = request
    return { status: 'success', logs: ['flashed'], elapsedMs: 12 }
  },
})
assert.equal(confirmed.status, 'success')
assert.equal(adapterRequest.portPath, '/dev/cu.usbmodem1101')
assert.equal(adapterRequest.baudRate, 460800)
assert.equal(adapterRequest.flashFiles.length, 3)

const dispatched = await dispatchTool('vibeboard.flash_usb', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'dry-run')

const missingEvidence = await flashUsbTool({
  artifactDir,
  projectId: 'missing-project',
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(missingEvidence.status, 'blocked')
assert.equal(missingEvidence.category, 'build-evidence-missing')

console.log('MCP USB flash tests passed.')
