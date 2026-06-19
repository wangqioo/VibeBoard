import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'
import { createWifiOtaJob, uploadFirmwareForWifiOta } from './wifiOtaClient.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])
const DEFAULT_OTA_SERVICE_URL = 'http://127.0.0.1:8760'

export async function flashWifiOtaTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const deviceId = String(request.deviceId || '').trim()
  const otaServiceUrl = request.otaServiceUrl || DEFAULT_OTA_SERVICE_URL

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) return blocked('unsupported-board', `WiFi OTA is not available for board ${boardId || '(missing)'}`)
  if (!deviceId) return blocked('device-id-required', 'deviceId is required')

  let evidence
  try {
    evidence = await readBuildEvidenceRecord({ artifactDir, projectId })
  } catch (error) {
    return blocked('build-evidence-missing', error.message)
  }
  if (evidence.status !== 'success') {
    return blocked('build-not-successful', 'Latest build evidence is not successful', { buildEvidence: evidence })
  }

  const firmware = evidence.artifact?.firmware
  if (!firmware?.path) {
    return blocked('firmware-artifact-missing', 'Build evidence does not include a firmware artifact', { buildEvidence: evidence })
  }
  try {
    await access(firmware.path)
  } catch (error) {
    return blocked('firmware-file-missing', error.message, { firmware })
  }

  try {
    const uploadedFirmware = await uploadFirmwareForWifiOta({
      otaServiceUrl,
      firmwarePath: firmware.path,
      filename: firmware.filename,
      fetchImpl: adapters.fetchImpl,
      fileFactory: adapters.fileFactory,
    })
    const job = await createWifiOtaJob({
      otaServiceUrl,
      deviceId,
      firmwareId: uploadedFirmware.firmwareId,
      fetchImpl: adapters.fetchImpl,
    })

    return {
      status: 'queued',
      category: 'ota-job-created',
      projectId,
      boardId,
      deviceId,
      otaServiceUrl,
      firmware: uploadedFirmware,
      job,
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'ota-service-error',
      projectId,
      boardId,
      deviceId,
      otaServiceUrl,
      message: error.message,
    }
  }
}

function blocked(category, message, extra = {}) {
  return {
    status: 'blocked',
    category,
    message,
    ...extra,
  }
}
