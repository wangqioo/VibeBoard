import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])
const DEFAULT_BAUD_RATE = 460800
const APP_OFFSET = 0x10000

export async function flashUsbTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const dryRun = request.dryRun !== false
  const confirm = request.confirm === true
  const baudRate = Number.isFinite(Number(request.baudRate))
    ? Number(request.baudRate)
    : DEFAULT_BAUD_RATE

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) {
    return blocked('unsupported-board', `USB flash is not available for board ${boardId || '(missing)'}`)
  }

  let evidence
  try {
    evidence = await readBuildEvidenceRecord({ artifactDir, projectId })
  } catch (error) {
    return blocked('build-evidence-missing', error.message)
  }

  if (evidence.status !== 'success') {
    return blocked('build-not-successful', 'Latest build evidence is not successful', { buildEvidence: evidence })
  }

  const flashPlan = await createFlashPlan(evidence.artifact)
  if (!flashPlan.length) {
    return blocked('flash-artifact-missing', 'Build evidence does not include firmware or flash files', { buildEvidence: evidence })
  }

  if (dryRun) {
    return {
      status: 'dry-run',
      category: 'ready',
      boardId,
      projectId,
      portPath: request.portPath || null,
      baudRate,
      flashPlan,
      message: 'USB flash plan is valid. Re-run with dryRun=false, confirm=true, and portPath to touch hardware.',
    }
  }

  if (!confirm) {
    return blocked('confirmation-required', 'Set confirm=true to allow USB flashing', { flashPlan })
  }
  if (!request.portPath) {
    return blocked('port-required', 'portPath is required for confirmed USB flashing', { flashPlan })
  }
  if (!adapters.flasher) {
    return blocked('flasher-unavailable', 'No Node USB flasher adapter is configured', { flashPlan })
  }

  try {
    const result = await adapters.flasher({
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashFiles: flashPlan,
    })
    return {
      status: result?.status || 'success',
      category: result?.category || 'flashed',
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashPlan,
      logs: result?.logs || [],
      elapsedMs: result?.elapsedMs ?? null,
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'flasher-error',
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashPlan,
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

async function createFlashPlan(artifact = {}) {
  const files = Array.isArray(artifact?.flashFiles) && artifact.flashFiles.length
    ? artifact.flashFiles
    : artifact?.firmware
      ? [{ name: artifact.firmware.filename || 'app', offset: APP_OFFSET, path: artifact.firmware.path, size: artifact.firmware.size }]
      : []

  const plan = []
  for (const file of files) {
    if (!file?.path) continue
    const offset = Number(file.offset)
    if (!Number.isFinite(offset)) continue
    try {
      await access(file.path)
    } catch {
      continue
    }
    plan.push({
      name: file.name || file.filename || `0x${offset.toString(16)}`,
      offset,
      path: file.path,
      size: file.size || null,
    })
  }

  return plan.sort((a, b) => a.offset - b.offset)
}
