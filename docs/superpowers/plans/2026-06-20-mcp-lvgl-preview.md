# MCP LVGL Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vibeboard.render_lvgl_preview` available so local agents can request a preview render for a workspace and receive structured preview evidence plus a saved screenshot artifact when available.

**Architecture:** Reuse the existing compiler-service `/preview/lvgl` contract from Node MCP. The tool reads workspace source files, sends a JSON preview request with board/skills/manifest/viewport/interactions, normalizes success/failure/unavailable responses, and writes `screenshotPng` to the MCP artifact directory as `lvgl-preview.png`.

**Tech Stack:** Node ESM, existing MCP server skeleton, existing workspace file reader, compiler-service preview HTTP contract, filesystem artifacts, fake fetch tests.

---

## File Structure

- Create: `backend/mcp-server/tools/previewClient.mjs`
  - Calls `/preview/lvgl` using injectable fetch.
  - Normalizes success, HTTP failure, and fetch failure.
- Create: `backend/mcp-server/tools/lvglPreview.mjs`
  - Implements `renderLvglPreviewTool`.
  - Reads workspace files and writes screenshot artifact.
- Modify: `backend/mcp-server/tools/artifacts.mjs`
  - Add `writePreviewArtifact`.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Mark `vibeboard.render_lvgl_preview` as `available`.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatch `vibeboard.render_lvgl_preview`.
- Create: `scripts/test-mcp-lvgl-preview.mjs`
  - Tests success, HTTP failure, service unavailable, and dispatch.
- Modify: `scripts/test-mcp-server-capabilities.mjs`
  - Expects `render_lvgl_preview` to be available.
- Modify: `package.json`
  - Add `test:mcp-lvgl-preview`.

---

## Task 1: Preview Client And Artifact Writer

**Files:**
- Create: `backend/mcp-server/tools/previewClient.mjs`
- Modify: `backend/mcp-server/tools/artifacts.mjs`
- Create: `scripts/test-mcp-lvgl-preview.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing client tests**

Create `scripts/test-mcp-lvgl-preview.mjs`:

```js
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  renderLvglPreviewWithService,
} from '../backend/mcp-server/tools/previewClient.mjs'
import {
  writePreviewArtifact,
} from '../backend/mcp-server/tools/artifacts.mjs'

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

const unavailable = await renderLvglPreviewWithService({
  previewUrl: 'http://compiler.local',
  request: { boardId: 'szpi_esp32s3', projectFiles: {} },
  fetchImpl: async () => {
    throw new Error('ECONNREFUSED')
  },
})
assert.equal(unavailable.status, 'unavailable')
assert.equal(unavailable.category, 'preview-service-unavailable')

console.log('MCP LVGL preview tests passed.')
```

Expected before implementation: import fails for `previewClient.mjs` or `writePreviewArtifact`.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-lvgl-preview.mjs
```

Expected: fails because preview client/artifact support is missing.

- [ ] **Step 3: Implement preview client**

Create `backend/mcp-server/tools/previewClient.mjs`:

```js
function normalizePreviewUrl(previewUrl) {
  return String(previewUrl || 'http://localhost:8760').replace(/\/+$/, '')
}

function previewEvidence(data, status) {
  return {
    status,
    category: data.category || null,
    summary: data.summary || '',
    diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
    renderer: data.renderer || null,
    viewport: data.viewport || null,
    peripherals: Array.isArray(data.peripherals) ? data.peripherals : [],
  }
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
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        status: data.status || 'failure',
        category: data.category || `http-${res.status}`,
        summary: data.summary || data.error || `Preview failed: HTTP ${res.status}`,
        diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
        peripherals: Array.isArray(data.peripherals) ? data.peripherals : [],
        evidence: previewEvidence(data, data.status || 'failure'),
      }
    }
    return {
      status: data.status || 'success',
      category: data.category || null,
      screenshotPng: data.screenshotPng || null,
      renderer: data.renderer || null,
      viewport: data.viewport || null,
      diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
      peripherals: Array.isArray(data.peripherals) ? data.peripherals : [],
      summary: data.summary || '',
      interactions: Array.isArray(data.interactions) ? data.interactions : [],
      evidence: previewEvidence(data, data.status || 'success'),
    }
  } catch (error) {
    return {
      status: 'unavailable',
      category: 'preview-service-unavailable',
      summary: error instanceof Error ? error.message : String(error),
      diagnostics: [{ message: error instanceof Error ? error.message : String(error) }],
      peripherals: [],
      evidence: {
        status: 'unavailable',
        category: 'preview-service-unavailable',
        summary: error instanceof Error ? error.message : String(error),
        diagnostics: [{ message: error instanceof Error ? error.message : String(error) }],
        renderer: null,
        viewport: null,
        peripherals: [],
      },
    }
  }
}
```

