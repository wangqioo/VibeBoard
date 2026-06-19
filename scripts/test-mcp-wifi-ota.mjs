import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashWifiOtaTool } from '../backend/mcp-server/tools/wifiOta.mjs'
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

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-wifi-ota-'))
const projectId = 'wifi-ota-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 4 },
    flashFiles: [],
  },
})

const missingDevice = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
})
assert.equal(missingDevice.status, 'blocked')
assert.equal(missingDevice.category, 'device-id-required')

const calls = []
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, options })
  if (String(url).endsWith('/api/firmware')) {
    assert.equal(options.method, 'POST')
    assert.equal(typeof options.body?.get, 'function')
    const file = options.body.get('file')
    assert.equal(file.name, 'firmware.bin')
    assert.equal(file.size, 4)
    return jsonResponse({ firmware: { firmwareId: 'fw-1', filename: 'firmware.bin', size: 4 } })
  }
  if (String(url).endsWith('/api/ota-jobs')) {
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), {
      deviceId: 'device-1',
      firmwareId: 'fw-1',
    })
    return jsonResponse({ job: { jobId: 'job-1', deviceId: 'device-1', firmwareId: 'fw-1', status: 'queued' } })
  }
  throw new Error(`unexpected url ${url}`)
}

const queued = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local/',
}, { fetchImpl: fakeFetch })
assert.equal(queued.status, 'queued')
assert.equal(queued.category, 'ota-job-created')
assert.equal(queued.firmware.firmwareId, 'fw-1')
assert.equal(queued.job.jobId, 'job-1')
assert.deepEqual(calls.map(call => call.url), [
  'http://ota.local/api/firmware',
  'http://ota.local/api/ota-jobs',
])

const dispatched = await dispatchTool('vibeboard.flash_wifi_ota', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local',
}, { fetchImpl: fakeFetch })
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'queued')

const serviceFailure = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local',
}, {
  fetchImpl: async () => jsonResponse({ error: 'device not found' }, false, 404),
})
assert.equal(serviceFailure.status, 'failure')
assert.equal(serviceFailure.category, 'ota-service-error')
assert.match(serviceFailure.message, /device not found/)

console.log('MCP WiFi OTA tests passed.')
