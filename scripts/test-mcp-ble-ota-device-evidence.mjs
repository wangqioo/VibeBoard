import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashBleOtaTool } from '../backend/mcp-server/tools/bleOta.mjs'
import { collectDeviceEvidenceTool } from '../backend/mcp-server/tools/deviceEvidence.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body
    },
  }
}

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-ble-evidence-'))
const projectId = 'ble-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4, 5]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 5 },
    flashFiles: [],
  },
})

const bridgeRequired = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
})
assert.equal(bridgeRequired.status, 'blocked')
assert.equal(bridgeRequired.category, 'bridge-required')
assert.equal(bridgeRequired.firmware.path, firmwarePath)

const confirmationRequired = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
}, {
  bleBridge: async () => ({ status: 'success' }),
})
assert.equal(confirmationRequired.status, 'blocked')
assert.equal(confirmationRequired.category, 'confirmation-required')

let bridgeRequest = null
const bridged = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
  confirm: true,
}, {
  bleBridge: async request => {
    bridgeRequest = request
    return { status: 'success', progress: 100, logs: ['BLE OTA complete'] }
  },
})
assert.equal(bridged.status, 'success')
assert.equal(bridged.category, 'ble-ota-complete')
assert.equal(bridgeRequest.firmwarePath, firmwarePath)
assert.equal(bridgeRequest.deviceName, 'ESP32-Vibe-OTA')

const evidence = await collectDeviceEvidenceTool({
  source: 'serial',
  lines: [
    'I (31) boot: ESP-IDF v5.4.1 2nd stage bootloader',
    'E (9271) lvgl: lv_display_flush_ready called before display init',
    'Guru Meditation Error: Core 1 panic\'ed (LoadProhibited). Exception was unhandled.',
  ],
  deliveryResult: { transport: 'wifi-ota', status: 'queued', jobId: 'job-1', deviceId: 'device-1' },
  manifest: { programName: 'demo' },
  userSymptom: 'screen stays blank',
  otaServiceUrl: 'http://ota.local',
  otaJobId: 'job-1',
}, {
  fetchImpl: async (url) => {
    assert.equal(url, 'http://ota.local/api/ota-jobs/job-1')
    return jsonResponse({ job: { jobId: 'job-1', status: 'flashed', deviceId: 'device-1' } })
  },
})
assert.equal(evidence.status, 'observed')
assert.equal(evidence.otaJob.status, 'flashed')
assert.equal(evidence.deviceEvidence.symptoms.length, 3)
assert.deepEqual(evidence.deviceEvidence.repairableSymptoms.map(item => item.kind), ['lvgl-error', 'guru-meditation'])
assert.equal(evidence.repairContext.kind, 'device-evidence-repair-context')
assert.equal(evidence.repairContext.userSymptom, 'screen stays blank')
assert.equal(evidence.repairContext.canClaimFirmwareCorrectness, false)

const dispatchedEvidence = await dispatchTool('vibeboard.collect_device_evidence', {
  source: 'remote-ota',
  deliveryResult: { transport: 'remote-ota', status: 'done', jobId: 'job-1' },
})
assert.equal(dispatchedEvidence.status, 'success')
assert.equal(dispatchedEvidence.result.deviceEvidence.status, 'success')

const dispatchedBle = await dispatchTool('vibeboard.flash_ble_ota', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
})
assert.equal(dispatchedBle.status, 'success')
assert.equal(dispatchedBle.result.status, 'blocked')
assert.equal(dispatchedBle.result.category, 'bridge-required')

console.log('MCP BLE OTA and device evidence tests passed.')
