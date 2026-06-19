import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  writePreviewArtifact,
} from '../backend/mcp-server/tools/artifacts.mjs'
import {
  renderLvglPreviewWithService,
} from '../backend/mcp-server/tools/previewClient.mjs'

const tinyPng = Buffer.from('preview-png').toString('base64')

const successFetch = async (url, request) => {
  assert.equal(url, 'http://compiler.local/preview/lvgl')
  assert.equal(request.method, 'POST')
  const payload = JSON.parse(request.body)
  assert.equal(payload.boardId, 'szpi_esp32s3')
  assert.equal(payload.projectFiles['main/main.c'], 'void app_main(void) {}')
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        status: 'success',
        screenshotPng: tinyPng,
        renderer: 'intent-lvgl-preview',
        viewport: { width: 320, height: 240 },
        diagnostics: [{ message: 'ok' }],
        peripherals: [{ id: 'display', state: 'active' }],
        summary: 'rendered',
      }
    },
  }
}

const preview = await renderLvglPreviewWithService({
  previewUrl: 'http://compiler.local',
  request: {
    boardId: 'szpi_esp32s3',
    selectedSkills: ['lvgl'],
    projectFiles: { 'main/main.c': 'void app_main(void) {}' },
    viewport: { width: 320, height: 240 },
  },
  fetchImpl: successFetch,
})
assert.equal(preview.status, 'success')
assert.equal(preview.renderer, 'intent-lvgl-preview')
assert.equal(preview.screenshotPng, tinyPng)
assert.equal(preview.evidence.status, 'success')

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-preview-artifacts-'))
const artifact = await writePreviewArtifact({
  artifactDir,
  projectId: 'preview-project',
  screenshotPng: tinyPng,
  renderer: preview.renderer,
  viewport: preview.viewport,
})
assert.match(artifact.path, /lvgl-preview\.png$/)
assert.deepEqual(await readFile(artifact.path), Buffer.from('preview-png'))
assert.equal(artifact.renderer, 'intent-lvgl-preview')

const noArtifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-preview-empty-'))
assert.equal(
  await writePreviewArtifact({
    artifactDir: noArtifactDir,
    projectId: 'preview-project',
    screenshotPng: null,
  }),
  null,
)

const httpFailure = await renderLvglPreviewWithService({
  previewUrl: 'http://compiler.local/',
  request: { boardId: 'szpi_esp32s3', projectFiles: {} },
  fetchImpl: async () => ({
    ok: false,
    status: 400,
    async json() {
      return {
        status: 'failure',
        category: 'preview-contract-missing',
        summary: 'missing app_ui',
        diagnostics: [{ message: 'missing app_ui_create' }],
      }
    },
  }),
})
assert.equal(httpFailure.status, 'failure')
assert.equal(httpFailure.category, 'preview-contract-missing')
assert.equal(httpFailure.evidence.status, 'failure')

const httpFailureWithoutBody = await renderLvglPreviewWithService({
  previewUrl: 'http://compiler.local',
  request: { boardId: 'szpi_esp32s3', projectFiles: {} },
  fetchImpl: async () => ({
    ok: false,
    status: 503,
    async json() {
      throw new Error('invalid json')
    },
  }),
})
assert.equal(httpFailureWithoutBody.status, 'failure')
assert.equal(httpFailureWithoutBody.category, 'http-503')
assert.equal(httpFailureWithoutBody.evidence.category, 'http-503')

const unavailable = await renderLvglPreviewWithService({
  previewUrl: 'http://compiler.local',
  request: { boardId: 'szpi_esp32s3', projectFiles: {} },
  fetchImpl: async () => {
    throw new Error('ECONNREFUSED')
  },
})
assert.equal(unavailable.status, 'unavailable')
assert.equal(unavailable.category, 'preview-service-unavailable')
assert.equal(unavailable.evidence.status, 'unavailable')

const workspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-preview-unused-workspace-'))
await mkdir(join(workspace, 'main'), { recursive: true })
await writeFile(join(workspace, 'main', 'main.c'), 'void app_main(void) {}')

console.log('MCP LVGL preview tests passed.')
