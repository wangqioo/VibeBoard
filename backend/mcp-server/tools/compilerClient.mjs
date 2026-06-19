function normalizeCompilerUrl(compilerUrl) {
  return String(compilerUrl || 'http://localhost:8760').replace(/\/+$/, '')
}

function parseSseLine(line) {
  if (!line.startsWith('data: ')) return null
  return JSON.parse(line.slice(6))
}

function logExcerpt(logs, count) {
  return logs.slice(-count).join('\n')
}

function successEvidence({ msg, logs, elapsedMs }) {
  return {
    status: 'success',
    command: msg.command || '',
    buildId: msg.buildId || '',
    firmware: msg.filename || 'firmware.bin',
    size: msg.size || 0,
    logExcerpt: logExcerpt(logs, 40),
    elapsedMs,
  }
}

function failureEvidence({ error, logs, elapsedMs }) {
  return {
    status: 'failure',
    error,
    logExcerpt: logExcerpt(logs, 80),
    elapsedMs,
  }
}

async function readHttpError(res) {
  const body = await res.json().catch(() => ({}))
  return body.error || `compiler service HTTP ${res.status}`
}

export async function compileProjectWithService({
  compilerUrl = 'http://localhost:8760',
  payload,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required')

  const startedAt = Date.now()
  const logs = []
  const elapsedMs = () => Date.now() - startedAt
  const toFailure = (error) => ({
    status: 'failure',
    logs,
    buildEvidence: failureEvidence({ error, logs, elapsedMs: elapsedMs() }),
  })

  const res = await fetchImpl(`${normalizeCompilerUrl(compilerUrl)}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })

  if (!res.ok) return toFailure(await readHttpError(res))

  const reader = res.body?.getReader?.()
  if (!reader) return toFailure('compiler response body is not readable')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue

        const msg = parseSseLine(line)
        if (!msg) continue

        if (msg.log !== undefined) logs.push(String(msg.log))
        if (!msg.done) continue

        if (msg.error) return toFailure(String(msg.error))

        return {
          status: 'success',
          logs,
          firmware: {
            base64: msg.bin,
            filename: msg.filename || 'firmware.bin',
            size: msg.size || 0,
          },
          flashFiles: Array.isArray(msg.flashFiles) ? msg.flashFiles : [],
          buildEvidence: successEvidence({
            msg,
            logs,
            elapsedMs: elapsedMs(),
          }),
        }
      }
    }
  } catch (error) {
    return toFailure(error instanceof Error ? error.message : String(error))
  }

  return toFailure('compiler stream ended before done event')
}
