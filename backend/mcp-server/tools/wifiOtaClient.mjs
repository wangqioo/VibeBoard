import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export async function uploadFirmwareForWifiOta({
  otaServiceUrl,
  firmwarePath,
  filename,
  fetchImpl = fetch,
  fileFactory = defaultFileFactory,
} = {}) {
  const form = new FormData()
  const file = await fileFactory(firmwarePath, filename || basename(firmwarePath))
  form.append('file', file, file.name || filename || basename(firmwarePath))

  const response = await fetchImpl(joinUrl(otaServiceUrl, '/api/firmware'), {
    method: 'POST',
    body: form,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `upload firmware failed: HTTP ${response.status}`)
  }
  return data.firmware
}

export async function createWifiOtaJob({
  otaServiceUrl,
  deviceId,
  firmwareId,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(joinUrl(otaServiceUrl, '/api/ota-jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, firmwareId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `create OTA job failed: HTTP ${response.status}`)
  }
  return data.job
}

export function joinUrl(base, path) {
  return `${String(base || 'http://127.0.0.1:8760').replace(/\/+$/, '')}${path}`
}

async function defaultFileFactory(path, filename) {
  const bytes = await readFile(path)
  return new File([bytes], filename, { type: 'application/octet-stream' })
}