- [ ] **Step 4: Implement preview artifact writer**

In `backend/mcp-server/tools/artifacts.mjs`, add:

```js
export async function writePreviewArtifact({
  artifactDir,
  projectId = 'project',
  screenshotPng,
  renderer = null,
  viewport = null,
} = {}) {
  if (!screenshotPng) return null
  const projectDir = projectArtifactDir(artifactDir, projectId)
  await mkdir(projectDir, { recursive: true })
  const path = join(projectDir, 'lvgl-preview.png')
  const bytes = Buffer.from(screenshotPng, 'base64')
  await writeFile(path, bytes)
  return {
    path,
    size: bytes.length,
    renderer,
    viewport,
  }
}
```

- [ ] **Step 5: Add npm script and run test**

In root `package.json`, add:

```json
"test:mcp-lvgl-preview": "node scripts/test-mcp-lvgl-preview.mjs"
```

Run:

```bash
npm run test:mcp-lvgl-preview
```

Expected: exits 0 with `MCP LVGL preview tests passed.`

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json backend/mcp-server/tools/previewClient.mjs backend/mcp-server/tools/artifacts.mjs scripts/test-mcp-lvgl-preview.mjs
git commit -m "feat: add MCP LVGL preview client"
```

Expected: commit succeeds.

---

## Task 2: Render LVGL Preview Tool

**Files:**
- Create: `backend/mcp-server/tools/lvglPreview.mjs`
- Modify: `backend/mcp-server/tools/capabilities.mjs`
- Modify: `backend/mcp-server/server.mjs`
- Modify: `scripts/test-mcp-lvgl-preview.mjs`
- Modify: `scripts/test-mcp-server-capabilities.mjs`

- [ ] **Step 1: Write failing tool tests**

At the top of `scripts/test-mcp-lvgl-preview.mjs`, import:

```js
import {
  renderLvglPreviewTool,
} from '../backend/mcp-server/tools/lvglPreview.mjs'
import {
  dispatchTool,
} from '../backend/mcp-server/server.mjs'
import {
  listCapabilities,
} from '../backend/mcp-server/tools/capabilities.mjs'
```

After the client/artifact assertions, add:

```js
const workspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-preview-workspace-'))
await mkdir(join(workspace, 'main'), { recursive: true })
await writeFile(join(workspace, 'main', 'main.c'), 'void app_main(void) {}')
await writeFile(join(workspace, 'main', 'app_ui.c'), 'void app_ui_create(void *root) {}')

const toolResult = await renderLvglPreviewTool({
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: ['lvgl'],
  projectId: 'preview-project',
  previewUrl: 'http://compiler.local',
  artifactDir,
}, {
  fetchImpl: successFetch,
})
assert.equal(toolResult.status, 'success')
assert.equal(toolResult.artifact.renderer, 'intent-lvgl-preview')
assert.match(toolResult.artifact.path, /lvgl-preview\.png$/)
assert.equal(toolResult.previewEvidence.status, 'success')

const dispatchResult = await dispatchTool('vibeboard.render_lvgl_preview', {
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: ['lvgl'],
  projectId: 'preview-project-dispatch',
  previewUrl: 'http://compiler.local',
  artifactDir,
}, {
  fetchImpl: successFetch,
})
assert.equal(dispatchResult.status, 'success')
assert.equal(dispatchResult.result.status, 'success')

const capability = listCapabilities().tools.find(tool => tool.name === 'vibeboard.render_lvgl_preview')
assert.equal(capability.status, 'available')
```

Move all static imports to the top of the file if needed.

Expected before implementation: import or dispatch fails.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-lvgl-preview.mjs
```

Expected: fails because `lvglPreview.mjs` or dispatch support is missing.

- [ ] **Step 3: Implement preview tool**

Create `backend/mcp-server/tools/lvglPreview.mjs`:

