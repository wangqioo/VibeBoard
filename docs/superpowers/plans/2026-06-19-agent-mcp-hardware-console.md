# Agent MCP Hardware Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot VibeBoard from a browser-hosted AI code-generation workspace to a hardware console plus local Node stdio MCP server for Codex, Claude Code, and other local coding agents.

**Architecture:** The web app stops being the Agent host and becomes the compile, flash, preview, and evidence console. A local Node MCP server under `backend/mcp-server/` exposes structured hardware tools over stdio. Old web-agent development documents are archived or superseded so future work follows the MCP hardware-console architecture.

**Tech Stack:** React/Vite, Node ESM scripts, existing VibeBoard domain modules, stdio MCP server skeleton, existing compiler and preview service boundaries.

---

## File Structure

### Documentation Cleanup

- Move to archive: `docs/archive/legacy-web-agent/architecture-natural-language-hardware-automation.md`
  - From: `docs/architecture-natural-language-hardware-automation.md`
  - Reason: old target architecture assumes browser natural-language generation and repair loops.
- Move to archive: `docs/archive/legacy-web-agent/2026-06-04-vibeboard-architecture-deepening-design.md`
  - From: `docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md`
  - Reason: old design centers `ChatPanel` workflow extraction.
- Move to archive: `docs/archive/legacy-web-agent/2026-06-04-vibeboard-hardware-workflow-foundation.md`
  - From: `docs/superpowers/plans/2026-06-04-vibeboard-hardware-workflow-foundation.md`
  - Reason: old plan tells workers to keep adopting `ChatPanel`.
- Move to archive: `docs/archive/legacy-web-agent/huangshan-natural-language-flow.md`
  - From: `docs/huangshan-natural-language-flow.md`
  - Reason: old Huangshan route presents web AI generation as the product flow.
- Modify: `README.md`
  - New product summary: hardware console plus MCP tools.
- Modify: `CONTEXT.md`
  - New product boundary and domain language.
- Modify: `AGENTS.md`
  - First-read docs point to the MCP hardware-console spec.
- Modify: `docs/README.md`
  - Documentation index points to current architecture and legacy archive.
- Modify: `docs/project-map.md`
  - Repository map reflects `backend/mcp-server/` and web console role.
- Modify: `docs/development-plan.md`
  - Replace old phase ordering with MCP pivot phases.
- Modify: `docs/CLAUDE.md`
  - Remove `ChatPanel` as the active development center.

### Web Console Boundary

- Modify: `src/App.jsx`
  - Hide browser `ChatPanel` from the default product path.
  - Rename the right tab from `AI 工作流` to evidence/console language.
  - Keep compile, project editor, preview, and log panels functional.
- Create: `src/config/productFlags.js`
  - Exports `ENABLE_LEGACY_WEB_AGENT = false`.
- Modify: `src/components/CompilePanel.jsx`
  - Replace build-repair callback UI text with evidence export/action text where visible.
- Modify: `src/components/LogPanel.jsx`
  - Replace "analyze with AI" labels with "export device evidence" labels where visible.

### Evidence Export

- Create: `src/domain/evidence/evidencePackage.js`
  - Builds a serializable package from board id, selected skills, manifest, build evidence, device evidence, artifact metadata, and project file fingerprints.
- Create: `scripts/test-evidence-package.mjs`
  - Verifies stable shape and redaction of large file contents.

### MCP Server Skeleton

- Create: `backend/mcp-server/package.json`
  - Local package metadata and scripts.
- Create: `backend/mcp-server/server.mjs`
  - Stdio JSON-RPC/MCP-compatible skeleton exposing `vibeboard.health` and `vibeboard.list_capabilities`.
- Create: `backend/mcp-server/tools/capabilities.mjs`
  - Tool definitions for the first stable capability list.
- Create: `backend/mcp-server/tools/validate.mjs`
  - Shared validation helpers.
- Create: `scripts/test-mcp-server-capabilities.mjs`
  - Tests capability tool output and input validation without starting hardware services.
- Modify: `package.json`
  - Add `mcp:server`, `test:evidence-package`, and `test:mcp-server-capabilities`.

### Regression Guard

- Create: `scripts/test-no-legacy-web-agent-docs.mjs`
  - Fails if active docs still point workers to browser `ChatPanel` AI generation as the current architecture.
