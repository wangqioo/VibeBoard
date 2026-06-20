import { createHuangshanBuildEvidence } from '../domain/huangshan/buildEvidence'

function huangshanUrl(path, baseUrl = '') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  return `${base}${cleanPath}`
}

export async function loadHuangshanHealth({ baseUrl } = {}) {
  const res = await fetch(huangshanUrl('/huangshan/health', baseUrl))
  if (!res.ok) throw new Error(`Failed to load Huangshan service health: HTTP ${res.status}`)
  return res.json()
}

export async function loadHuangshanSerialPorts({ baseUrl } = {}) {
  const res = await fetch(huangshanUrl('/huangshan/serial-ports', baseUrl))
  if (!res.ok) throw new Error(`Failed to load Huangshan serial ports: HTTP ${res.status}`)
  return res.json()
}

export async function renderHuangshanLvglPreview({ displayName, description, files, tap, baseUrl } = {}) {
  const res = await fetch(huangshanUrl('/huangshan/render-lvgl', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, description, files, tap }),
  })
  if (!res.ok) throw new Error(`Huangshan LVGL render service failed: HTTP ${res.status}`)
  const payload = await res.json()
  if (payload.status !== 'success') {
    throw new Error(payload.error || 'Huangshan LVGL render failed')
  }
  return payload
}

async function runHuangshanStream({ url, baseUrl, method = 'POST', body, initialStatus, onStatus, onLog, signal }) {
  onStatus?.(initialStatus)
  const logLines = []
  const startedAt = Date.now()

  const res = await fetch(huangshanUrl(url, baseUrl), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  })
  if (!res.ok) throw new Error(`Huangshan service connection failed: HTTP ${res.status}`)

  return new Promise((resolve, reject) => {
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    function parseLine(line) {
      if (!line.startsWith('data: ')) return
      const msg = JSON.parse(line.slice(6))
      if (msg.log !== undefined) {
        logLines.push(msg.log)
        onLog?.(msg.log)
      }
      if (msg.done) {
        const evidence = createHuangshanBuildEvidence({
          status: msg.status || (msg.error ? 'failure' : 'success'),
          command: msg.command || './scripts/build.sh',
          error: msg.error || '',
          logLines,
          elapsedMs: msg.elapsedMs || Date.now() - startedAt,
        })
        evidence.artifactSummary = msg.artifactSummary || { artifacts: [] }
        if (msg.error) {
          const error = new Error(msg.error)
          error.buildEvidence = evidence
          reject(error)
        } else {
          resolve({ evidence, message: msg })
        }
      }
    }

    function pump() {
      reader.read().then(({ done, value }) => {
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) parseLine(line)
        pump()
      }).catch(reject)
    }

    pump()
  })
}

export async function monitorHuangshanSerial({ port, baud = 1000000, signal, onStatus, onLog, baseUrl } = {}) {
  return runHuangshanStream({
    url: '/huangshan/monitor',
    baseUrl,
    body: { port, baud },
    signal,
    initialStatus: `Connecting serial port ${port}...`,
    onStatus,
    onLog,
  })
}

export async function buildHuangshanWorkspace({ files, onStatus, onLog, baseUrl } = {}) {
  const result = await runHuangshanStream({
    url: '/huangshan/build',
    baseUrl,
    body: { files },
    initialStatus: 'Connecting Huangshan build service...',
    onStatus,
    onLog,
  })
  return result.evidence
}

export async function flashHuangshanWorkspace({ port, onStatus, onLog, baseUrl } = {}) {
  const result = await runHuangshanStream({
    url: '/huangshan/flash',
    baseUrl,
    body: { port },
    initialStatus: 'Connecting Huangshan flash service...',
    onStatus,
    onLog,
  })
  return result.evidence
}
