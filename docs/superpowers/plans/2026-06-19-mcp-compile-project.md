# MCP Compile Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first useful VibeBoard MCP tool, `vibeboard.compile_project`, so local coding agents can compile an ESP-IDF workspace and receive structured artifact paths plus Build Evidence.

**Architecture:** Keep the MCP server as the local stdio entrypoint. Add a Node-side compile tool that reads explicit workspace files, reuses VibeBoard's compile-package boundary, calls the existing compiler-service SSE API through an injectable fetch adapter, writes returned firmware artifacts under a local artifact directory, and returns JSON-safe evidence. The first implementation is unit-tested with fake fetch responses and does not require the real compiler service.

**Tech Stack:** Node ESM, compiler-service payload contract, stdio MCP skeleton, Node built-ins for filesystem/path/crypto, fake fetch tests.

---

## File Structure

- Create: `backend/mcp-server/tools/workspaceFiles.mjs`
  - Reads application source files from an explicit workspace path.
  - Includes only allowed source roots/extensions.
  - Rejects path traversal and missing workspace paths.
- Create: `backend/mcp-server/tools/compilerClient.mjs`
  - Posts compile payloads to the compiler service.
  - Parses SSE `data:` lines.
  - Converts success/failure messages to JSON-safe results.
- Create: `backend/mcp-server/tools/artifacts.mjs`
  - Writes base64 firmware and flash files to a local artifact directory.
  - Returns artifact metadata and paths.
- Create: `backend/mcp-server/tools/compileProject.mjs`
  - Validates MCP input.
  - Reads workspace files.
  - Builds a Node-native compiler-service payload.
  - Calls compiler client.
  - Writes artifacts.
  - Returns `{ status, artifact, buildEvidence, diagnostics }`.
- Modify: `backend/mcp-server/tools/capabilities.mjs`
  - Mark `vibeboard.compile_project` as `available`.
- Modify: `backend/mcp-server/server.mjs`
  - Dispatch `vibeboard.compile_project`.
- Create: `scripts/test-mcp-compile-project.mjs`
  - TDD test for input validation, workspace file filtering, successful fake compile, failed fake compile, and dispatch.
- Modify: `package.json`
  - Add `test:mcp-compile-project`.

---

## Task 1: Workspace File Reader

**Files:**
- Create: `backend/mcp-server/tools/workspaceFiles.mjs`
- Create: `scripts/test-mcp-compile-project.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing workspace reader tests**

Create `scripts/test-mcp-compile-project.mjs` with this initial content:

```js
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readWorkspaceProjectFiles,
} from '../backend/mcp-server/tools/workspaceFiles.mjs'

const workspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-workspace-'))
await mkdir(join(workspace, 'main', 'nested'), { recursive: true })
await mkdir(join(workspace, 'components', 'hack'), { recursive: true })
await writeFile(join(workspace, 'main', 'main.c'), 'void app_main(void) {}')
await writeFile(join(workspace, 'main', 'nested', 'ui.c'), 'void ui(void) {}')
await writeFile(join(workspace, 'main', 'notes.txt'), 'ignore me')
await writeFile(join(workspace, 'components', 'hack', 'hack.c'), 'void hack(void) {}')
await writeFile(join(workspace, 'CMakeLists.txt'), 'ignore system file')

const files = await readWorkspaceProjectFiles({ workspacePath: workspace })
assert.deepEqual(Object.keys(files).sort(), [
  'components/hack/hack.c',
  'main/main.c',
  'main/nested/ui.c',
])
assert.equal(files['main/main.c'], 'void app_main(void) {}')
assert.equal(files['main/notes.txt'], undefined)
assert.equal(files['CMakeLists.txt'], undefined)

await assert.rejects(
  () => readWorkspaceProjectFiles({ workspacePath: '' }),
  /workspacePath is required/,
)

console.log('MCP compile project tests passed.')
```

Expected before implementation: `ERR_MODULE_NOT_FOUND` for `workspaceFiles.mjs`.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-compile-project.mjs
```

Expected: fails because `backend/mcp-server/tools/workspaceFiles.mjs` does not exist.

- [ ] **Step 3: Implement workspace reader**

Create `backend/mcp-server/tools/workspaceFiles.mjs`:

