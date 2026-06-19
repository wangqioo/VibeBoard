import {
  createDeliveryDeviceEvidence,
  createDeviceEvidence,
  createDeviceRepairContext,
} from '../../../src/domain/evidence/deviceEvidence.js'
import { requireObject } from './validate.mjs'

const DEFAULT_OTA_SERVICE_URL = 'http://127.0.0.1:8760'

export async function collectDeviceEvidenceTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const source = request.source || inferSource(request.deliveryResult)
  const lines = Array.isArray(request.lines) ? request.lines.map(String) : []
  const otaJob = await fetchOtaJob(request, adapters.fetchImpl)
  const deliveryResult = {
    ...(request.deliveryResult && typeof request.deliveryResult === 'object' ? request.deliveryResult : {}),
    ...(otaJob ? { otaJob } : {}),
  }

  const baseEvidence = lines.length
    ? createDeviceEvidence({
      source,
      status: request.status,
      lines,
      deliveryResult: Object.keys(deliveryResult).length ? deliveryResult : null,
      deviceInfo: request.deviceInfo || null,
      elapsedMs: request.elapsedMs ?? null,
    })
    : createDeliveryDeviceEvidence({
      transport: source,
      status: request.status,
      deliveryResult: Object.keys(deliveryResult).length ? deliveryResult : null,
      deviceInfo: request.deviceInfo || null,
      elapsedMs: request.elapsedMs ?? null,
    })

  const repairContext = createDeviceRepairContext({
    deviceEvidence: baseEvidence,
    manifest: request.manifest || null,
    userSymptom: request.userSymptom || '',
  })

  return {
    status: 'observed',
    source,
    otaJob,
    deviceEvidence: baseEvidence,
    repairContext,
  }
}

function inferSource(deliveryResult) {
  if (deliveryResult?.transport) return deliveryResult.transport
  return 'serial'
}

async function fetchOtaJob(request, fetchImpl = fetch) {
  if (!request.otaJobId) return null
  const base = String(request.otaServiceUrl || DEFAULT_OTA_SERVICE_URL).replace(/\/+$/, '')
  const response = await fetchImpl(`${base}/api/ota-jobs/${encodeURIComponent(request.otaJobId)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    return {
      jobId: request.otaJobId,
      status: 'unknown',
      error: data.error || `query OTA job failed: HTTP ${response.status}`,
    }
  }
  return data.job || null
}
