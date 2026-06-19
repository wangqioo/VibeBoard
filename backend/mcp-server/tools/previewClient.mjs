function normalizePreviewUrl(previewUrl) {
  return String(previewUrl || 'http://localhost:8760').replace(/\/+$/, '')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function previewEvidence(data, status, category = data.category || null) {
  return {
    status,
    category,
    summary: data.summary || '',
    diagnostics: asArray(data.diagnostics),
    renderer: data.renderer || null,
    viewport: data.viewport || null,
    peripherals: asArray(data.peripherals),
  }
}

async function readPreviewJson(res) {
  return await res.json().catch(() => ({}))
}

export async function renderLvglPreviewWithService({
  previewUrl = 'http://localhost:8760',
  request,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required')

  try {
    const res = await fetchImpl(`${normalizePreviewUrl(previewUrl)}/preview/lvgl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request || {}),
    })
    const data = await readPreviewJson(res)

    if (!res.ok) {
      const status = data.status || 'failure'
      const category = data.category || `http-${res.status}`
      const summary = data.summary || data.error || `Preview failed: HTTP ${res.status}`
      return {
        status,
        category,
        summary,
        diagnostics: asArray(data.diagnostics),
        peripherals: asArray(data.peripherals),
        evidence: previewEvidence({ ...data, summary }, status, category),
      }
    }

    const status = data.status || 'success'
    const category = data.category || null
    return {
      status,
      category,
      screenshotPng: data.screenshotPng || null,
      renderer: data.renderer || null,
      viewport: data.viewport || null,
      diagnostics: asArray(data.diagnostics),
      peripherals: asArray(data.peripherals),
      summary: data.summary || '',
      interactions: asArray(data.interactions),
      evidence: previewEvidence(data, status, category),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const diagnostic = { message }
    return {
      status: 'unavailable',
      category: 'preview-service-unavailable',
      summary: message,
      diagnostics: [diagnostic],
      peripherals: [],
      evidence: {
        status: 'unavailable',
        category: 'preview-service-unavailable',
        summary: message,
        diagnostics: [diagnostic],
        renderer: null,
        viewport: null,
        peripherals: [],
      },
    }
  }
}