- Modify: `package.json`
  - Add `test:no-legacy-web-agent-docs`.

---

## Task 1: Archive Superseded Web-Agent Development Docs

**Files:**
- Move: `docs/architecture-natural-language-hardware-automation.md` -> `docs/archive/legacy-web-agent/architecture-natural-language-hardware-automation.md`
- Move: `docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md` -> `docs/archive/legacy-web-agent/2026-06-04-vibeboard-architecture-deepening-design.md`
- Move: `docs/superpowers/plans/2026-06-04-vibeboard-hardware-workflow-foundation.md` -> `docs/archive/legacy-web-agent/2026-06-04-vibeboard-hardware-workflow-foundation.md`
- Move: `docs/huangshan-natural-language-flow.md` -> `docs/archive/legacy-web-agent/huangshan-natural-language-flow.md`

- [ ] **Step 1: Create archive directory**

Run:

```bash
mkdir -p docs/archive/legacy-web-agent
```

Expected: command exits 0.

- [ ] **Step 2: Move old architecture documents**

Run:

```bash
git mv docs/architecture-natural-language-hardware-automation.md docs/archive/legacy-web-agent/architecture-natural-language-hardware-automation.md
git mv docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md docs/archive/legacy-web-agent/2026-06-04-vibeboard-architecture-deepening-design.md
git mv docs/superpowers/plans/2026-06-04-vibeboard-hardware-workflow-foundation.md docs/archive/legacy-web-agent/2026-06-04-vibeboard-hardware-workflow-foundation.md
git mv docs/huangshan-natural-language-flow.md docs/archive/legacy-web-agent/huangshan-natural-language-flow.md
```

Expected: each `git mv` exits 0.

- [ ] **Step 3: Add archive banner to moved files**

At the top of each moved file, insert:

```markdown
> Legacy document: superseded by `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`. This file is retained for historical context only. Do not use it as current implementation guidance.

```

Expected: every archived file clearly points to the new MCP hardware-console spec.

- [ ] **Step 4: Verify active docs no longer contain the moved paths**

Run:

```bash
rg -n "architecture-natural-language-hardware-automation|huangshan-natural-language-flow|2026-06-04-vibeboard-architecture-deepening-design|2026-06-04-vibeboard-hardware-workflow-foundation" README.md CONTEXT.md AGENTS.md docs --glob '!docs/archive/**'
```

Expected: no matches.

- [ ] **Step 5: Commit**

Run:

```bash
git add docs
git commit -m "docs: archive legacy web agent architecture"
```

Expected: commit succeeds.

---

## Task 2: Rewrite Active Product Documentation Around MCP Console

**Files:**
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `AGENTS.md`
- Modify: `docs/README.md`
- Modify: `docs/project-map.md`
- Modify: `docs/development-plan.md`
- Modify: `docs/CLAUDE.md`

- [ ] **Step 1: Update README product summary**

Replace the opening description in `README.md` with:

```markdown
VibeBoard is an ESP-IDF-first hardware console and local-agent integration layer.
It gives local coding agents such as Codex and Claude Code structured access to
board context, trusted project assembly, compiler services, firmware delivery,
preview rendering, and build/device evidence through a local MCP server.

The browser app is no longer the AI code-generation surface. It is the hardware
console for compile status, flashing, OTA, logs, preview, and MCP activity.
```

Expected: README no longer claims browser natural-language firmware generation as the main product.

- [ ] **Step 2: Update CONTEXT product boundary**

Replace `CONTEXT.md` product-boundary opening with:

```markdown
VibeBoard is a hardware console plus local-agent integration layer. The product
goal is to let local coding agents generate and repair firmware in the user's
repo while VibeBoard provides trusted board context, ESP-IDF project assembly,
compiler access, delivery operations, preview rendering, and structured
build/device evidence.

The web app does not host the AI coding agent. It displays and controls hardware
operations. Local agents use VibeBoard through MCP tools.
```

Expected: local agents own code generation; web owns hardware operations.

- [ ] **Step 3: Update AGENTS first-read list**

In `AGENTS.md`, replace the old architecture link with:

```markdown
- [docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md](docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md) for the current MCP hardware-console architecture.
```

Expected: agents start from the new spec.

