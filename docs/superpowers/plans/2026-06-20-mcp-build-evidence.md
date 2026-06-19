# MCP Build Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vibeboard.get_build_evidence` available by persisting the latest Build Evidence from `vibeboard.compile_project` and returning it by `projectId`.

**Architecture:** Store compile metadata as JSON beside MCP artifacts under the existing artifact directory. `compile_project` writes build evidence for both success and failure outcomes. `get_build_evidence` reads that metadata through the MCP server and returns a JSON-safe result without requiring the compiler service to be running.

**Tech Stack:** Node ESM, existing MCP server skeleton, filesystem JSON metadata, fake compiler tests.

---

## File Structure

- Modify: `backend/mcp-server/tools/artifacts.mjs`
  - Export shared safe-name and project-directory helpers.
  - Add `writeBuildEvidenceRecord` and `readBuildEvidenceRecord`.
- Modify: `backend/mcp-server/tools/compileProject.mjs`
  - Persist Build Evidence after compile success, compile failure, and local package failure.
- Create: `backend/mcp-server/tools/buildEvidence.mjs`
  - Implements `getBuildEvidenceTool`.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Mark `vibeboard.get_build_evidence` as `available`.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatch `vibeboard.get_build_evidence`.
- Modify: `scripts/test-mcp-compile-project.mjs`
  - Cover evidence persistence and retrieval.
- Modify: `scripts/test-mcp-server-capabilities.mjs`
  - Expect `get_build_evidence` to be available.

---

## Task 1: Persist Build Evidence Records

**Files:**
- Modify: `backend/mcp-server/tools/artifacts.mjs`
- Modify: `backend/mcp-server/tools/compileProject.mjs`
- Modify: `scripts/test-mcp-compile-project.mjs`

- [ ] **Step 1: Write failing persistence test**

In `scripts/test-mcp-compile-project.mjs`, import the new artifact helpers at the top:

```js
import {
  readBuildEvidenceRecord,
} from '../backend/mcp-server/tools/artifacts.mjs'
```

After the existing successful `compileProjectTool` assertion block, add:

```js
const persistedSuccessEvidence = await readBuildEvidenceRecord({
  artifactDir,
  projectId: 'project-1',
})
assert.equal(persistedSuccessEvidence.status, 'success')
assert.equal(persistedSuccessEvidence.projectId, 'project-1')
assert.equal(persistedSuccessEvidence.buildEvidence.status, 'success')
assert.equal(persistedSuccessEvidence.artifact.firmware.size, 8)
assert.equal(persistedSuccessEvidence.compilePackage.mainFile, 'main.c')
```

Add a failure case after the success case:

```js
const failureWorkspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-failure-'))
await mkdir(join(failureWorkspace, 'main'), { recursive: true })
await writeFile(join(failureWorkspace, 'main', 'main.c'), 'void app_main(void) {}')

const failedToolResult = await compileProjectTool({
  workspacePath: failureWorkspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: [],
  projectId: 'project-failure',
  compilerUrl: 'http://compiler.local',
  artifactDir,
}, {
  fetchImpl: async () => sseResponse([
    'data: {"log":"compile failed"}\n\n',
    'data: {"done":true,"error":"bad source"}\n\n',
  ]),
})
assert.equal(failedToolResult.status, 'failure')

const persistedFailureEvidence = await readBuildEvidenceRecord({
  artifactDir,
  projectId: 'project-failure',
})
assert.equal(persistedFailureEvidence.status, 'failure')
assert.equal(persistedFailureEvidence.buildEvidence.error, 'bad source')
assert.equal(persistedFailureEvidence.artifact, null)
```

Expected before implementation: import fails or `readBuildEvidenceRecord` is not exported.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-compile-project.mjs
```

Expected: fails because evidence record helpers are missing.

- [ ] **Step 3: Extend artifact helpers**

In `backend/mcp-server/tools/artifacts.mjs`, export `safeName` and add:

```js
import { readFile } from 'node:fs/promises'

export function safeName(name, fallback) {
  return String(name || fallback).replace(/[^A-Za-z0-9_.-]/g, '_')
}

export function projectArtifactDir(artifactDir, projectId = 'project') {
  if (!artifactDir) throw new Error('artifactDir is required')
  return join(artifactDir, safeName(projectId, 'project'))
}

export async function writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status,
  buildEvidence,
  artifact = null,
  diagnostics = [],
  logs = [],
  compilePackage = null,
} = {}) {
  const projectDir = projectArtifactDir(artifactDir, projectId)
  await mkdir(projectDir, { recursive: true })
  const record = {
    schemaVersion: 1,
    projectId: projectId || 'project',
    status,
    buildEvidence,
    artifact,
    diagnostics,
    logs,
    compilePackage,
    updatedAt: new Date().toISOString(),
  }
  const path = join(projectDir, 'build-evidence.json')
  await writeFile(path, JSON.stringify(record, null, 2))
  return { ...record, path }
}

