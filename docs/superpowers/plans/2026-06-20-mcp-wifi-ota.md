# MCP WiFi OTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose `vibeboard.flash_wifi_ota` through MCP by uploading the latest firmware artifact to the remote OTA backend and creating an OTA job for a registered device.

**Architecture:** The tool reads persisted build evidence, validates that the firmware artifact exists, uploads it to the compiler-service remote OTA API, then creates a queued OTA job for `deviceId`. It returns structured blocked states for missing evidence, failed builds, unsupported boards, missing device id, and service errors.

**Tech Stack:** Node ESM, MCP stdio server, existing build evidence artifact records, existing compiler-service `/api/firmware` and `/api/ota-jobs` endpoints, TDD scripts.

---

## File Structure

- Create: `backend/mcp-server/tools/wifiOtaClient.mjs`
  - Handles backend HTTP calls: firmware upload, OTA job creation, optional job lookup.
- Create: `backend/mcp-server/tools/wifiOta.mjs`
  - Owns MCP input validation, build evidence lookup, firmware artifact validation, and result shaping.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatches `vibeboard.flash_wifi_ota`.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Marks `vibeboard.flash_wifi_ota` as `available`.
- Create: `scripts/test-mcp-wifi-ota.mjs`
  - Verifies blocked states, request payloads, service failures, and dispatch integration with fake fetch.
- Modify: `scripts/test-mcp-server-capabilities.mjs`
  - Expects WiFi OTA capability to be available.
- Modify: `package.json`
  - Adds `test:mcp-wifi-ota`.

## Tool Contract

`vibeboard.flash_wifi_ota` input:

```json
{
  "artifactDir": "outputs/mcp",
  "projectId": "demo",
  "boardId": "szpi_esp32s3",
  "deviceId": "szpi-s3-ota-receiver",
  "otaServiceUrl": "http://127.0.0.1:8760"
}
```

Successful result:

```json
{
  "status": "queued",
  "category": "ota-job-created",
  "projectId": "demo",
  "boardId": "szpi_esp32s3",
  "deviceId": "szpi-s3-ota-receiver",
  "firmware": { "firmwareId": "...", "size": 1234 },
  "job": { "jobId": "...", "status": "queued" }
}
```

Blocked/failure categories:

- `artifact-dir-required`
- `project-id-required`
- `unsupported-board`
- `device-id-required`
- `build-evidence-missing`
- `build-not-successful`
- `firmware-artifact-missing`
- `firmware-file-missing`
- `ota-service-error`

The first implementation supports `szpi_esp32s3` only.

## Task 1: Add WiFi OTA Client and MCP Tool

**Files:**
- Create: `scripts/test-mcp-wifi-ota.mjs`
- Create: `backend/mcp-server/tools/wifiOtaClient.mjs`
- Create: `backend/mcp-server/tools/wifiOta.mjs`
- Modify: `backend/mcp-server/server.mjs`
- Modify: `backend/mcp-server/tools/capabilities.mjs`
- Modify: `scripts/test-mcp-server-capabilities.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing test**

Create `scripts/test-mcp-wifi-ota.mjs` with:

```js
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeBuildEvidenceRecord } from '../backend/mcp-server/tools/artifacts.mjs'
import { flashWifiOtaTool } from '../backend/mcp-server/tools/wifiOta.mjs'
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

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-wifi-ota-'))
const projectId = 'wifi-ota-demo'
const projectDir = join(artifactDir, projectId)
await mkdir(projectDir, { recursive: true })

const firmwarePath = join(projectDir, 'firmware.bin')
await writeFile(firmwarePath, Buffer.from([1, 2, 3, 4]))

await writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status: 'success',
  buildEvidence: { status: 'success' },
  artifact: {
    firmware: { filename: 'firmware.bin', path: firmwarePath, size: 4 },
    flashFiles: [],
  },
})

const missingDevice = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
})
assert.equal(missingDevice.status, 'blocked')
assert.equal(missingDevice.category, 'device-id-required')

const calls = []
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, options })
  if (String(url).endsWith('/api/firmware')) {
    assert.equal(options.method, 'POST')
    assert.equal(typeof options.body?.get, 'function')
    const file = options.body.get('file')
    assert.equal(file.name, 'firmware.bin')
    assert.equal(file.size, 4)
    return jsonResponse({ firmware: { firmwareId: 'fw-1', filename: 'firmware.bin', size: 4 } })
  }
  if (String(url).endsWith('/api/ota-jobs')) {
    assert.equal(options.method, 'POST')
    assert.equal(options.headers['Content-Type'], 'application/json')
    assert.deepEqual(JSON.parse(options.body), {
      deviceId: 'device-1',
      firmwareId: 'fw-1',
    })
    return jsonResponse({ job: { jobId: 'job-1', deviceId: 'device-1', firmwareId: 'fw-1', status: 'queued' } })
  }
  throw new Error(`unexpected url ${url}`)
}

const queued = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local/',
}, { fetchImpl: fakeFetch })
assert.equal(queued.status, 'queued')
assert.equal(queued.category, 'ota-job-created')
assert.equal(queued.firmware.firmwareId, 'fw-1')
assert.equal(queued.job.jobId, 'job-1')
assert.deepEqual(calls.map(call => call.url), [
  'http://ota.local/api/firmware',
  'http://ota.local/api/ota-jobs',
])

const dispatched = await dispatchTool('vibeboard.flash_wifi_ota', {
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local',
}, { fetchImpl: fakeFetch })
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'queued')