- [ ] **Step 4: Update docs index**

In `docs/README.md`, add the current architecture entry:

```markdown
1. [Agent MCP hardware console design](./superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md): current architecture.
2. [Project map](./project-map.md): repository structure and ownership boundaries.
3. [Legacy web-agent archive](./archive/legacy-web-agent/): historical docs superseded by the MCP console pivot.
```

Expected: old natural-language architecture is not listed as current architecture.

- [ ] **Step 5: Update project map**

In `docs/project-map.md`, update the product workflow block to:

```text
Local coding agent
  -> VibeBoard MCP tools
  -> trusted board/project assembly
  -> compiler / preview / delivery services
  -> Build Evidence / Device Evidence
  -> local agent repairs source files
```

Add `backend/mcp-server/` to the main source areas table with purpose:

```markdown
| `backend/mcp-server/` | Local stdio MCP server | Tool surface for Codex, Claude Code, and other local agents. |
```

Expected: repository map reflects the new integration point.

- [ ] **Step 6: Replace development plan phases**

In `docs/development-plan.md`, replace the old phase list with:

```markdown
## Current Development Phases

1. **MCP console pivot**: archive legacy web-agent docs, hide browser chat generation, and make active docs point to the MCP hardware-console architecture.
2. **Evidence export**: package Build Evidence, Device Evidence, artifacts, board selection, and source fingerprints for local agents.
3. **MCP server skeleton**: expose `vibeboard.health` and `vibeboard.list_capabilities` over local stdio MCP.
4. **Compile tool**: expose ESP-IDF compile through MCP while preserving the Application Source vs System-Owned Project File boundary.
5. **Preview and delivery tools**: expose LVGL preview, USB/WiFi/BLE delivery, and blocked bridge states.
6. **Platform expansion**: add Huangshan and Nordic MCP tools only after ESP-IDF compile is stable.
```

Expected: current roadmap no longer tells workers to strengthen browser AI repair loops.

- [ ] **Step 7: Update docs/CLAUDE**

In `docs/CLAUDE.md`, replace the `ChatPanel.jsx` oriented tree notes with:

```markdown
Current architecture note: do not build new browser-hosted AI generation flows.
Code generation and repair happen in local agents. VibeBoard exposes hardware
operations and evidence through the local MCP server and web console.
```

Expected: Claude-specific guidance no longer points implementation work at `ChatPanel`.

- [ ] **Step 8: Verify docs**

Run:

```bash
rg -n "browser-hosted AI|AI 工作流|ChatPanel.*current|current.*ChatPanel|natural-language hardware automation|AI repair loop" README.md CONTEXT.md AGENTS.md docs --glob '!docs/archive/**' --glob '!docs/business/**' --glob '!docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md'
```

Expected: no matches that present old browser-agent development as current guidance.

- [ ] **Step 9: Commit**

Run:

```bash
git add README.md CONTEXT.md AGENTS.md docs
git commit -m "docs: pivot active guidance to MCP console"
```

Expected: commit succeeds.

---

## Task 3: Add Regression Guard Against Legacy Web-Agent Guidance

**Files:**
- Create: `scripts/test-no-legacy-web-agent-docs.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing test script**

Create `scripts/test-no-legacy-web-agent-docs.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const activeRoots = [
  'README.md',
  'CONTEXT.md',
  'AGENTS.md',
  'docs',
]

const ignoredPrefixes = [
  'docs/archive/',
  'docs/business/',
  'docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md',
]

const forbidden = [
  /current[^.\n]*ChatPanel/i,
  /ChatPanel[^.\n]*current/i,
  /AI 工作流/,
  /browser-hosted AI chat as the primary/i,
  /natural-language hardware automation/i,
  /Strengthen the AI repair loop/i,
]

function walk(filePath) {
  const stat = fs.statSync(filePath)
  if (stat.isDirectory()) {
    return fs.readdirSync(filePath).flatMap(name => walk(path.join(filePath, name)))
  }
  return [filePath]
}

const files = activeRoots
  .flatMap(p => walk(path.join(repoRoot, p)))
  .filter(file => /\.(md|mdx|txt)$/.test(file))
  .filter(file => {
    const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/')
    return !ignoredPrefixes.some(prefix => rel.startsWith(prefix))
  })