export async function readBuildEvidenceRecord({ artifactDir, projectId } = {}) {
  if (!projectId) throw new Error('projectId is required')
  const path = join(projectArtifactDir(artifactDir, projectId), 'build-evidence.json')
  const raw = await readFile(path, 'utf8')
  return { ...JSON.parse(raw), path }
}
```

Update `writeCompileArtifacts` to use `projectArtifactDir(artifactDir, projectId)`.

- [ ] **Step 4: Persist from compileProjectTool**

In `backend/mcp-server/tools/compileProject.mjs`, import `writeBuildEvidenceRecord`.

Create `artifactDir` once after `projectId`:

```js
const artifactDir = adapters.artifactDir || params.artifactDir || defaultArtifactDir()
```

For each return object in `compileProjectTool`, assign it to `result`, call:

```js
await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: result.status,
  buildEvidence: result.buildEvidence,
  artifact: result.artifact,
  diagnostics: result.diagnostics,
  logs: result.logs,
  compilePackage: result.compilePackage,
})
```

then return `result`.

For local invalid package returns before `projectId` currently exists, set:

```js
const projectId = params.projectId || params.boardId || 'project'
const artifactDir = adapters.artifactDir || params.artifactDir || defaultArtifactDir()
```

before the unsupported-board and missing-main returns.

- [ ] **Step 5: Run test**

Run:

```bash
npm run test:mcp-compile-project
```

Expected: exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/mcp-server/tools/artifacts.mjs backend/mcp-server/tools/compileProject.mjs scripts/test-mcp-compile-project.mjs
git commit -m "feat: persist MCP build evidence"
```

Expected: commit succeeds.

---

## Task 2: Expose get_build_evidence Tool

**Files:**
- Create: `backend/mcp-server/tools/buildEvidence.mjs`
- Modify: `backend/mcp-server/server.mjs`
- Modify: `backend/mcp-server/tools/capabilities.mjs`
- Modify: `scripts/test-mcp-compile-project.mjs`
- Modify: `scripts/test-mcp-server-capabilities.mjs`

- [ ] **Step 1: Write failing MCP tool tests**

At the top of `scripts/test-mcp-compile-project.mjs`, import:

```js
import {
  getBuildEvidenceTool,
} from '../backend/mcp-server/tools/buildEvidence.mjs'
```

After persisted evidence assertions, add:

```js
const queriedEvidence = await getBuildEvidenceTool({
  artifactDir,
  projectId: 'project-1',
})
assert.equal(queriedEvidence.status, 'success')
assert.equal(queriedEvidence.record.projectId, 'project-1')
assert.equal(queriedEvidence.record.buildEvidence.status, 'success')

const missingEvidence = await getBuildEvidenceTool({
  artifactDir,
  projectId: 'missing-project',
})
assert.equal(missingEvidence.status, 'not-found')
assert.equal(missingEvidence.record, null)

const dispatchEvidence = await dispatchTool('vibeboard.get_build_evidence', {
  artifactDir,
  projectId: 'project-1',
})
assert.equal(dispatchEvidence.status, 'success')
assert.equal(dispatchEvidence.result.status, 'success')
assert.equal(dispatchEvidence.result.record.projectId, 'project-1')
```

Expected before implementation: import or dispatch fails.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-compile-project.mjs
```

Expected: fails because `buildEvidence.mjs` or dispatch support is missing.

- [ ] **Step 3: Implement tool**

Create `backend/mcp-server/tools/buildEvidence.mjs`:

```js
import { resolve } from 'node:path'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

export async function getBuildEvidenceTool(input = {}) {
  const params = requireObject(input)
  if (!params.projectId) throw new Error('projectId is required')
  const artifactDir = params.artifactDir || defaultArtifactDir()
  try {
    const record = await readBuildEvidenceRecord({ artifactDir, projectId: params.projectId })
    return {
      status: 'success',
      record,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'not-found',
        record: null,
        message: `no build evidence found for projectId: ${params.projectId}`,
      }
    }
    throw error
  }
}
```

- [ ] **Step 4: Wire server and capabilities**

In `backend/mcp-server/server.mjs`, import `getBuildEvidenceTool` and add:

```js
'vibeboard.get_build_evidence': getBuildEvidenceTool,
```

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.get_build_evidence` status from `planned` to `available`.

In `scripts/test-mcp-server-capabilities.mjs`, update expected status for `vibeboard.get_build_evidence` to `available`.

- [ ] **Step 5: Run tests**

Run:

```bash
npm run test:mcp-compile-project
npm run test:mcp-server-capabilities
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/mcp-server/tools/buildEvidence.mjs backend/mcp-server/server.mjs backend/mcp-server/tools/capabilities.mjs scripts/test-mcp-compile-project.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose MCP build evidence lookup"
```

Expected: commit succeeds.

---

## Task 3: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run MCP compile tests**

Run:

```bash
npm run test:mcp-compile-project
```

Expected: exits 0.

- [ ] **Step 2: Run MCP capability tests**

Run:

```bash
npm run test:mcp-server-capabilities
```

Expected: exits 0.

- [ ] **Step 3: Run existing guard tests**

Run:

```bash
npm run test:compile-package
npm run test:project-validation
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

Expected: output shows `vibeboard.get_build_evidence` as `available`.

- [ ] **Step 6: Check working tree**

Run:

```bash
git status --short
```

Expected: only known unrelated untracked files remain, especially `docs/architecture-review.html`.