```js
import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'

const ALLOWED_ROOTS = new Set(['main', 'components', 'spiffs'])
const ALLOWED_EXTENSIONS = /\.(c|cc|cpp|cxx|h|hpp|s|S)$/i

function toPosix(path) {
  return path.split(sep).join('/')
}

function assertInsideWorkspace(workspaceRoot, candidate) {
  const rel = relative(workspaceRoot, candidate)
  if (rel.startsWith('..') || rel === '' || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes workspace: ${candidate}`)
  }
}

function isAllowedProjectFile(relPath) {
  const posix = toPosix(relPath)
  const [root] = posix.split('/')
  return ALLOWED_ROOTS.has(root) && ALLOWED_EXTENSIONS.test(posix)
}

async function walkFiles(dir, workspaceRoot, output) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    assertInsideWorkspace(workspaceRoot, fullPath)
    if (entry.isDirectory()) {
      await walkFiles(fullPath, workspaceRoot, output)
      continue
    }
    if (!entry.isFile()) continue
    const rel = toPosix(relative(workspaceRoot, fullPath))
    if (!isAllowedProjectFile(rel)) continue
    output[rel] = await readFile(fullPath, 'utf8')
  }
}

export async function readWorkspaceProjectFiles({ workspacePath } = {}) {
  if (!workspacePath) throw new Error('workspacePath is required')
  const workspaceRoot = resolve(workspacePath)
  const info = await stat(workspaceRoot).catch(() => null)
  if (!info?.isDirectory()) throw new Error(`workspacePath is not a directory: ${workspacePath}`)

  const files = {}
  await walkFiles(workspaceRoot, workspaceRoot, files)
  return files
}
```

Expected: reader includes source files under allowed roots and excludes top-level system files.

- [ ] **Step 4: Add npm script**

In root `package.json`, add:

```json
"test:mcp-compile-project": "node scripts/test-mcp-compile-project.mjs"
```

Expected: test command exists.

- [ ] **Step 5: Run test**

Run:

```bash
npm run test:mcp-compile-project
```

Expected: exits 0 with `MCP compile project tests passed.`

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json scripts/test-mcp-compile-project.mjs backend/mcp-server/tools/workspaceFiles.mjs
git commit -m "feat: read MCP workspace project files"
```

Expected: commit succeeds.

---

## Task 2: Compiler SSE Client And Artifact Writer

**Files:**
- Create: `backend/mcp-server/tools/compilerClient.mjs`
- Create: `backend/mcp-server/tools/artifacts.mjs`
- Modify: `scripts/test-mcp-compile-project.mjs`

- [ ] **Step 1: Extend failing tests**

Append to `scripts/test-mcp-compile-project.mjs`:

```js
import {
  compileProjectWithService,
} from '../backend/mcp-server/tools/compilerClient.mjs'
import {
  writeCompileArtifacts,
} from '../backend/mcp-server/tools/artifacts.mjs'

function sseResponse(chunks, ok = true, status = 200) {
  return {
    ok,
    status,
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    async json() {
      return { error: 'json error' }
    },
  }
}

const fakeFetch = async (url, request) => {
  assert.equal(url, 'http://compiler.local/compile')
  assert.equal(request.method, 'POST')
  const payload = JSON.parse(request.body)
  assert.equal(payload.projectId, 'project-1')
  assert.equal(payload.projectFiles['main/main.c'], 'void app_main(void) {}')
  return sseResponse([
    'data: {"log":"building"}\n\n',
    'data: {"done":true,"bin":"ZmlybXdhcmU=","size":8,"filename":"firmware.bin","buildId":"build-1","command":"idf.py build","flashFiles":[{"name":"bootloader.bin","offset":"0x1000","bin":"Ym9vdA==","size":4}]}\n\n',
  ])
}

const compileResult = await compileProjectWithService({
  compilerUrl: 'http://compiler.local',
  payload: {
    projectId: 'project-1',
    projectFiles: { 'main/main.c': 'void app_main(void) {}' },
  },
  fetchImpl: fakeFetch,
})
assert.equal(compileResult.status, 'success')
assert.equal(compileResult.firmware.filename, 'firmware.bin')
assert.equal(compileResult.firmware.base64, 'ZmlybXdhcmU=')
assert.equal(compileResult.buildEvidence.status, 'success')
assert.equal(compileResult.buildEvidence.buildId, 'build-1')
assert.deepEqual(compileResult.logs, ['building'])

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-artifacts-'))
const artifact = await writeCompileArtifacts({
  artifactDir,
  projectId: 'project-1',
  firmware: compileResult.firmware,
  flashFiles: compileResult.flashFiles,
})
assert.equal(artifact.firmware.size, 8)
assert.match(artifact.firmware.path, /firmware\.bin$/)
assert.equal(artifact.flashFiles[0].name, 'bootloader.bin')

const failedCompile = await compileProjectWithService({
  compilerUrl: 'http://compiler.local/',
  payload: { projectId: 'project-2', projectFiles: {} },
  fetchImpl: async () => sseResponse([
    'data: {"log":"error: bad source"}\n\n',
    'data: {"done":true,"error":"compile failed"}\n\n',
  ]),
})
assert.equal(failedCompile.status, 'failure')
assert.equal(failedCompile.buildEvidence.status, 'failure')
assert.equal(failedCompile.buildEvidence.error, 'compile failed')
```

