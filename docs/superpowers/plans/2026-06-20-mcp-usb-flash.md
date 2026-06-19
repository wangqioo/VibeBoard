# MCP USB Flash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `vibeboard.flash_usb` through the local MCP server without accidentally touching hardware by default.

**Architecture:** The MCP tool reads previously persisted build evidence and flash artifacts, validates that a usable firmware payload exists, then returns a structured blocked/dry-run result unless the caller explicitly confirms a real flash request. The first implementation uses an injectable Node-side flasher adapter so tests can verify request shaping without needing a physical ESP32.

**Tech Stack:** Node ESM, existing MCP stdio server, existing build evidence artifact records, TDD scripts under `scripts/`.

---

## File Structure

- Create: `backend/mcp-server/tools/usbFlash.mjs`
  - Owns input validation, build evidence lookup, flash file selection, dry-run behavior, and adapter invocation.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Marks `vibeboard.flash_usb` as `available` once the safe MCP tool exists.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatches `vibeboard.flash_usb`.
- Modify: `scripts/test-mcp-usb-flash.mjs`
  - Covers blocked, dry-run, missing artifact, and confirmed adapter behavior.
- Modify: `scripts/test-mcp-server-capabilities.mjs`
  - Asserts USB flash capability status.
- Modify: `package.json`
  - Adds `test:mcp-usb-flash`.

## Tool Contract

`vibeboard.flash_usb` input:

```json
{
  "artifactDir": "outputs/mcp",
  "projectId": "demo",
  "boardId": "szpi_esp32s3",
  "portPath": "/dev/cu.usbmodem1101",
  "baudRate": 460800,
  "confirm": false,
  "dryRun": true
}
```

Result categories:

- `dry-run`: Valid firmware was found and the tool reports the exact flash plan, but no hardware was touched.
- `blocked`: The request is missing build evidence, firmware artifacts, board support, port path, or explicit confirmation.
- `success`: The injected flasher adapter reports success.
- `failure`: The injected flasher adapter throws or reports failure.

The initial MCP implementation supports `szpi_esp32s3` only.

## Task 1: Add Safe USB Flash MCP Tool

**Files:**
- Create: `scripts/test-mcp-usb-flash.mjs`
- Create: `backend/mcp-server/tools/usbFlash.mjs`
- Modify: `package.json`
- Modify: `backend/mcp-server/server.mjs`
- Modify: `backend/mcp-server/tools/capabilities.mjs`
- Modify: `scripts/test-mcp-server-capabilities.mjs`

- [ ] **Step 1: Write failing test**

Create `scripts/test-mcp-usb-flash.mjs` with tests that:

```js
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashUsbTool } from '../backend/mcp-server/tools/usbFlash.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-usb-flash-'))
const projectId = 'usb-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
const bootloaderPath = join(projectDir, 'bootloader.bin')
const partitionPath = join(projectDir, 'partition-table.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4]))
await writeFile(bootloaderPath, Buffer.from([5, 6]))
await writeFile(partitionPath, Buffer.from([7, 8]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 4 },
    flashFiles: [
      { name: 'bootloader', offset: 0, path: bootloaderPath, size: 2 },
      { name: 'partition-table', offset: 0x8000, path: partitionPath, size: 2 },
      { name: 'app', offset: 0x10000, path: firmwarePath, size: 4 },
    ],
  },
})

const missingPort = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  confirm: true,
  dryRun: false,
})
assert.equal(missingPort.status, 'blocked')
assert.equal(missingPort.category, 'port-required')

const dryRun = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(dryRun.status, 'dry-run')
assert.deepEqual(dryRun.flashPlan.map(file => file.offset), [0, 0x8000, 0x10000])
assert.equal(dryRun.flashPlan[2].path, firmwarePath)

let adapterRequest = null
const confirmed = await flashUsbTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  portPath: '/dev/cu.usbmodem1101',
  confirm: true,
  dryRun: false,
}, {
  flasher: async request => {
    adapterRequest = request
    return { status: 'success', logs: ['flashed'], elapsedMs: 12 }
  },
})
assert.equal(confirmed.status, 'success')
assert.equal(adapterRequest.portPath, '/dev/cu.usbmodem1101')
assert.equal(adapterRequest.baudRate, 460800)
assert.equal(adapterRequest.flashFiles.length, 3)

const dispatched = await dispatchTool('vibeboard.flash_usb', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'dry-run')

const missingEvidence = await flashUsbTool({
  artifactDir,
  projectId: 'missing-project',
  boardId: 'szpi_esp32s3',
  dryRun: true,
})
assert.equal(missingEvidence.status, 'blocked')
assert.equal(missingEvidence.category, 'build-evidence-missing')

console.log('MCP USB flash tests passed.')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node scripts/test-mcp-usb-flash.mjs
```

Expected: fails because `backend/mcp-server/tools/usbFlash.mjs` does not exist.

