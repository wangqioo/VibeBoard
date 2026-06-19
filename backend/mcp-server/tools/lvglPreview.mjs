import { resolve } from 'node:path'

import { writePreviewArtifact } from './artifacts.mjs'
import { renderLvglPreviewWithService } from './previewClient.mjs'
import { requireObject } from './validate.mjs'
import { readWorkspaceProjectFiles } from './workspaceFiles.mjs'

const SUPPORTED_BOARD_IDS = new Set(['szpi_esp32s3'])
const SAFE_SKILL_ID = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_VIEWPORT = { width: 320, height: 240 }

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

function normalizeSelectedSkills(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => SAFE_SKILL_ID.test(item))
}

function normalizePositiveInteger(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  return Math.round(number)
}

function normalizeViewport(value) {
  const viewport = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    width: normalizePositiveInteger(viewport.width) || DEFAULT_VIEWPORT.width,
    height: normalizePositiveInteger(viewport.height) || DEFAULT_VIEWPORT.height,
  }
}

function manifestViewport(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null
  const preview = manifest.preview
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) return null
  return preview.viewport || null
}

function failureResult({ category, summary, diagnostics = [], viewport = DEFAULT_VIEWPORT }) {
  return {
    status: 'failure',
    category,
    artifact: null,
    previewEvidence: {
      status: 'failure',
      category,
      summary,
      diagnostics,
      renderer: null,
      viewport,
      peripherals: [],
    },
    diagnostics,
    peripherals: [],
    renderer: null,
    viewport,
    summary,
  }
}

export async function renderLvglPreviewTool(input = {}, adapters = {}) {
  const params = requireObject(input)
  if (!params.workspacePath) throw new Error('workspacePath is required')
  if (!params.boardId) throw new Error('boardId is required')

  const manifest = params.manifest === undefined ? {} : requireObject(params.manifest, 'manifest')
  const selectedSkills = normalizeSelectedSkills(params.selectedSkills)
  const viewport = normalizeViewport(manifestViewport(manifest) || params.viewport)
  const projectId = params.projectId || params.boardId
  const artifactDir = adapters.artifactDir || params.artifactDir || defaultArtifactDir()

  if (!SUPPORTED_BOARD_IDS.has(params.boardId)) {
    const summary = `unsupported boardId: ${params.boardId}`
    return failureResult({
      category: 'unsupported-board',
      summary,
      diagnostics: [{
        category: 'unsupported-board',
        message: summary,
      }],
      viewport,
    })
  }

  const projectFiles = await readWorkspaceProjectFiles({ workspacePath: params.workspacePath })
  const preview = await renderLvglPreviewWithService({
    previewUrl: adapters.previewUrl || params.previewUrl,
    request: {
      boardId: params.boardId,
      selectedSkills,
      projectFiles,
      manifest,
      viewport,
      interactions: Array.isArray(params.interactions) ? params.interactions : [],
    },
    fetchImpl: adapters.fetchImpl,
  })

  const artifact = preview.screenshotPng
    ? await writePreviewArtifact({
      artifactDir,
      projectId,
      screenshotPng: preview.screenshotPng,
      renderer: preview.renderer,
      viewport: preview.viewport || viewport,
    })
    : null

  return {
    status: preview.status,
    category: preview.category || null,
    artifact,
    previewEvidence: preview.evidence,
    diagnostics: preview.diagnostics || [],
    peripherals: preview.peripherals || [],
    renderer: preview.renderer || null,
    viewport: preview.viewport || viewport,
    summary: preview.summary || '',
  }
}