```js
import { resolve } from 'node:path'

import { writePreviewArtifact } from './artifacts.mjs'
import { renderLvglPreviewWithService } from './previewClient.mjs'
import { requireObject } from './validate.mjs'
import { readWorkspaceProjectFiles } from './workspaceFiles.mjs'

const DEFAULT_VIEWPORT = { width: 320, height: 240 }
const SUPPORTED_BOARD_IDS = new Set(['szpi_esp32s3'])

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

function normalizeSelectedSkills(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => /^[A-Za-z0-9_-]{1,64}$/.test(item))
}

function normalizeViewport(value) {
  const width = Number(value?.width || DEFAULT_VIEWPORT.width)
  const height = Number(value?.height || DEFAULT_VIEWPORT.height)
  return {
    width: Number.isFinite(width) ? width : DEFAULT_VIEWPORT.width,
    height: Number.isFinite(height) ? height : DEFAULT_VIEWPORT.height,
  }
}

export async function renderLvglPreviewTool(input = {}, adapters = {}) {
  const params = requireObject(input)
  if (!params.workspacePath) throw new Error('workspacePath is required')
  if (!params.boardId) throw new Error('boardId is required')
  if (!SUPPORTED_BOARD_IDS.has(params.boardId)) {
    return {
      status: 'failure',
      category: 'unsupported-board',
      artifact: null,
      previewEvidence: {
        status: 'failure',
        category: 'unsupported-board',
        summary: `unsupported boardId: ${params.boardId}`,
        diagnostics: [{ message: `unsupported boardId: ${params.boardId}` }],
      },
    }
  }

  const projectId = params.projectId || params.boardId
  const artifactDir = adapters.artifactDir || params.artifactDir || defaultArtifactDir()
  const projectFiles = await readWorkspaceProjectFiles({ workspacePath: params.workspacePath })
  const selectedSkills = normalizeSelectedSkills(params.selectedSkills)
  const manifest = params.manifest || null
  const viewport = manifest?.preview?.viewport || normalizeViewport(params.viewport)
  const interactions = Array.isArray(params.interactions) ? params.interactions : []

  const preview = await renderLvglPreviewWithService({
    previewUrl: adapters.previewUrl || params.previewUrl,
    request: {
      boardId: params.boardId,
      selectedSkills,
      projectFiles,
      manifest,
      viewport,
      interactions,
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
    category: preview.category,
    artifact,
    previewEvidence: preview.evidence,
    diagnostics: preview.diagnostics || [],
    peripherals: preview.peripherals || [],
    renderer: preview.renderer || null,
    viewport: preview.viewport || viewport,
    summary: preview.summary || '',
  }
}
```

- [ ] **Step 4: Wire server and capabilities**

In `backend/mcp-server/server.mjs`, import `renderLvglPreviewTool` and add:

```js
'vibeboard.render_lvgl_preview': renderLvglPreviewTool,
```

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.render_lvgl_preview` from `planned` to `available`.

In `scripts/test-mcp-server-capabilities.mjs`, update expected status for `vibeboard.render_lvgl_preview` to `available`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:mcp-lvgl-preview
npm run test:mcp-server-capabilities
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/mcp-server/tools/lvglPreview.mjs backend/mcp-server/tools/capabilities.mjs backend/mcp-server/server.mjs scripts/test-mcp-lvgl-preview.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose MCP LVGL preview tool"
```

Expected: commit succeeds.

---

## Task 3: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run MCP preview tests**

Run:

```bash
npm run test:mcp-lvgl-preview
```

Expected: exits 0.

- [ ] **Step 2: Run MCP compile and capability tests**

Run:

```bash
npm run test:mcp-compile-project
npm run test:mcp-server-capabilities
```

Expected: both exit 0.

- [ ] **Step 3: Run existing guard tests**

Run:

```bash
npm run test:preview-fidelity-state
npm run test:lvgl-sim-service
npm run test:no-legacy-web-agent-docs
```

Expected: all exit 0.

- [ ] **Step 4: Run frontend build**

Run:

```bash
npm run build
```

Expected: exits 0. Existing large chunk warning is acceptable.

- [ ] **Step 5: Smoke capabilities**

Run:

```bash
printf '{"id":1,"method":"vibeboard.list_capabilities","params":{}}\n' | npm run mcp:server
```

Expected: output shows `vibeboard.render_lvgl_preview` as `available`.

- [ ] **Step 6: Check working tree**

Run:

```bash
git status --short
```

Expected: only known unrelated untracked files remain, especially `docs/architecture-review.html`.