const failures = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      failures.push(`${path.relative(repoRoot, file)} matches ${pattern}`)
    }
  }
}

if (failures.length) {
  console.error('Legacy web-agent guidance found in active docs:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Checked ${files.length} active docs for legacy web-agent guidance.`)
```

Expected: before docs are fully cleaned, this script fails and lists active docs.

- [ ] **Step 2: Add npm script**

In `package.json` `scripts`, add:

```json
"test:no-legacy-web-agent-docs": "node scripts/test-no-legacy-web-agent-docs.mjs"
```

Expected: `npm run test:no-legacy-web-agent-docs` is available.

- [ ] **Step 3: Run test and verify pass after cleanup**

Run:

```bash
npm run test:no-legacy-web-agent-docs
```

Expected: exits 0 with `Checked ... active docs for legacy web-agent guidance.`

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json scripts/test-no-legacy-web-agent-docs.mjs
git commit -m "test: guard against legacy web agent docs"
```

Expected: commit succeeds.

---

## Task 4: Hide Browser Agent By Default

**Files:**
- Create: `src/config/productFlags.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add product flag**

Create `src/config/productFlags.js`:

```js
export const ENABLE_LEGACY_WEB_AGENT = false
```

Expected: legacy web-agent visibility has a single flag.

- [ ] **Step 2: Import flag in App**

In `src/App.jsx`, add:

```js
import { ENABLE_LEGACY_WEB_AGENT } from './config/productFlags'
```

Expected: no behavior change yet.

- [ ] **Step 3: Rename default right tab**

Change:

```js
const [rightTab, setRightTab] = useState('chat')
```

to:

```js
const [rightTab, setRightTab] = useState('device')
```

Expected: the default right panel is device/evidence oriented.

- [ ] **Step 4: Gate ChatPanel tab**

Wrap the AI tab button and `ChatPanel` panel in `ENABLE_LEGACY_WEB_AGENT && (...)`.

Replace the always-visible tab label:

```jsx
AI 工作流
```

with a gated legacy label:

```jsx
Legacy Agent
```

Expected: default product path no longer exposes browser AI workflow.

- [ ] **Step 5: Add MCP placeholder tab**

Add a new tab button:

```jsx
<button className={`right-tab ${rightTab === 'mcp' ? 'active' : ''}`} onClick={() => setRightTab('mcp')}>
  MCP
</button>
```

Add matching panel:

```jsx
<div className={`right-tab-panel ${rightTab === 'mcp' ? 'active' : ''}`}>
  <div className="console-empty-state">
    Local MCP server will expose compile, flash, preview, and evidence tools.
  </div>
</div>
```

Expected: the UI has a visible MCP destination without implementing tools yet.

- [ ] **Step 6: Redirect legacy callbacks**

Where callbacks currently run `setRightTab('chat')`, change them to:

```js
setRightTab(ENABLE_LEGACY_WEB_AGENT ? 'chat' : 'device')
```

Expected: build/log actions do not route users into a hidden tab.

- [ ] **Step 7: Run build**

Run:

```bash
npm run build
```

Expected: Vite build exits 0.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/App.jsx src/config/productFlags.js
git commit -m "feat: hide legacy browser agent"
```

Expected: commit succeeds.

---

## Task 5: Add Evidence Package Helper

**Files:**
- Create: `src/domain/evidence/evidencePackage.js`
- Create: `scripts/test-evidence-package.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing test**

Create `scripts/test-evidence-package.mjs`:

```js
import assert from 'node:assert/strict'
import { createEvidencePackage } from '../src/domain/evidence/evidencePackage.js'

const pkg = createEvidencePackage({
  boardId: 'szpi_esp32s3',
  selectedSkills: ['lvgl', 'wifi'],
  manifest: { programName: 'wifi_screen' },
  projectFiles: {
    'main/main.c': 'int app_main(void) { return 0; }',
    'README.md': 'large prose should not be embedded',
  },
  buildEvidence: { status: 'failure', errorCategory: 'compile-error' },
  deviceEvidence: { status: 'needs-observation', logs: ['boot'] },
  artifact: { firmware: { size: 1234, filename: 'firmware.bin' } },
})

assert.equal(pkg.schemaVersion, 1)
assert.equal(pkg.boardId, 'szpi_esp32s3')
assert.deepEqual(pkg.selectedSkills, ['lvgl', 'wifi'])
assert.equal(pkg.manifest.programName, 'wifi_screen')
assert.equal(pkg.projectFiles.length, 2)
assert.equal(pkg.projectFiles[0].path, 'README.md')
assert.equal(typeof pkg.projectFiles[0].sha256, 'string')
assert.equal(pkg.projectFiles[0].content, undefined)
assert.equal(pkg.buildEvidence.errorCategory, 'compile-error')
assert.equal(pkg.deviceEvidence.logs[0], 'boot')
assert.equal(pkg.artifact.firmware.size, 1234)

console.log('Evidence package helper tests passed.')
```

Expected before implementation: module import fails.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-evidence-package.mjs
```

Expected: fails because `evidencePackage.js` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/domain/evidence/evidencePackage.js`:

```js
import { createHash } from 'node:crypto'

export function createEvidencePackage({
  boardId,
  selectedSkills = [],
  manifest = null,
  projectFiles = {},
  buildEvidence = null,
  deviceEvidence = null,
  artifact = null,
} = {}) {
  return {
    schemaVersion: 1,
    createdAt: new Date(0).toISOString(),
    boardId: boardId || null,
    selectedSkills: [...selectedSkills],
    manifest,
    projectFiles: Object.entries(projectFiles)
      .map(([path, content]) => ({
        path,
        bytes: Buffer.byteLength(String(content || ''), 'utf8'),
        sha256: createHash('sha256').update(String(content || '')).digest('hex'),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    buildEvidence,
    deviceEvidence,
    artifact,
  }
}
```

Expected: helper hashes file contents but does not embed source text.

- [ ] **Step 4: Add npm script**

In `package.json` `scripts`, add:

```json
"test:evidence-package": "node scripts/test-evidence-package.mjs"
```

Expected: test can run through npm.

- [ ] **Step 5: Run test**

Run:

```bash
npm run test:evidence-package
```

Expected: exits 0 with `Evidence package helper tests passed.`

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json scripts/test-evidence-package.mjs src/domain/evidence/evidencePackage.js
git commit -m "feat: package hardware evidence for agents"
```

Expected: commit succeeds.

---

## Task 6: Add MCP Server Skeleton

**Files:**
- Create: `backend/mcp-server/package.json`
- Create: `backend/mcp-server/server.mjs`
- Create: `backend/mcp-server/tools/capabilities.mjs`
- Create: `backend/mcp-server/tools/validate.mjs`
- Create: `scripts/test-mcp-server-capabilities.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing capabilities test**

Create `scripts/test-mcp-server-capabilities.mjs`:

```js
import assert from 'node:assert/strict'
import {
  listCapabilities,
  runHealth,
} from '../backend/mcp-server/tools/capabilities.mjs'

const health = runHealth()
assert.equal(health.status, 'ok')
assert.equal(health.service, 'vibeboard-mcp-server')

const caps = listCapabilities()
const names = caps.tools.map(tool => tool.name)
assert.ok(names.includes('vibeboard.health'))
assert.ok(names.includes('viboard.list_capabilities') === false)
assert.ok(names.includes('vibeboard.list_capabilities'))
assert.ok(names.includes('vibeboard.compile_project'))

const compile = caps.tools.find(tool => tool.name === 'vibeboard.compile_project')
assert.equal(compile.status, 'planned')
assert.equal(compile.transport, 'stdio')

console.log('MCP server capability tests passed.')
```

Expected before implementation: module import fails.

- [ ] **Step 2: Run failing test**

Run:

```bash
node scripts/test-mcp-server-capabilities.mjs
```

Expected: fails because `backend/mcp-server/tools/capabilities.mjs` does not exist.

- [ ] **Step 3: Add capabilities module**

Create `backend/mcp-server/tools/capabilities.mjs`:

```js
export function runHealth() {
  return {
    status: 'ok',
    service: 'vibeboard-mcp-server',
    transport: 'stdio',
  }
}

export function listCapabilities() {
  return {
    tools: [
      { name: 'vibeboard.health', status: 'available', transport: 'stdio' },
      { name: 'vibeboard.list_capabilities', status: 'available', transport: 'stdio' },
      { name: 'vibeboard.compile_project', status: 'planned', transport: 'stdio' },
      { name: 'vibeboard.get_build_evidence', status: 'planned', transport: 'stdio' },
      { name: 'vibeboard.flash_usb', status: 'planned', transport: 'stdio', bridge: 'optional-browser' },
      { name: 'vibeboard.flash_wifi_ota', status: 'planned', transport: 'stdio' },
      { name: 'vibeboard.flash_ble_ota', status: 'planned', transport: 'stdio', bridge: 'optional-browser' },
      { name: 'vibeboard.render_lvgl_preview', status: 'planned', transport: 'stdio' },
      { name: 'vibeboard.collect_device_evidence', status: 'planned', transport: 'stdio' },
    ],
  }
}
```

Expected: capability list matches the approved spec.

- [ ] **Step 4: Add validation helper**

Create `backend/mcp-server/tools/validate.mjs`:

```js
export function requireObject(value, label = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}
```

Expected: future tools have shared validation.

- [ ] **Step 5: Add stdio server skeleton**

Create `backend/mcp-server/server.mjs`:

```js
#!/usr/bin/env node
import { listCapabilities, runHealth } from './tools/capabilities.mjs'

const methods = {
  'vibeboard.health': runHealth,
  'vibeboard.list_capabilities': listCapabilities,
}

export function dispatchTool(name, input = {}) {
  const fn = methods[name]
  if (!fn) {
    return {
      status: 'error',
      error: {
        code: 'tool-not-found',
        message: `Unknown VibeBoard tool: ${name}`,
      },
    }
  }
  return {
    status: 'success',
    result: fn(input),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdin.setEncoding('utf8')
  let buffer = ''
  process.stdin.on('data', chunk => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      const request = JSON.parse(line)
      const response = dispatchTool(request.method, request.params || {})
      process.stdout.write(`${JSON.stringify({ id: request.id || null, ...response })}\n`)
    }
  })
}
```

Expected: this is a minimal newline-delimited stdio skeleton, not the full MCP protocol yet.

- [ ] **Step 6: Add local package metadata**

Create `backend/mcp-server/package.json`:

```json
{
  "name": "@vibeboard/mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "vibeboard-mcp-server": "./server.mjs"
  }
}
```

Expected: server can be run as a Node module.

- [ ] **Step 7: Add npm scripts**

In root `package.json` `scripts`, add:

```json
"mcp:server": "node backend/mcp-server/server.mjs",
"test:mcp-server-capabilities": "node scripts/test-mcp-server-capabilities.mjs"
```

Expected: root commands exist.

- [ ] **Step 8: Run test**

Run:

```bash
npm run test:mcp-server-capabilities
```

Expected: exits 0 with `MCP server capability tests passed.`

- [ ] **Step 9: Smoke test stdio server**

Run:

```bash
printf '{"id":1,"method":"vibeboard.health","params":{}}\n' | npm run mcp:server
```

Expected: output JSON includes `"status":"success"` and `"service":"vibeboard-mcp-server"`.

- [ ] **Step 10: Commit**

Run:

```bash
git add package.json backend/mcp-server scripts/test-mcp-server-capabilities.mjs
git commit -m "feat: add VibeBoard MCP server skeleton"
```

Expected: commit succeeds.

---

## Task 7: Final Verification For Phase 1

**Files:**
- No new files.

- [ ] **Step 1: Run documentation guard**

Run:

```bash
npm run test:no-legacy-web-agent-docs
```

Expected: exits 0.

- [ ] **Step 2: Run evidence package test**

Run:

```bash
npm run test:evidence-package
```

Expected: exits 0.

- [ ] **Step 3: Run MCP capability test**

Run:

```bash
npm run test:mcp-server-capabilities
```

Expected: exits 0.

- [ ] **Step 4: Run existing boundary tests**

Run:

```bash
npm run test:compile-package
npm run test:project-validation
npm run test:compiler-security
```

Expected: each command exits 0. If `test:compiler-security` requires Python dependencies or service paths that are unavailable locally, capture the failure and do not claim it passed.

- [ ] **Step 5: Run frontend build**

Run:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Check working tree**

Run:

```bash
git status --short
```

Expected: only known user/untracked artifacts remain, such as `docs/architecture-review.html` if it is still intentionally untracked.

