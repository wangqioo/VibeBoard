# MCP BLE OTA and Device Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the initial MCP hardware-console tool surface by exposing `vibeboard.flash_ble_ota` and `vibeboard.collect_device_evidence`.

**Architecture:** `flash_ble_ota` is a safe MCP bridge contract: it validates build artifacts and returns a structured `bridge-required` state unless a future browser/native BLE bridge adapter is injected. `collect_device_evidence` is an immediately useful evidence tool: it normalizes caller-provided log lines, delivery results, and optional remote OTA job status into VibeBoard's existing device evidence and repair context shape.

**Tech Stack:** Node ESM, existing MCP stdio server, existing build evidence artifact records, existing `src/domain/evidence/deviceEvidence.js`, TDD scripts.

---

## File Structure

- Create: `backend/mcp-server/tools/bleOta.mjs`
  - Validates firmware artifacts for BLE OTA and returns blocked/bridge-required states or adapter results.
- Create: `backend/mcp-server/tools/deviceEvidence.mjs`
  - Collects evidence from input log lines, delivery result, and optional OTA job fetch.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatches `vibeboard.flash_ble_ota` and `vibeboard.collect_device_evidence`.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Marks both tools as `available`.
- Create: `scripts/test-mcp-ble-ota-device-evidence.mjs`
  - Verifies BLE bridge blocking, adapter invocation, evidence parsing, OTA job fetch, and dispatch integration.
- Modify: `scripts/test-mcp-server-capabilities.mjs`
  - Expects both remaining tools to be available.
- Modify: `package.json`
  - Adds `test:mcp-ble-ota-device-evidence`.

## Tool Contracts

### `vibeboard.flash_ble_ota`

Input:

```json
{
  "artifactDir": "outputs/mcp",
  "projectId": "demo",
  "boardId": "szpi_esp32s3",
  "deviceName": "ESP32-Vibe-OTA",
  "confirm": false
}
```

Returns:

- `blocked / bridge-required` when no adapter is injected.
- `blocked / confirmation-required` when adapter exists but `confirm !== true`.
- `success` or `failure` when an injected bridge adapter runs.

### `vibeboard.collect_device_evidence`

Input:

```json
{
  "source": "serial",
  "lines": ["I (31) boot: ESP-IDF v5.4.1 2nd stage bootloader"],
  "deliveryResult": { "transport": "wifi-ota", "status": "queued", "jobId": "job-1" },
  "manifest": { "programName": "demo" },
  "userSymptom": "screen stays blank",
  "otaServiceUrl": "http://127.0.0.1:8760",
  "otaJobId": "job-1"
}
```

Returns:

- `status: "observed"`
- `deviceEvidence`
- `repairContext`
- `otaJob` when `otaJobId` is provided and fetch succeeds

## Task 1: Add BLE OTA Bridge Tool

**Files:**
- Create: `scripts/test-mcp-ble-ota-device-evidence.mjs`
- Create: `backend/mcp-server/tools/bleOta.mjs`

- [ ] **Step 1: Write failing BLE tests**

Create `scripts/test-mcp-ble-ota-device-evidence.mjs` with BLE assertions:

```js
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashBleOtaTool } from '../backend/mcp-server/tools/bleOta.mjs'
import { collectDeviceEvidenceTool } from '../backend/mcp-server/tools/deviceEvidence.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return body
    },
  }
}

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-ble-evidence-'))
const projectId = 'ble-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4, 5]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 5 },
    flashFiles: [],
  },
})

const bridgeRequired = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
})
assert.equal(bridgeRequired.status, 'blocked')
assert.equal(bridgeRequired.category, 'bridge-required')
assert.equal(bridgeRequired.firmware.path, firmwarePath)

const confirmationRequired = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
}, {
  bleBridge: async () => ({ status: 'success' }),
})
assert.equal(confirmationRequired.status, 'blocked')
assert.equal(confirmationRequired.category, 'confirmation-required')

let bridgeRequest = null
const bridged = await flashBleOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceName: 'ESP32-Vibe-OTA',
  confirm: true,
}, {
  bleBridge: async request => {
    bridgeRequest = request
    return { status: 'success', progress: 100, logs: ['BLE OTA complete'] }
  },
})
assert.equal(bridged.status, 'success')
assert.equal(bridged.category, 'ble-ota-complete')
assert.equal(bridgeRequest.firmwarePath, firmwarePath)
assert.equal(bridgeRequest.deviceName, 'ESP32-Vibe-OTA')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs node scripts/test-mcp-ble-ota-device-evidence.mjs
```

Expected: fails because `backend/mcp-server/tools/bleOta.mjs` does not exist.

- [ ] **Step 3: Implement BLE OTA MCP tool**

Create `backend/mcp-server/tools/bleOta.mjs`:

```js
import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])

export async function flashBleOtaTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const deviceName = String(request.deviceName || 'ESP32-Vibe-OTA').trim()

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) return blocked('unsupported-board', `BLE OTA is not available for board ${boardId || '(missing)'}`)

  let evidence
  try {
    evidence = await readBuildEvidenceRecord({ artifactDir, projectId })
  } catch (error) {
    return blocked('build-evidence-missing', error.message)
  }
  if (evidence.status !== 'success') {
    return blocked('build-not-successful', 'Latest build evidence is not successful', { buildEvidence: evidence })
  }

  const firmware = evidence.artifact?.firmware
  if (!firmware?.path) {
    return blocked('firmware-artifact-missing', 'Build evidence does not include a firmware artifact', { buildEvidence: evidence })
  }
  try {
    await access(firmware.path)
  } catch (error) {
    return blocked('firmware-file-missing', error.message, { firmware })
  }

  if (!adapters.bleBridge) {
    return blocked('bridge-required', 'BLE OTA requires a browser or native BLE bridge adapter', {
      boardId,
      projectId,
      deviceName,
      firmware,
      bridge: {
        serviceUuid: '4fafc201-1fb5-459e-8fcc-c5c9c331914b',
        source: 'src/utils/bleOta.js',
      },
    })
  }
  if (request.confirm !== true) {
    return blocked('confirmation-required', 'Set confirm=true to allow BLE OTA through the bridge', { firmware })
  }

  try {
    const result = await adapters.bleBridge({
      boardId,
      projectId,
      deviceName,
      firmwarePath: firmware.path,
      firmwareSize: firmware.size || null,
    })
    return {
      status: result?.status || 'success',
      category: result?.category || 'ble-ota-complete',
      boardId,
      projectId,
      deviceName,
      firmware,
      progress: result?.progress ?? null,
      logs: result?.logs || [],
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'ble-bridge-error',
      boardId,
      projectId,
      deviceName,
      firmware,
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
```

- [ ] **Step 4: Run BLE tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs node scripts/test-mcp-ble-ota-device-evidence.mjs
```

Expected: now fails because `deviceEvidence.mjs` is still missing. The BLE portion should no longer be the failure source.

## Task 2: Add Device Evidence MCP Tool

**Files:**
- Modify: `scripts/test-mcp-ble-ota-device-evidence.mjs`
- Create: `backend/mcp-server/tools/deviceEvidence.mjs`

- [ ] **Step 1: Extend failing test for device evidence**

Append to `scripts/test-mcp-ble-ota-device-evidence.mjs`:

```js
const evidence = await collectDeviceEvidenceTool({
  source: 'serial',
  lines: [
    'I (31) boot: ESP-IDF v5.4.1 2nd stage bootloader',
    'E (9271) lvgl: lv_display_flush_ready called before display init',
    'Guru Meditation Error: Core 1 panic\\'ed (LoadProhibited). Exception was unhandled.',
  ],
  deliveryResult: { transport: 'wifi-ota', status: 'queued', jobId: 'job-1', deviceId: 'device-1' },
  manifest: { programName: 'demo' },
  userSymptom: 'screen stays blank',
  otaServiceUrl: 'http://ota.local',
  otaJobId: 'job-1',
}, {
  fetchImpl: async (url) => {
    assert.equal(url, 'http://ota.local/api/ota-jobs/job-1')
    return jsonResponse({ job: { jobId: 'job-1', status: 'flashed', deviceId: 'device-1' } })
  },
})
assert.equal(evidence.status, 'observed')
assert.equal(evidence.otaJob.status, 'flashed')
assert.equal(evidence.deviceEvidence.symptoms.length, 3)
assert.deepEqual(evidence.deviceEvidence.repairableSymptoms.map(item => item.kind), ['lvgl-error', 'guru-meditation'])
assert.equal(evidence.repairContext.kind, 'device-evidence-repair-context')
assert.equal(evidence.repairContext.userSymptom, 'screen stays blank')
assert.equal(evidence.repairContext.canClaimFirmwareCorrectness, false)

const dispatchedEvidence = await dispatchTool('vibeboard.collect_device_evidence', {
  source: 'remote-ota',
  deliveryResult: { transport: 'remote-ota', status: 'done', jobId: 'job-1' },
})
assert.equal(dispatchedEvidence.status, 'success')
assert.equal(dispatchedEvidence.result.deviceEvidence.status, 'success')

const dispatchedBle = await dispatchTool('vibeboard.flash_ble_ota', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
})
assert.equal(dispatchedBle.status, 'success')
assert.equal(dispatchedBle.result.status, 'blocked')
assert.equal(dispatchedBle.result.category, 'bridge-required')