- [ ] **Step 3: Implement USB flash tool**

Create `backend/mcp-server/tools/usbFlash.mjs`:

```js
import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])
const DEFAULT_BAUD_RATE = 460800

export async function flashUsbTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const dryRun = request.dryRun !== false
  const confirm = request.confirm === true
  const baudRate = Number.isFinite(Number(request.baudRate)) ? Number(request.baudRate) : DEFAULT_BAUD_RATE

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) {
    return blocked('unsupported-board', `USB flash is not available for board ${boardId || '(missing)'}`)
  }

  let evidence
  try {
    evidence = await readBuildEvidenceRecord({ artifactDir, projectId })
  } catch (error) {
    return blocked('build-evidence-missing', error.message)
  }

  if (evidence.status !== 'success') {
    return blocked('build-not-successful', 'Latest build evidence is not successful', { buildEvidence: evidence })
  }

  const flashPlan = await createFlashPlan(evidence.artifact)
  if (!flashPlan.length) {
    return blocked('flash-artifact-missing', 'Build evidence does not include firmware or flash files', { buildEvidence: evidence })
  }

  if (dryRun) {
    return {
      status: 'dry-run',
      category: 'ready',
      boardId,
      projectId,
      portPath: request.portPath || null,
      baudRate,
      flashPlan,
      message: 'USB flash plan is valid. Re-run with dryRun=false, confirm=true, and portPath to touch hardware.',
    }
  }

  if (!confirm) {
    return blocked('confirmation-required', 'Set confirm=true to allow USB flashing', { flashPlan })
  }
  if (!request.portPath) {
    return blocked('port-required', 'portPath is required for confirmed USB flashing', { flashPlan })
  }
  if (!adapters.flasher) {
    return blocked('flasher-unavailable', 'No Node USB flasher adapter is configured', { flashPlan })
  }

  try {
    const result = await adapters.flasher({
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashFiles: flashPlan,
    })
    return {
      status: result?.status || 'success',
      category: result?.category || 'flashed',
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashPlan,
      logs: result?.logs || [],
      elapsedMs: result?.elapsedMs ?? null,
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'flasher-error',
      boardId,
      projectId,
      portPath: request.portPath,
      baudRate,
      flashPlan,
      message: error.message,
    }
  }
}

function blocked(category, message, extra = {}) {
  return {
    status: 'blocked',
    category,
    message,
    ...extra,
  }
}

async function createFlashPlan(artifact = {}) {
  const files = Array.isArray(artifact?.flashFiles) && artifact.flashFiles.length
    ? artifact.flashFiles
    : artifact?.firmware
      ? [{ name: artifact.firmware.filename || 'app', offset: 0x10000, path: artifact.firmware.path, size: artifact.firmware.size }]
      : []

  const plan = []
  for (const file of files) {
    if (!file?.path) continue
    const offset = Number(file.offset)
    if (!Number.isFinite(offset)) continue
    try {
      await access(file.path)
    } catch {
      continue
    }
    plan.push({
      name: file.name || file.filename || `0x${offset.toString(16)}`,
      offset,
      path: file.path,
      size: file.size || null,
    })
  }

  return plan.sort((a, b) => a.offset - b.offset)
}
```

- [ ] **Step 4: Wire MCP dispatch and capability**

In `backend/mcp-server/server.mjs`, import and register:

```js
import { flashUsbTool } from './tools/usbFlash.mjs'
```

and:

```js
'vibeboard.flash_usb': flashUsbTool,
```

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.flash_usb` status from `planned` to `available`.

- [ ] **Step 5: Add npm test script**

In `package.json`, add:

```json
"test:mcp-usb-flash": "node scripts/test-mcp-usb-flash.mjs"
```

- [ ] **Step 6: Update capability test**

In `scripts/test-mcp-server-capabilities.mjs`, assert:

```js
assert.equal(byName.get('vibeboard.flash_usb')?.status, 'available')
```

- [ ] **Step 7: Run tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-usb-flash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

Run:

```bash
git add backend/mcp-server package.json scripts/test-mcp-usb-flash.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose safe MCP USB flash tool"
```

Expected: commit succeeds.

## Task 2: Add Final Verification

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run MCP and related tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-usb-flash
npm run test:mcp-compile-project
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
npm run test:no-legacy-web-agent-docs
npm run build
```

Expected: every command exits 0. Vite may still print the existing large chunk warning.

- [ ] **Step 2: Smoke capability over stdio**

Run:

```bash
printf '{"id":1,"method":"vibeboard.list_capabilities","params":{}}\n' | npm run mcp:server
```

Expected: JSON response includes:

```json
{"name":"vibeboard.flash_usb","status":"available"}
```

- [ ] **Step 3: Check worktree**

Run:

```bash
git status --short
```

Expected: no unrelated tracked modifications. Existing untracked `docs/architecture-review.html` may remain.

