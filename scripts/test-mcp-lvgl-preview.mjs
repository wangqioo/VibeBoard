import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  writePreviewArtifact,
} from '../backend/mcp-server/tools/artifacts.mjs'
import { listCapabilities } from '../backend/mcp-server/tools/capabilities.mjs'
import { renderLvglPreviewTool } from '../backend/mcp-server/tools/lvglPreview.mjs'
import {
  renderLvglPreviewWithService,
} from '../backend/mcp-server/tools/previewClient.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

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

const toolArtifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-preview-tool-artifacts-'))
const toolResult = await renderLvglPreviewTool({
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: ['lvgl', 'bad/value', 'wifi_6', '', 42],
  manifest: {
    preview: {
      viewport: { width: 480, height: 272 },
    },
  },
  viewport: { width: 100, height: 100 },
  interactions: [{ type: 'tap', x: 10, y: 20 }],
  artifactDir: toolArtifactDir,
  projectId: 'tool-project',
}, {
  previewUrl: 'http://compiler.local',
  fetchImpl: async (url, request) => {
    assert.equal(url, 'http://compiler.local/preview/lvgl')
    const payload = JSON.parse(request.body)
    assert.equal(payload.boardId, 'szpi_esp32s3')
    assert.deepEqual(payload.selectedSkills, ['lvgl', 'wifi_6'])
    assert.equal(payload.projectFiles['main/main.c'], 'void app_main(void) {}')
    assert.deepEqual(payload.viewport, { width: 480, height: 272 })
    assert.deepEqual(payload.interactions, [{ type: 'tap', x: 10, y: 20 }])
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: 'success',
          screenshotPng: tinyPng,
          renderer: 'intent-lvgl-preview',
          viewport: payload.viewport,
          diagnostics: [],
          peripherals: [{ id: 'display', state: 'active' }],
          summary: 'tool rendered',
        }
      },
    }
  },
})
assert.equal(toolResult.status, 'success')
assert.match(toolResult.artifact.path, /lvgl-preview\.png$/)
assert.deepEqual(await readFile(toolResult.artifact.path), Buffer.from('preview-png'))
assert.equal(toolResult.previewEvidence.status, 'success')
assert.deepEqual(toolResult.viewport, { width: 480, height: 272 })
assert.equal(toolResult.summary, 'tool rendered')

const unsupported = await renderLvglPreviewTool({
  workspacePath: workspace,
  boardId: 'other_board',
}, {
  fetchImpl: async () => {
    throw new Error('unsupported board should not call preview service')
  },
})
assert.equal(unsupported.status, 'failure')
assert.equal(unsupported.category, 'unsupported-board')
assert.equal(unsupported.artifact, null)

const dispatched = await dispatchTool('vibeboard.render_lvgl_preview', {
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  artifactDir: toolArtifactDir,
}, {
  previewUrl: 'http://compiler.local',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        status: 'success',
        screenshotPng: tinyPng,
        renderer: 'intent-lvgl-preview',
        viewport: { width: 320, height: 240 },
        summary: 'dispatched',
      }
    },
  }),
})
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'success')
assert.equal(dispatched.result.summary, 'dispatched')

const previewCapability = listCapabilities().tools.find(tool => (
  tool.name === 'vibeboard.render_lvgl_preview'
))
assert.equal(previewCapability.status, 'available')

console.log('MCP LVGL preview tests passed.')
