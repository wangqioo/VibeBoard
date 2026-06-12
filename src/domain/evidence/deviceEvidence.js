import {
  DEVICE_EVIDENCE_CATEGORIES,
  DEVICE_EVIDENCE_STATUS,
  DEVICE_LOG_PATTERNS,
} from './devicePatterns.js'

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g
const LOG_PREFIX_PATTERN = /^([EWIDV])\s+\((\d+)\)\s+([^:]+):\s*(.*)$/

const LEVEL_SEVERITY = {
  E: 'error',
  W: 'warning',
  I: 'info',
  D: 'debug',
  V: 'trace',
}

export function stripDeviceLogAnsi(text) {
  return String(text || '').replace(ANSI_PATTERN, '')
}

function parseEspIdfPrefix(line) {
  const match = line.match(LOG_PREFIX_PATTERN)
  if (!match) return null
  return {
    level: match[1],
    timestampMs: Number(match[2]),
    component: match[3].trim(),
    message: match[4].trim(),
  }
}

function cloneDetails(details) {
  if (!details || typeof details !== 'object') return {}
  return { ...details }
}

export function parseDeviceLogLine(raw, source = 'serial') {
  const rawText = String(raw ?? '')
  const line = stripDeviceLogAnsi(rawText).trim()
  const prefix = parseEspIdfPrefix(line)
  const matched = DEVICE_LOG_PATTERNS.find(item => item.pattern.test(line))
  const severity = matched?.severity || LEVEL_SEVERITY[prefix?.level] || 'info'
  const details = matched?.details ? matched.details(line, prefix) : {}

  return {
    raw: rawText,
    line,
    source,
    category: matched?.category || DEVICE_EVIDENCE_CATEGORIES.UNKNOWN,
    kind: matched?.kind || 'unclassified',
    status: matched?.status || DEVICE_EVIDENCE_STATUS.OBSERVED,
    severity,
    repairable: Boolean(matched?.repairable),
    timestampMs: prefix?.timestampMs ?? null,
    component: prefix?.component || null,
    message: prefix?.message || line,
    details: cloneDetails(details),
  }
}

export function findDeviceSymptoms(logLines = []) {
  return logLines
    .map(item => {
      if (item && typeof item === 'object' && item.kind && item.raw != null) return item
      return parseDeviceLogLine(item)
    })
    .filter(item => item.category !== DEVICE_EVIDENCE_CATEGORIES.UNKNOWN)
}

export function createDeviceEvidence({
  source = 'serial',
  status = DEVICE_EVIDENCE_STATUS.OBSERVED,
  lines = [],
  deliveryResult = null,
  deviceInfo = null,
  elapsedMs = null,
} = {}) {
  const cleanLines = lines.map(line => stripDeviceLogAnsi(line))
  const symptoms = cleanLines
    .map(line => parseDeviceLogLine(line, source))
    .filter(item => item.category !== DEVICE_EVIDENCE_CATEGORIES.UNKNOWN)
  const repairableSymptoms = symptoms.filter(item => item.repairable)

  return {
    source,
    status,
    lines: cleanLines,
    deliveryResult,
    deviceInfo,
    elapsedMs,
    symptoms,
    repairableSymptoms,
    rawContextLines: cleanLines,
    logTail: cleanLines.slice(-40),
  }
}

function normalizeDeliveryStatus(status) {
  if (status === true) return DEVICE_EVIDENCE_STATUS.SUCCESS
  if (status === false) return DEVICE_EVIDENCE_STATUS.FAILURE
  if (status === DEVICE_EVIDENCE_STATUS.SUCCESS || status === 'ok' || status === 'done' || status === 'flashed' || status === 'rebooting') {
    return DEVICE_EVIDENCE_STATUS.SUCCESS
  }
  if (status === DEVICE_EVIDENCE_STATUS.FAILURE || status === 'error' || status === 'failed') {
    return DEVICE_EVIDENCE_STATUS.FAILURE
  }
  if (status === DEVICE_EVIDENCE_STATUS.QUEUED || status === 'queued' || status === 'uploading' || status === 'pushing') {
    return DEVICE_EVIDENCE_STATUS.QUEUED
  }
  return DEVICE_EVIDENCE_STATUS.OBSERVED
}

function inferDeliveryStatus(status, deliveryResult) {
  if (status) return normalizeDeliveryStatus(status)
  if (deliveryResult?.status) return normalizeDeliveryStatus(deliveryResult.status)
  if (deliveryResult?.ok !== undefined) return normalizeDeliveryStatus(Boolean(deliveryResult.ok))
  if (deliveryResult?.error) return DEVICE_EVIDENCE_STATUS.FAILURE
  return DEVICE_EVIDENCE_STATUS.OBSERVED
}