console.log('MCP BLE OTA and device evidence tests passed.')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs node scripts/test-mcp-ble-ota-device-evidence.mjs
```

Expected: fails because `backend/mcp-server/tools/deviceEvidence.mjs` does not exist or dispatch is not wired.

- [ ] **Step 3: Implement device evidence tool**

Create `backend/mcp-server/tools/deviceEvidence.mjs`:

```js
import { createDeliveryDeviceEvidence, createDeviceEvidence, createDeviceRepairContext } from '../../../src/domain/evidence/deviceEvidence.js'
import { requireObject } from './validate.mjs'

const DEFAULT_OTA_SERVICE_URL = 'http://127.0.0.1:8760'

export async function collectDeviceEvidenceTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const source = request.source || inferSource(request.deliveryResult)
  const lines = Array.isArray(request.lines) ? request.lines.map(String) : []
  const otaJob = await fetchOtaJob(request, adapters.fetchImpl)
  const deliveryResult = {
    ...(request.deliveryResult && typeof request.deliveryResult === 'object' ? request.deliveryResult : {}),
    ...(otaJob ? { otaJob } : {}),
  }

  const baseEvidence = lines.length
    ? createDeviceEvidence({
      source,
      status: request.status,
      lines,
      deliveryResult: Object.keys(deliveryResult).length ? deliveryResult : null,
      deviceInfo: request.deviceInfo || null,
      elapsedMs: request.elapsedMs ?? null,
    })
    : createDeliveryDeviceEvidence({
      transport: source,
      status: request.status,
      deliveryResult: Object.keys(deliveryResult).length ? deliveryResult : null,
      deviceInfo: request.deviceInfo || null,
      elapsedMs: request.elapsedMs ?? null,
    })

  const repairContext = createDeviceRepairContext({
    deviceEvidence: baseEvidence,
    manifest: request.manifest || null,
    userSymptom: request.userSymptom || '',
  })

  return {
    status: 'observed',
    source,
    otaJob,
    deviceEvidence: baseEvidence,
    repairContext,
  }
}

function inferSource(deliveryResult) {
  if (deliveryResult?.transport) return deliveryResult.transport
  return 'serial'
}

async function fetchOtaJob(request, fetchImpl = fetch) {
  if (!request.otaJobId) return null
  const base = String(request.otaServiceUrl || DEFAULT_OTA_SERVICE_URL).replace(/\/+$/, '')
  const response = await fetchImpl(`${base}/api/ota-jobs/${encodeURIComponent(request.otaJobId)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    return {
      jobId: request.otaJobId,
      status: 'unknown',
      error: data.error || `query OTA job failed: HTTP ${response.status}`,
    }
  }
  return data.job || null
}
```

- [ ] **Step 4: Wire dispatch and capability**

In `backend/mcp-server/server.mjs`, import:

```js
import { flashBleOtaTool } from './tools/bleOta.mjs'
import { collectDeviceEvidenceTool } from './tools/deviceEvidence.mjs'
```

Register:

```js
'vibeboard.flash_ble_ota': flashBleOtaTool,
'vibeboard.collect_device_evidence': collectDeviceEvidenceTool,
```

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.flash_ble_ota` and `vibeboard.collect_device_evidence` from `planned` to `available`.

- [ ] **Step 5: Add npm script and capability assertions**

In `package.json`, add:

```json
"test:mcp-ble-ota-device-evidence": "node scripts/test-mcp-ble-ota-device-evidence.mjs"
```

In `scripts/test-mcp-server-capabilities.mjs`, expect:

```js
['vibeboard.flash_ble_ota', 'available', ['stdio', 'bridge', 'optional-browser']]
['vibeboard.collect_device_evidence', 'available', ['stdio']]
```

- [ ] **Step 6: Run tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-ble-ota-device-evidence
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
npm run test:device-evidence
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/mcp-server package.json scripts/test-mcp-ble-ota-device-evidence.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose MCP BLE OTA and device evidence tools"
```

Expected: commit succeeds.

## Task 3: Final Verification

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run full MCP surface tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-ble-ota-device-evidence
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-wifi-ota
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-usb-flash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-lvgl-preview
npm run test:mcp-compile-project
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
npm run test:device-evidence
npm run test:no-legacy-web-agent-docs
npm run build
```

Expected: every command exits 0. Vite may still print the existing large chunk warning.

- [ ] **Step 2: Smoke capability over stdio**

Run:

```bash
printf '{"id":1,"method":"vibeboard.list_capabilities","params":{}}\n' | npm run mcp:server
```

Expected: every MCP tool in the list has `status: "available"`.

- [ ] **Step 3: Check worktree**

Run:

```bash
git status --short
```

Expected: no unrelated tracked modifications. Existing untracked `docs/architecture-review.html` may remain.

