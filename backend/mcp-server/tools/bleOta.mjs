import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])

export async function flashBleOtaTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const deviceName = String(request.deviceName || 'ESP32-Vibe-OTA').trim()

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) return blocked('unsupported-board', `BLE OTA is not available for board ${boardId || '(missing)'}`)

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

  if (!adapters.bleBridge) {
    return blocked('bridge-required', 'BLE OTA requires a browser or native BLE bridge adapter', {
      boardId,
      projectId,
      deviceName,
      firmware,
      bridge: {
        serviceUuid: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
        source: 'src/utils/bleOta.js',
      },
    })
  }
  if (request.confirm !== true) {
    return blocked('confirmation-required', 'Set confirm=true to allow BLE OTA through the bridge', { firmware })
  }

  try {
    const result = await adapters.bleBridge({
      boardId,
      projectId,
      deviceName,
      firmwarePath: firmware.path,
      firmwareSize: firmware.size || null,
    })
    return {
      status: result?.status || 'success',
      category: result?.category || 'ble-ota-complete',
      boardId,
      projectId,
      deviceName,
      firmware,
      progress: result?.progress ?? null,
      logs: result?.logs || [],
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'ble-bridge-error',
      boardId,
      projectId,
      deviceName,
      firmware,
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