function deliveryEvidenceKind(status) {
  if (status === DEVICE_EVIDENCE_STATUS.SUCCESS) return 'delivery-success'
  if (status === DEVICE_EVIDENCE_STATUS.FAILURE) return 'delivery-failure'
  if (status === DEVICE_EVIDENCE_STATUS.QUEUED) return 'delivery-queued'
  return 'delivery-observed'
}

function inferFirmwareSize(firmwareSize, deliveryResult) {
  return firmwareSize ?? deliveryResult?.firmwareSize ?? deliveryResult?.size ?? null
}

function inferProgress(progress, deliveryResult) {
  return progress ?? deliveryResult?.progress ?? deliveryResult?.percent ?? null
}

function inferDeliveryMessage({ message, transport, status, deliveryResult }) {
  if (message) return message
  if (deliveryResult?.message) return deliveryResult.message
  if (deliveryResult?.error) return deliveryResult.error
  return `${transport || 'delivery'} ${status}`
}

export function createDeliveryDeviceEvidence({
  transport,
  status = null,
  message = '',
  firmwareSize = null,
  progress = null,
  deliveryResult = null,
  deviceInfo = null,
  elapsedMs = null,
} = {}) {
  const result = deliveryResult && typeof deliveryResult === 'object' ? deliveryResult : {}
  const normalizedTransport = transport || result.transport || 'delivery'
  const normalizedStatus = inferDeliveryStatus(status, result)
  const normalizedFirmwareSize = inferFirmwareSize(firmwareSize, result)
  const normalizedProgress = inferProgress(progress, result)
  const text = inferDeliveryMessage({
    message,
    transport: normalizedTransport,
    status: normalizedStatus,
    deliveryResult: result,
  })
  const repairable = normalizedStatus === DEVICE_EVIDENCE_STATUS.FAILURE
  const symptom = {
    raw: text,
    line: text,
    source: normalizedTransport,
    category: DEVICE_EVIDENCE_CATEGORIES.DELIVERY,
    kind: deliveryEvidenceKind(normalizedStatus),
    status: normalizedStatus === DEVICE_EVIDENCE_STATUS.QUEUED ? DEVICE_EVIDENCE_STATUS.OBSERVED : normalizedStatus,
    severity: repairable ? 'error' : 'info',
    repairable,
    timestampMs: null,
    component: normalizedTransport,
    message: text,
    details: {
      transport: normalizedTransport,
      firmwareSize: normalizedFirmwareSize,
      progress: normalizedProgress,
    },
  }

  return {
    source: normalizedTransport,
    status: normalizedStatus,
    lines: [text],
    deliveryResult: {
      ...result,
      transport: normalizedTransport,
      status: normalizedStatus,
      firmwareSize: normalizedFirmwareSize,
      progress: normalizedProgress,
      message: text,
    },
    deviceInfo,
    elapsedMs,
    symptoms: [symptom],
    repairableSymptoms: repairable ? [symptom] : [],
    rawContextLines: [text],
    logTail: [text],
  }
}

function summarizeRepairableSymptoms(symptoms = []) {
  if (!symptoms.length) return 'No repairable device symptoms were detected from runtime evidence.'
  const categories = [...new Set(symptoms.map(item => item.category))]
  return `${symptoms.length} repairable device symptom${symptoms.length === 1 ? '' : 's'} detected: ${categories.join(', ')}.`
}

export function createDeviceRepairContext({
  deviceEvidence = null,
  manifest = null,
  userSymptom = '',
} = {}) {
  const evidence = deviceEvidence || createDeviceEvidence()
  const repairableSymptoms = evidence.repairableSymptoms || []

  return {
    kind: 'device-evidence-repair-context',
    source: evidence.source || 'serial',
    status: evidence.status || DEVICE_EVIDENCE_STATUS.OBSERVED,
    summary: summarizeRepairableSymptoms(repairableSymptoms),
    symptoms: repairableSymptoms.map(item => ({
      category: item.category,
      kind: item.kind,
      severity: item.severity,
      status: item.status,
      component: item.component,
      message: item.message,
      details: cloneDetails(item.details),
      raw: item.raw,
    })),
    rawContextLines: [...(evidence.rawContextLines || evidence.lines || [])],
    deliveryResult: evidence.deliveryResult || null,
    deviceInfo: evidence.deviceInfo || null,
    manifest,
    userSymptom,
    canClaimFirmwareCorrectness: false,
    aiInstructions: [
      'Use these runtime lines as evidence of observed device behavior only.',
      'Prefer the smallest application-source repair that addresses the repairable symptoms.',
      'Preserve raw context lines when explaining the failure or proposing the next action.',
      'Treat passing or successful lines as observations, not as proof of overall firmware validity.',
    ],
  }
}