const serviceFailure = await flashWifiOtaTool({
  artifactDir,
  projectId,
  boardId: 'szpi_esp32s3',
  deviceId: 'device-1',
  otaServiceUrl: 'http://ota.local',
}, {
  fetchImpl: async () => jsonResponse({ error: 'device not found' }, false, 404),
})
assert.equal(serviceFailure.status, 'failure')
assert.equal(serviceFailure.category, 'ota-service-error')
assert.match(serviceFailure.message, /device not found/)

console.log('MCP WiFi OTA tests passed.')
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs node scripts/test-mcp-wifi-ota.mjs
```

Expected: fails because `backend/mcp-server/tools/wifiOta.mjs` does not exist.

- [ ] **Step 3: Implement OTA HTTP client**

Create `backend/mcp-server/tools/wifiOtaClient.mjs`:

```js
import { basename } from 'node:path'

export async function uploadFirmwareForWifiOta({ otaServiceUrl, firmwarePath, filename, fetchImpl = fetch, fileFactory = defaultFileFactory }) {
  const form = new FormData()
  const file = await fileFactory(firmwarePath, filename || basename(firmwarePath))
  form.append('file', file, file.name || filename || basename(firmwarePath))

  const response = await fetchImpl(joinUrl(otaServiceUrl, '/api/firmware'), {
    method: 'POST',
    body: form,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `upload firmware failed: HTTP ${response.status}`)
  }
  return data.firmware
}

export async function createWifiOtaJob({ otaServiceUrl, deviceId, firmwareId, fetchImpl = fetch }) {
  const response = await fetchImpl(joinUrl(otaServiceUrl, '/api/ota-jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, firmwareId }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `create OTA job failed: HTTP ${response.status}`)
  }
  return data.job
}

export function joinUrl(base, path) {
  return `${String(base || 'http://127.0.0.1:8760').replace(/\/+$/, '')}${path}`
}

async function defaultFileFactory(path, filename) {
  const bytes = await import('node:fs/promises').then(fs => fs.readFile(path))
  return new File([bytes], filename, { type: 'application/octet-stream' })
}
```

- [ ] **Step 4: Implement MCP tool**

Create `backend/mcp-server/tools/wifiOta.mjs`:

```js
import { access } from 'node:fs/promises'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'
import { createWifiOtaJob, uploadFirmwareForWifiOta } from './wifiOtaClient.mjs'

const SUPPORTED_BOARDS = new Set(['szpi_esp32s3'])
const DEFAULT_OTA_SERVICE_URL = 'http://127.0.0.1:8760'

export async function flashWifiOtaTool(input = {}, adapters = {}) {
  const request = requireObject(input)
  const artifactDir = request.artifactDir
  const projectId = request.projectId
  const boardId = request.boardId
  const deviceId = String(request.deviceId || '').trim()
  const otaServiceUrl = request.otaServiceUrl || DEFAULT_OTA_SERVICE_URL

  if (!artifactDir) return blocked('artifact-dir-required', 'artifactDir is required')
  if (!projectId) return blocked('project-id-required', 'projectId is required')
  if (!SUPPORTED_BOARDS.has(boardId)) return blocked('unsupported-board', `WiFi OTA is not available for board ${boardId || '(missing)'}`)
  if (!deviceId) return blocked('device-id-required', 'deviceId is required')

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

  try {
    const uploadedFirmware = await uploadFirmwareForWifiOta({
      otaServiceUrl,
      firmwarePath: firmware.path,
      filename: firmware.filename,
      fetchImpl: adapters.fetchImpl,
      fileFactory: adapters.fileFactory,
    })
    const job = await createWifiOtaJob({
      otaServiceUrl,
      deviceId,
      firmwareId: uploadedFirmware.firmwareId,
      fetchImpl: adapters.fetchImpl,
    })

    return {
      status: 'queued',
      category: 'ota-job-created',
      projectId,
      boardId,
      deviceId,
      otaServiceUrl,
      firmware: uploadedFirmware,
      job,
    }
  } catch (error) {
    return {
      status: 'failure',
      category: 'ota-service-error',
      projectId,
      boardId,
      deviceId,
      otaServiceUrl,
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

- [ ] **Step 5: Wire dispatch and capability**

In `backend/mcp-server/server.mjs`, import:

```js
import { flashWifiOtaTool } from './tools/wifiOta.mjs'
```

Register:

```js
'vibeboard.flash_wifi_ota': flashWifiOtaTool,
```

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.flash_wifi_ota` from `planned` to `available`.

- [ ] **Step 6: Add npm script and capability assertion**

In `package.json`, add:

```json
"test:mcp-wifi-ota": "node scripts/test-mcp-wifi-ota.mjs"
```

In `scripts/test-mcp-server-capabilities.mjs`, expect:

```js
['vibeboard.flash_wifi_ota', 'available', ['stdio']]
```

- [ ] **Step 7: Run tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-wifi-ota
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

Run:

```bash
git add backend/mcp-server package.json scripts/test-mcp-wifi-ota.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose MCP WiFi OTA tool"
```

Expected: commit succeeds.

## Task 2: Final Verification

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run related tests**

Run:

```bash
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-wifi-ota
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-usb-flash
npm run test:mcp-compile-project
TMPDIR=/Users/wq/VibeBoard/outputs npm run test:mcp-server-capabilities
npm run test:remote-ota-backend
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
{"name":"vibeboard.flash_wifi_ota","status":"available"}
```

- [ ] **Step 3: Check worktree**

Run:

```bash
git status --short
```

Expected: no unrelated tracked modifications. Existing untracked `docs/architecture-review.html` may remain.