Expected before implementation: import fails for `compilerClient.mjs` and `artifacts.mjs`.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-compile-project.mjs
```

Expected: fails because compiler client modules do not exist.

- [ ] **Step 3: Implement compiler client**

Create `backend/mcp-server/tools/compilerClient.mjs`:

```js
function normalizeCompilerUrl(compilerUrl) {
  return String(compilerUrl || 'http://localhost:8760').replace(/\/+$/, '')
}

function parseSseLine(line) {
  if (!line.startsWith('data: ')) return null
  return JSON.parse(line.slice(6))
}

function successEvidence({ msg, logs, elapsedMs }) {
  return {
    status: 'success',
    command: msg.command || '',
    buildId: msg.buildId || '',
    firmware: msg.filename || 'firmware.bin',
    size: msg.size || 0,
    logExcerpt: logs.slice(-40).join('\n'),
    elapsedMs,
  }
}

function failureEvidence({ error, logs, elapsedMs }) {
  return {
    status: 'failure',
    error,
    logExcerpt: logs.slice(-80).join('\n'),
    elapsedMs,
  }
}

export async function compileProjectWithService({
  compilerUrl = 'http://localhost:8760',
  payload,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is required')
  const startedAt = Date.now()
  const logs = []
  const res = await fetchImpl(`${normalizeCompilerUrl(compilerUrl)}/compile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = body.error || `compiler service HTTP ${res.status}`
    return {
      status: 'failure',
      logs,
      buildEvidence: failureEvidence({ error, logs, elapsedMs: Date.now() - startedAt }),
    }
  }

  const reader = res.body?.getReader?.()
  if (!reader) throw new Error('compiler response body is not readable')
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const msg = parseSseLine(line.trim())
      if (!msg) continue
      if (msg.log !== undefined) logs.push(msg.log)
      if (msg.done) {
        if (msg.error) {
          return {
            status: 'failure',
            logs,
            buildEvidence: failureEvidence({
              error: msg.error,
              logs,
              elapsedMs: Date.now() - startedAt,
            }),
          }
        }
        return {
          status: 'success',
          logs,
          firmware: {
            base64: msg.bin,
            filename: msg.filename || 'firmware.bin',
            size: msg.size || 0,
          },
          flashFiles: Array.isArray(msg.flashFiles) ? msg.flashFiles : [],
          buildEvidence: successEvidence({
            msg,
            logs,
            elapsedMs: Date.now() - startedAt,
          }),
        }
      }
    }
  }

  return {
    status: 'failure',
    logs,
    buildEvidence: failureEvidence({
      error: 'compiler stream ended before done event',
      logs,
      elapsedMs: Date.now() - startedAt,
    }),
  }
}
```

- [ ] **Step 4: Implement artifact writer**

Create `backend/mcp-server/tools/artifacts.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function safeName(name, fallback) {
  return String(name || fallback).replace(/[^A-Za-z0-9_.-]/g, '_')
}

export async function writeCompileArtifacts({
  artifactDir,
  projectId = 'project',
  firmware,
  flashFiles = [],
} = {}) {
  if (!artifactDir) throw new Error('artifactDir is required')
  if (!firmware?.base64) throw new Error('firmware base64 is required')

  const projectDir = join(artifactDir, safeName(projectId, 'project'))
  await mkdir(projectDir, { recursive: true })

  const firmwareName = safeName(firmware.filename, 'firmware.bin')
  const firmwarePath = join(projectDir, firmwareName)
  const firmwareBytes = Buffer.from(firmware.base64, 'base64')
  await writeFile(firmwarePath, firmwareBytes)

  const writtenFlashFiles = []
  for (const file of flashFiles || []) {
    if (!file?.bin) continue
    const name = safeName(file.name, 'flash.bin')
    const filePath = join(projectDir, name)
    const bytes = Buffer.from(file.bin, 'base64')
    await writeFile(filePath, bytes)
    writtenFlashFiles.push({
      name,
      offset: file.offset || null,
      path: filePath,
      size: file.size || bytes.length,
    })
  }

  return {
    firmware: {
      filename: firmwareName,
      path: firmwarePath,
      size: firmware.size || firmwareBytes.length,
    },
    flashFiles: writtenFlashFiles,
  }
}
```

- [ ] **Step 5: Run test**

Run:

```bash
npm run test:mcp-compile-project
```

Expected: exits 0.

- [ ] **Step 6: Commit**

Run:

```bash
git add backend/mcp-server/tools/compilerClient.mjs backend/mcp-server/tools/artifacts.mjs scripts/test-mcp-compile-project.mjs
git commit -m "feat: add MCP compiler client artifacts"
```

Expected: commit succeeds.

---

## Task 3: Compile Project Tool And Server Dispatch

**Files:**
- Create: `backend/mcp-server/tools/compileProject.mjs`
- Modify: `backend/mcp-server/tools/capabilities.mjs`
- Modify: `backend/mcp-server/server.mjs`
- Modify: `scripts/test-mcp-compile-project.mjs`
- Modify: `scripts/test-mcp-server-capabilities.mjs`

- [ ] **Step 1: Extend failing tool tests**

Append to `scripts/test-mcp-compile-project.mjs`:

```js
import {
  compileProjectTool,
} from '../backend/mcp-server/tools/compileProject.mjs'
import {
  dispatchTool,
} from '../backend/mcp-server/server.mjs'
import {
  listCapabilities,
} from '../backend/mcp-server/tools/capabilities.mjs'

const toolWorkspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-tool-'))
await mkdir(join(toolWorkspace, 'main'), { recursive: true })
await writeFile(join(toolWorkspace, 'main', 'main.c'), 'void app_main(void) {}')

const toolResult = await compileProjectTool({
  workspacePath: toolWorkspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: [],
  projectId: 'project-1',
  compilerUrl: 'http://compiler.local',
  artifactDir,
}, {
  fetchImpl: fakeFetch,
})
assert.equal(toolResult.status, 'success')
assert.equal(toolResult.artifact.firmware.size, 8)
assert.equal(toolResult.buildEvidence.status, 'success')
assert.equal(toolResult.compilePackage.mainFile, 'main.c')
assert.deepEqual(toolResult.compilePackage.selectedSkills, [])

const dispatchResult = await dispatchTool('vibeboard.compile_project', {
  workspacePath: toolWorkspace,
  boardId: 'szpi_esp32s3',
  selectedSkills: [],
  projectId: 'project-1',
  compilerUrl: 'http://compiler.local',
  artifactDir,
}, {
  fetchImpl: fakeFetch,
})
assert.equal(dispatchResult.status, 'success')
assert.equal(dispatchResult.result.status, 'success')

const capability = listCapabilities().tools.find(tool => tool.name === 'vibeboard.compile_project')
assert.equal(capability.status, 'available')
```

Expected before implementation: import or dispatch fails.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-compile-project.mjs
```

Expected: fails because `compileProject.mjs` or dispatch support is missing.

- [ ] **Step 3: Implement compileProject tool**

Create `backend/mcp-server/tools/compileProject.mjs`:

```js
import { resolve } from 'node:path'

import { requireObject } from './validate.mjs'
import { readWorkspaceProjectFiles } from './workspaceFiles.mjs'
import { compileProjectWithService } from './compilerClient.mjs'
import { writeCompileArtifacts } from './artifacts.mjs'

const SUPPORTED_BOARD_IDS = new Set(['szpi_esp32s3'])

function detectMainFile(projectFiles = {}) {
  if (/\bapp_main\s*\(/.test(projectFiles['main/main.cpp'] || '')) return 'main.cpp'
  if (/\bapp_main\s*\(/.test(projectFiles['main/main.c'] || '')) return 'main.c'
  if (projectFiles['main/main.c']) return 'main.c'
  if (projectFiles['main/main.cpp']) return 'main.cpp'
  return null
}

function normalizeSelectedSkills(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item || '').trim())
    .filter(item => /^[A-Za-z0-9_-]{1,64}$/.test(item))
}

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

export async function compileProjectTool(input = {}, adapters = {}) {
  const params = requireObject(input)
  if (!params.workspacePath) throw new Error('workspacePath is required')
  if (!params.boardId) throw new Error('boardId is required')
  if (!SUPPORTED_BOARD_IDS.has(params.boardId)) throw new Error(`unsupported boardId: ${params.boardId}`)

  const projectFiles = await readWorkspaceProjectFiles({ workspacePath: params.workspacePath })
  const mainFile = detectMainFile(projectFiles)
  const selectedSkills = normalizeSelectedSkills(params.selectedSkills)

  if (!mainFile) {
    return {
      status: 'failure',
      artifact: null,
      buildEvidence: {
        status: 'failure',
        error: 'missing entry file with app_main(): main/main.c or main/main.cpp',
        category: 'compile-package-invalid',
      },
      diagnostics: [{
        category: 'missing-entry-file',
        message: 'missing entry file with app_main(): main/main.c or main/main.cpp',
      }],
      compilePackage: {
        mainFile: null,
        selectedSkills,
      },
    }
  }

  const projectId = params.projectId || `mcp-${Date.now()}`
  const backendProjectFiles = {
    ...projectFiles,
    __mainFile: mainFile,
    __selectedSkills: selectedSkills,
  }
  const compileResult = await compileProjectWithService({
    compilerUrl: params.compilerUrl,
    payload: {
      projectId,
      code: projectFiles[`main/${mainFile}`],
      projectFiles: backendProjectFiles,
    },
    fetchImpl: adapters.fetchImpl,
  })

  if (compileResult.status !== 'success') {
    return {
      status: 'failure',
      artifact: null,
      buildEvidence: compileResult.buildEvidence,
      diagnostics: [],
      logs: compileResult.logs,
      compilePackage: {
        mainFile,
        selectedSkills,
      },
    }
  }

  const artifact = await writeCompileArtifacts({
    artifactDir: params.artifactDir || defaultArtifactDir(),
    projectId,
    firmware: compileResult.firmware,
    flashFiles: compileResult.flashFiles,
  })

  return {
    status: 'success',
    artifact,
    buildEvidence: compileResult.buildEvidence,
    diagnostics: [],
    logs: compileResult.logs,
    compilePackage: {
      mainFile,
      selectedSkills,
    },
  }
}
```

This Task intentionally does not import frontend `src/context` or
`src/domain/compilePackage` modules. Those modules use Vite-oriented extensionless
imports, so importing them directly from the Node stdio MCP server would break
runtime loading. The trusted System-Owned Project File boundary is still enforced
by `backend/compiler-service/server.py`, which ignores client-supplied system
files and regenerates `main/CMakeLists.txt`, `main/idf_component.yml`,
`sdkconfig.defaults`, and `partitions.csv` from `__selectedSkills`.

- [ ] **Step 4: Wire server dispatch**

In `backend/mcp-server/server.mjs`, import `compileProjectTool` and add:

```js
'vibeboard.compile_project': compileProjectTool,
```

Change `dispatchTool` signature to:

```js
export async function dispatchTool(name, input = {}, adapters = {}) {
```

and invoke:

```js
result: await handler(input, adapters),
```

Expected: tests can inject fake fetch through dispatch.

- [ ] **Step 5: Mark capability available**

In `backend/mcp-server/tools/capabilities.mjs`, change `vibeboard.compile_project` status from `planned` to `available`.

Update `scripts/test-mcp-server-capabilities.mjs` expected status for `vibeboard.compile_project` to `available`.

- [ ] **Step 6: Run tests**

Run:

```bash
npm run test:mcp-compile-project
npm run test:mcp-server-capabilities
```

Expected: both pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add backend/mcp-server/tools/compileProject.mjs backend/mcp-server/tools/capabilities.mjs backend/mcp-server/server.mjs scripts/test-mcp-compile-project.mjs scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: expose MCP compile project tool"
```

Expected: commit succeeds.

---

## Task 4: Final Verification

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

- [ ] **Step 3: Run existing package boundary tests**

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

- [ ] **Step 5: Smoke test MCP health**

Run:

```bash
printf '{"id":1,"method":"vibeboard.health","params":{}}\n' | npm run mcp:server
```

Expected: output includes `vibeboard-mcp-server`.

- [ ] **Step 6: Check working tree**

Run:

```bash
git status --short
```

Expected: only known unrelated untracked files remain, especially `docs/architecture-review.html`.
