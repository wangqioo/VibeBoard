export async function checkNordicCompilerHealth() {
  const response = await fetch('/nordic/health')
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `Nordic compiler health failed: HTTP ${response.status}`)
  }
  return payload
}

export async function compileNordicProject({ files, boardTarget }) {
  const response = await fetch('/nordic/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, boardTarget }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || payload.log || `Nordic build failed: HTTP ${response.status}`)
    error.result = payload
    throw error
  }
  return payload
}
