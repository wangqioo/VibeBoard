import { FAILURE_CATEGORIES } from './failureCategories'
import { WORKFLOW_STATUS } from './outcome'

export const ACCEPTANCE_CHECK_STATUS = {
  PASSES: 'passes',
  NEEDS_OBSERVATION: 'needs-observation',
  FAILED: 'failed',
}

function normalizeCheckText(value) {
  return String(value || '').trim()
}

function normalizeEvidenceLines(deviceEvidence = null) {
  return [
    ...(deviceEvidence?.rawContextLines || []),
    ...(deviceEvidence?.lines || []),
    ...(deviceEvidence?.logTail || []),
    ...(deviceEvidence?.symptoms || []).map(item => item.message || item.line || item.raw),
  ]
    .map(line => String(line || '').trim())
    .filter(Boolean)
}

function hasRuntimeFailure(deviceEvidence = null) {
  return Boolean((deviceEvidence?.repairableSymptoms || []).some(item => item.repairable))
}

function checkMatchesEvidence(check, lines) {
  const text = normalizeCheckText(check)
  if (!text || !lines.length) return false

  const containsMatch = text.match(/(?:serial log contains|log contains|contains)\s+(.+)$/i)
  if (containsMatch?.[1]) {
    const needle = containsMatch[1].replace(/^["']|["']$/g, '').trim()
    return lines.some(line => line.toLowerCase().includes(needle.toLowerCase()))
  }

  if (/wifi.*connect/i.test(text)) {
    return lines.some(line => /got ip|IP_EVENT_STA_GOT_IP|wifi.*connected/i.test(line))
  }

  if (/ota.*(success|complete|reboot)/i.test(text)) {
    return lines.some(line => /ota.*(success|complete|reboot)|Firmware upgrade successful/i.test(line))
  }

  if (/ble.*ota.*(success|complete)/i.test(text)) {
    return lines.some(line => /ble_ota|BLE OTA/i.test(line) && /success|complete|committed/i.test(line))
  }

  if (/ready/i.test(text)) {
    return lines.some(line => /ready/i.test(line))
  }

  return false
}

function summarize(status, checks, reason = '') {
  if (reason) return reason
  if (!checks.length) return 'No acceptance checks were defined; runtime observation is still needed.'
  const passed = checks.filter(check => check.status === ACCEPTANCE_CHECK_STATUS.PASSES).length
  if (status === ACCEPTANCE_CHECK_STATUS.PASSES) return `Acceptance checks pass (${passed}/${checks.length}).`
  if (status === ACCEPTANCE_CHECK_STATUS.FAILED) return `Acceptance checks failed (${passed}/${checks.length} passed).`
  return `Acceptance checks need observation (${passed}/${checks.length} passed).`
}

export function evaluateAcceptanceChecks({
  manifest = null,
  buildEvidence = null,
  deviceEvidence = null,
} = {}) {
  const checks = (manifest?.acceptanceChecks || []).map(check => ({
    text: normalizeCheckText(check),
    status: ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION,
    evidence: null,
  })).filter(check => check.text)

  if (buildEvidence?.status && buildEvidence.status !== WORKFLOW_STATUS.SUCCESS) {
    return {
      status: ACCEPTANCE_CHECK_STATUS.FAILED,
      failureCategory: buildEvidence.failureCategory || FAILURE_CATEGORIES.BUILD_FAILED,
      summary: summarize(ACCEPTANCE_CHECK_STATUS.FAILED, checks, 'Build failed before acceptance checks could run.'),
      checks: checks.map(check => ({
        ...check,
        status: ACCEPTANCE_CHECK_STATUS.FAILED,
        evidence: buildEvidence.firstError?.line || buildEvidence.error || null,
      })),
    }
  }

  if (hasRuntimeFailure(deviceEvidence)) {
    return {
      status: ACCEPTANCE_CHECK_STATUS.FAILED,
      failureCategory: FAILURE_CATEGORIES.RUNTIME_FAILED,
      summary: summarize(ACCEPTANCE_CHECK_STATUS.FAILED, checks, 'Device evidence includes a repairable runtime symptom.'),
      checks: checks.map(check => ({
        ...check,
        status: ACCEPTANCE_CHECK_STATUS.FAILED,
        evidence: deviceEvidence.repairableSymptoms?.[0]?.message || null,
      })),
    }
  }

  const lines = normalizeEvidenceLines(deviceEvidence)
  const evaluated = checks.map(check => {
    const matched = checkMatchesEvidence(check.text, lines)
    return {
      ...check,
      status: matched ? ACCEPTANCE_CHECK_STATUS.PASSES : ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION,
      evidence: matched ? lines.find(line => checkMatchesEvidence(check.text, [line])) || null : null,
    }
  })
  const passed = evaluated.filter(check => check.status === ACCEPTANCE_CHECK_STATUS.PASSES).length
  const status = evaluated.length > 0 && passed === evaluated.length
    ? ACCEPTANCE_CHECK_STATUS.PASSES
    : ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION

  return {
    status,
    failureCategory: null,
    summary: summarize(status, evaluated),
    checks: evaluated,
  }
}
