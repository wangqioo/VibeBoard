> Legacy document: superseded by `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`. This file is retained for historical context only. Do not use it as current implementation guidance.

# VibeBoard Hardware Workflow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working architecture slice from the VibeBoard architecture deepening design: repo-local agent configuration plus a tested Hardware Workflow foundation that can be adopted by `ChatPanel.jsx` without changing user-facing behavior.

**Architecture:** Start with the main workflow seam, not the whole four-module redesign. Add a deep Hardware Workflow Module with fake-adapter tests, then extract compile verification and workflow message/event helpers from `ChatPanel.jsx`. Preview Runtime, CompileDelivery, and BoardCapabilityProfile are prepared by stable interfaces but deferred to follow-up plans.

**Tech Stack:** React 18, Vite 5, Node script tests, ESP-IDF compiler-service adapters, existing VibeBoard domain modules.

---

## File Structure

Create:

- `docs/agents/issue-tracker.md`: repo-local issue tracker rules for installed engineering skills.
- `docs/agents/triage-labels.md`: repo-local triage label vocabulary.
- `docs/agents/domain.md`: repo-local domain doc lookup rules.
- `src/domain/workflow/hardwareWorkflow.js`: deep Hardware Workflow Module Interface and core executor.
- `src/domain/workflow/hardwareWorkflowEvents.js`: event builders and step-to-message helpers.
- `src/domain/workflow/workflowCompilerAdapter.js`: adapter factory wrapping current compile package and compiler utilities.
- `scripts/test-hardware-workflow.mjs`: fake-adapter workflow tests.
- `scripts/test-workflow-compiler-adapter.mjs`: compile adapter mapping tests.

Modify:

- `CLAUDE.md`: add `## Agent skills` block.
- `package.json`: add `test:hardware-workflow` and `test:workflow-compiler-adapter`.
- `src/components/ChatPanel.jsx`: consume extracted event/message helpers and compiler adapter in narrow slices.
- `src/domain/workflow/generationWorkflow.js`: export shared status/step helpers if needed.

Do not modify in this plan:

- `src/components/DigitalTwinPreview.jsx`
- `src/components/CompilePanel.jsx`
- `src/context/boards/*`
- `backend/compiler-service/*`

Those belong to follow-up plans.

## Task 1: Add Repo-Local Agent Skill Configuration

**Files:**
- Create: `docs/agents/issue-tracker.md`
- Create: `docs/agents/triage-labels.md`
- Create: `docs/agents/domain.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write repo-local issue tracker doc**

Create `docs/agents/issue-tracker.md` with:

````markdown
# Issue Tracker

VibeBoard tracks implementation work in GitHub Issues for
`wangqioo/VibeBoard`.

Use the GitHub CLI from the repository root:

```bash
gh issue list
gh issue view <number>
gh issue create
```

Architecture design documents and implementation plans live in
`docs/superpowers/`. They can be converted into GitHub Issues when work needs
parallel execution or long-lived tracking.
````

- [ ] **Step 2: Write triage labels doc**

Create `docs/agents/triage-labels.md` with:

````markdown
# Triage Labels

Use these canonical triage labels for VibeBoard issues:

| Role | Label |
| --- | --- |
| Needs maintainer evaluation | `needs-triage` |
| Waiting on reporter/user info | `needs-info` |
| Fully specified and ready for an agent | `ready-for-agent` |
| Needs human implementation | `ready-for-human` |
| Will not be actioned | `wontfix` |

If GitHub does not already have one of these labels, create it before applying
it to issues.
````

- [ ] **Step 3: Write domain docs doc**

Create `docs/agents/domain.md` with:

````markdown
# Domain Docs

VibeBoard uses a single-context domain layout.

Read these files before architecture, diagnosis, TDD, or planning work:

- `CONTEXT.md`: product boundary and domain language.
- `docs/project-map.md`: current module map and known friction.
- `docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md`: current architecture deepening design.

ADRs should live under `docs/adr/` when durable architectural decisions are
recorded.
````

- [ ] **Step 4: Add Agent skills block to CLAUDE.md**

Append this block to `CLAUDE.md` unless an `## Agent skills` block already
exists. If it exists, replace only that block.

````markdown
## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `wangqioo/VibeBoard`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Use the canonical triage labels documented in
`docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain layout with `CONTEXT.md` at the root.
See `docs/agents/domain.md`.
````

- [ ] **Step 5: Verify docs are present**

Run:

```bash
test -f docs/agents/issue-tracker.md
test -f docs/agents/triage-labels.md
test -f docs/agents/domain.md
rg -n "## Agent skills|docs/agents/domain.md" CLAUDE.md
```

Expected: all `test` commands exit 0; `rg` prints the new block.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/agents/issue-tracker.md docs/agents/triage-labels.md docs/agents/domain.md
git commit -m "Configure repo-local agent skills"
```

## Task 2: Add Hardware Workflow Event Helpers

**Files:**
- Create: `src/domain/workflow/hardwareWorkflowEvents.js`
- Test: `scripts/test-hardware-workflow.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add package script**

In `package.json`, add:

```json
"test:hardware-workflow": "node scripts/test-hardware-workflow.mjs"
```

Place it with the other `test:*` scripts.

- [ ] **Step 2: Write failing event helper tests**

Create `scripts/test-hardware-workflow.mjs` with:

```js
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-hardware-workflow-'))

async function copyModule(relPath) {
  const source = new URL(`../${relPath}`, import.meta.url)
  const target = join(tmp, relPath)
  await mkdir(dirname(target), { recursive: true })
  let code = await readFile(source, 'utf8')
  code = code.replaceAll(/from '(\.[^']+)'/g, (match, spec) => {
    if (spec.endsWith('.js')) return match
    return `from '${spec}.js'`
  })
  await writeFile(target, code)
  return target
}

await copyModule('src/domain/workflow/generationWorkflow.js')
await copyModule('src/domain/workflow/hardwareWorkflowEvents.js')

const {
  HARDWARE_WORKFLOW_EVENT,
  createWorkflowStepEvent,
  createWorkflowMessageEvent,
  createWorkflowFailureEvent,
  assistantMessageForWorkflowEvent,
} = await import(pathToFileURL(join(tmp, 'src/domain/workflow/hardwareWorkflowEvents.js')).href)

const step = createWorkflowStepEvent('scope', 'active', 'Checking board scope')
assert.equal(step.type, HARDWARE_WORKFLOW_EVENT.STEP)
assert.equal(step.payload.stepId, 'scope')
assert.equal(step.payload.status, 'active')
assert.equal(step.payload.detail, 'Checking board scope')

const message = createWorkflowMessageEvent('正在生成 Program Manifest', { manifest: { programName: 'demo' } })
assert.equal(message.type, HARDWARE_WORKFLOW_EVENT.MESSAGE)
assert.equal(assistantMessageForWorkflowEvent(message).content, '正在生成 Program Manifest')
assert.deepEqual(assistantMessageForWorkflowEvent(message).manifest, { programName: 'demo' })

const failure = createWorkflowFailureEvent('preview-contract-missing', 'Missing app_ui.c')
assert.equal(failure.type, HARDWARE_WORKFLOW_EVENT.FAILED)
assert.equal(failure.payload.failureCategory, 'preview-contract-missing')
assert.equal(assistantMessageForWorkflowEvent(failure).error, true)
assert.match(assistantMessageForWorkflowEvent(failure).content, /Missing app_ui\.c/)

console.log('hardware workflow tests passed')
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm run test:hardware-workflow
```

Expected: FAIL because `src/domain/workflow/hardwareWorkflowEvents.js` does not exist.

- [ ] **Step 4: Implement event helpers**

Create `src/domain/workflow/hardwareWorkflowEvents.js`:

```js
export const HARDWARE_WORKFLOW_EVENT = {
  STEP: 'step',
  MESSAGE: 'message',
  SKILLS_RESOLVED: 'skills-resolved',
  DESIGN_DRAFT_READY: 'design-draft-ready',
  MANIFEST_READY: 'manifest-ready',
  SOURCE_READY: 'source-ready',
  COMPILE_ARTIFACT_READY: 'compile-artifact-ready',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  COMPLETED: 'completed',
}

export function createWorkflowStepEvent(stepId, status, detail = '') {
  return {
    type: HARDWARE_WORKFLOW_EVENT.STEP,
    payload: { stepId, status, detail },
  }
}

export function createWorkflowMessageEvent(content, extra = {}) {
  return {
    type: HARDWARE_WORKFLOW_EVENT.MESSAGE,
    payload: { content, ...extra },
  }
}

export function createWorkflowFailureEvent(failureCategory, message, extra = {}) {
  return {
    type: HARDWARE_WORKFLOW_EVENT.FAILED,
    payload: {
      failureCategory,
      message,
      ...extra,
    },
  }
}

export function assistantMessageForWorkflowEvent(event) {
  if (!event || typeof event !== 'object') return null
  if (event.type === HARDWARE_WORKFLOW_EVENT.MESSAGE) {
    const { content, ...rest } = event.payload || {}
    return { role: 'assistant', content: content || '', ...rest }
  }
  if (event.type === HARDWARE_WORKFLOW_EVENT.FAILED) {
    const payload = event.payload || {}
    return {
      role: 'assistant',
      content: payload.message || '硬件工作流失败。',
      error: true,
      failureCategory: payload.failureCategory || '',
    }
  }
  return null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm run test:hardware-workflow
```

Expected: PASS and prints `hardware workflow tests passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/test-hardware-workflow.mjs src/domain/workflow/hardwareWorkflowEvents.js
git commit -m "Add hardware workflow event helpers"
```

## Task 3: Add Hardware Workflow Executor Skeleton

**Files:**
- Create: `src/domain/workflow/hardwareWorkflow.js`
- Modify: `scripts/test-hardware-workflow.mjs`

- [ ] **Step 1: Extend failing tests for executor outcomes**

Append this to `scripts/test-hardware-workflow.mjs` before the final
`console.log`:

```js
await copyModule('src/domain/workflow/hardwareWorkflow.js')

const {
  runHardwareWorkflow,
} = await import(pathToFileURL(join(tmp, 'src/domain/workflow/hardwareWorkflow.js')).href)

const events = []
const outcome = await runHardwareWorkflow({
  boardId: 'szpi_esp32s3',
  userRequest: '做一个 WiFi 状态界面',
  selectedSkills: ['wifi'],
  projectFiles: { 'main/main.c': 'void app_main(void) {}' },
}, {
  resolveSkills: async () => ['wifi', 'lvgl'],
  runScope: async () => ({ status: 'ready', summary: 'WiFi UI', selectedSkillIds: ['wifi', 'lvgl'] }),
  shouldDraftDesign: () => false,
  generateManifest: async () => ({
    ok: true,
    manifest: {
      programName: 'wifi_ui',
      skillIds: ['wifi', 'lvgl'],
      files: [{ path: 'main/main.c', role: 'entry' }],
    },
  }),
  generateSource: async () => ({
    ok: true,
    files: { 'main/main.c': 'void app_main(void) {}' },
  }),
  validateSource: async files => ({ ok: true, files }),
  compile: async () => ({
    firmware: { filename: 'wifi_ui.bin', size: 1024 },
    buildEvidence: { status: 'success' },
  }),
  emit: event => events.push(event),
})

assert.equal(outcome.status, 'completed')
assert.deepEqual(outcome.selectedSkills, ['wifi', 'lvgl'])
assert.equal(outcome.manifest.programName, 'wifi_ui')
assert.equal(outcome.files['main/main.c'], 'void app_main(void) {}')
assert.equal(outcome.artifact.filename, 'wifi_ui.bin')
assert(events.some(event => event.type === HARDWARE_WORKFLOW_EVENT.COMPLETED))
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:hardware-workflow
```

Expected: FAIL because `hardwareWorkflow.js` does not exist.

- [ ] **Step 3: Implement executor skeleton**

Create `src/domain/workflow/hardwareWorkflow.js`:

```js
import {
  HARDWARE_WORKFLOW_EVENT,
  createWorkflowFailureEvent,
  createWorkflowMessageEvent,
  createWorkflowStepEvent,
} from './hardwareWorkflowEvents'
import { WORKFLOW_STEP_STATUS } from './generationWorkflow'

function noop() {}

function defaultShouldDraftDesign(scopeResult, skillIds) {
  return Boolean(scopeResult?.designRequired || new Set(skillIds || []).has('lvgl'))
}

async function callAdapter(adapters, name, ...args) {
  const fn = adapters?.[name]
  if (typeof fn !== 'function') throw new Error(`missing workflow adapter: ${name}`)
  return fn(...args)
}

export async function runHardwareWorkflow(input = {}, adapters = {}) {
  const emit = typeof adapters.emit === 'function' ? adapters.emit : noop
  const userRequest = String(input.userRequest || '').trim()

  try {
    emit(createWorkflowStepEvent('intent', WORKFLOW_STEP_STATUS.ACTIVE, '解析用户需求和技能'))
    const inferredSkills = await callAdapter(adapters, 'resolveSkills', input)
    emit({
      type: HARDWARE_WORKFLOW_EVENT.SKILLS_RESOLVED,
      payload: { selectedSkills: inferredSkills },
    })

    emit(createWorkflowStepEvent('scope', WORKFLOW_STEP_STATUS.ACTIVE, '按当前板子外设/BSP/官方例程界定功能'))
    const scopeResult = await callAdapter(adapters, 'runScope', {
      ...input,
      userRequest,
      selectedSkills: inferredSkills,
    })

    if (scopeResult?.status === 'needs_clarification') {
      const blocked = {
        type: HARDWARE_WORKFLOW_EVENT.BLOCKED,
        payload: {
          reason: 'needs-clarification',
          questions: scopeResult.questions || [],
          summary: scopeResult.summary || '',
        },
      }
      emit(blocked)
      return {
        status: 'blocked',
        failureCategory: 'needs-clarification',
        selectedSkills: inferredSkills,
        nextAction: 'ask-user',
      }
    }

    const scopedSkills = scopeResult?.selectedSkillIds?.length
      ? scopeResult.selectedSkillIds
      : inferredSkills

    const shouldDraftDesign = typeof adapters.shouldDraftDesign === 'function'
      ? adapters.shouldDraftDesign
      : defaultShouldDraftDesign

    if (shouldDraftDesign(scopeResult, scopedSkills, input)) {
      emit(createWorkflowStepEvent('design', WORKFLOW_STEP_STATUS.ACTIVE, '生成 LVGL 第一屏设计草稿'))
      const design = await callAdapter(adapters, 'generateDesignDraft', {
        ...input,
        userRequest,
        selectedSkills: scopedSkills,
        scope: scopeResult,
      })
      if (!design?.ok) throw new Error(design?.message || 'LVGL 设计草稿未通过校验')
      emit({
        type: HARDWARE_WORKFLOW_EVENT.DESIGN_DRAFT_READY,
        payload: {
          files: design.files || {},
          selectedSkills: scopedSkills,
          scope: scopeResult,
        },
      })
      return {
        status: 'blocked',
        failureCategory: null,
        selectedSkills: scopedSkills,
        files: design.files || {},
        nextAction: 'approve-design',
      }
    }

    emit(createWorkflowStepEvent('manifest', WORKFLOW_STEP_STATUS.ACTIVE, '生成 Program Manifest'))
    const manifestResult = await callAdapter(adapters, 'generateManifest', {
      ...input,
      userRequest,
      selectedSkills: scopedSkills,
      scope: scopeResult,
    })
    if (!manifestResult?.ok) throw new Error(manifestResult?.message || '程序清单未通过校验')
    emit({
      type: HARDWARE_WORKFLOW_EVENT.MANIFEST_READY,
      payload: { manifest: manifestResult.manifest },
    })

    emit(createWorkflowStepEvent('generate-files', WORKFLOW_STEP_STATUS.ACTIVE, '生成应用源码'))
    const sourceResult = await callAdapter(adapters, 'generateSource', {
      ...input,
      userRequest,
      selectedSkills: scopedSkills,
      manifest: manifestResult.manifest,
    })
    if (!sourceResult?.ok) throw new Error(sourceResult?.message || '生成结果未通过校验')

    emit(createWorkflowStepEvent('validate-source', WORKFLOW_STEP_STATUS.ACTIVE, '校验生成文件'))
    const sourceCheck = await callAdapter(adapters, 'validateSource', sourceResult.files || {}, {
      ...input,
      selectedSkills: scopedSkills,
      manifest: manifestResult.manifest,
    })
    if (!sourceCheck?.ok) throw new Error(sourceCheck?.message || '源码契约未通过')

    emit({
      type: HARDWARE_WORKFLOW_EVENT.SOURCE_READY,
      payload: { files: sourceCheck.files || sourceResult.files || {} },
    })

    const compileResult = await callAdapter(adapters, 'compile', {
      ...input,
      selectedSkills: scopedSkills,
      manifest: manifestResult.manifest,
      files: sourceCheck.files || sourceResult.files || {},
    })
    emit({
      type: HARDWARE_WORKFLOW_EVENT.COMPILE_ARTIFACT_READY,
      payload: compileResult,
    })

    const completed = {
      type: HARDWARE_WORKFLOW_EVENT.COMPLETED,
      payload: {
        selectedSkills: scopedSkills,
        manifest: manifestResult.manifest,
        files: sourceCheck.files || sourceResult.files || {},
        artifact: compileResult.firmware || compileResult.artifact || null,
        buildEvidence: compileResult.buildEvidence || null,
      },
    }
    emit(completed)

    return {
      status: 'completed',
      failureCategory: null,
      selectedSkills: scopedSkills,
      manifest: manifestResult.manifest,
      files: sourceCheck.files || sourceResult.files || {},
      artifact: compileResult.firmware || compileResult.artifact || null,
      buildEvidence: compileResult.buildEvidence || null,
      nextAction: null,
    }
  } catch (error) {
    const failure = createWorkflowFailureEvent('workflow-failed', error.message || String(error))
    emit(createWorkflowMessageEvent(error.message || String(error), { error: true }))
    emit(failure)
    return {
      status: 'failed',
      failureCategory: 'workflow-failed',
      error: error.message || String(error),
      nextAction: 'repair-or-retry',
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm run test:hardware-workflow
```

Expected: PASS and prints `hardware workflow tests passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-hardware-workflow.mjs src/domain/workflow/hardwareWorkflow.js
git commit -m "Add hardware workflow executor skeleton"
```

## Task 4: Add Workflow Compiler Adapter

**Files:**
- Create: `src/domain/workflow/workflowCompilerAdapter.js`
- Create: `scripts/test-workflow-compiler-adapter.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add package script**

In `package.json`, add:

```json
"test:workflow-compiler-adapter": "node scripts/test-workflow-compiler-adapter.mjs"
```

- [ ] **Step 2: Write failing adapter tests**

Create `scripts/test-workflow-compiler-adapter.mjs`:

```js
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-workflow-compiler-adapter-'))

async function copyModule(relPath) {
  const source = new URL(`../${relPath}`, import.meta.url)
  const target = join(tmp, relPath)
  await mkdir(dirname(target), { recursive: true })
  let code = await readFile(source, 'utf8')
  code = code.replaceAll(/from '(\.[^']+)'/g, (match, spec) => {
    if (spec.endsWith('.js')) return match
    return `from '${spec}.js'`
  })
  await writeFile(target, code)
  return target
}

await copyModule('src/domain/workflow/workflowCompilerAdapter.js')

const {
  createWorkflowCompilerAdapter,
  createFirmwareArtifact,
} = await import(pathToFileURL(join(tmp, 'src/domain/workflow/workflowCompilerAdapter.js')).href)

const blob = new Blob(['abc'])
blob.firmwareFilename = 'demo.bin'
blob.flashFiles = [{ offset: 0x10000, data: 'app' }]
blob.agent = { deviceId: 'demo-device' }
blob.buildEvidence = { status: 'success' }

const artifact = createFirmwareArtifact(blob)
assert.equal(artifact.bytes, blob)
assert.equal(artifact.filename, 'demo.bin')
assert.equal(artifact.size, 3)
assert.deepEqual(artifact.flashPlan, [{ offset: 0x10000, data: 'app' }])
assert.deepEqual(artifact.agent, { deviceId: 'demo-device' })
assert.deepEqual(artifact.buildEvidence, { status: 'success' })

let assembledInput = null
let compiledInput = null
const adapter = createWorkflowCompilerAdapter({
  assembleCompileFiles: input => {
    assembledInput = input
    return {
      files: {
        'main/main.c': 'void app_main(void) {}',
        '__mainFile': 'main.c',
      },
      mainFile: 'main.c',
      compilePackage: { ok: true, backendProjectFiles: { 'main/main.c': 'void app_main(void) {}' } },
    }
  },
  compileFirmware: async (code, files, onStatus, onLog, options) => {
    compiledInput = { code, files, options }
    return blob
  },
})

const result = await adapter.compile({
  boardId: 'szpi_esp32s3',
  projectId: 'project-1',
  files: { 'main/main.c': 'void app_main(void) {}' },
  selectedSkills: ['wifi', 'lvgl'],
})

assert.deepEqual(assembledInput.selectedSkills, ['wifi', 'lvgl'])
assert.equal(compiledInput.code, 'void app_main(void) {}')
assert.equal(compiledInput.options.projectId, 'project-1')
assert.equal(result.artifact.filename, 'demo.bin')
assert.deepEqual(result.buildEvidence, { status: 'success' })

console.log('workflow compiler adapter tests passed')
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm run test:workflow-compiler-adapter
```

Expected: FAIL because `workflowCompilerAdapter.js` does not exist.

- [ ] **Step 4: Implement workflow compiler adapter**

Create `src/domain/workflow/workflowCompilerAdapter.js`:

```js
export function createFirmwareArtifact(blob) {
  if (!blob) return null
  return {
    bytes: blob,
    filename: blob.firmwareFilename || blob.name || 'firmware.bin',
    size: blob.size || 0,
    flashPlan: blob.flashFiles || null,
    agent: blob.agent || null,
    buildEvidence: blob.buildEvidence || null,
  }
}

export function createWorkflowCompilerAdapter({
  assembleCompileFiles,
  compileFirmware,
} = {}) {
  if (typeof assembleCompileFiles !== 'function') {
    throw new Error('assembleCompileFiles adapter is required')
  }
  if (typeof compileFirmware !== 'function') {
    throw new Error('compileFirmware adapter is required')
  }

  return {
    async compile({
      boardId,
      projectId,
      files,
      selectedSkills,
      onStatus = () => {},
      onLog = () => {},
    } = {}) {
      const { files: compileProjectFiles, mainFile, compilePackage } = assembleCompileFiles({
        boardId,
        projectFiles: files || {},
        selectedSkills: selectedSkills || [],
      })

      if (!compilePackage.ok) {
        const error = new Error(compilePackage.message || '编译前检查失败')
        error.buildEvidence = {
          status: 'failure',
          error: error.message,
          diagnostics: compilePackage.diagnostics || [],
        }
        throw error
      }

      const mainPath = Object.keys(compileProjectFiles)
        .find(path => path === mainFile || path === `main/${mainFile}` || path.endsWith(`/${mainFile}`)) || mainFile
      const code = compileProjectFiles[mainPath] || ''
      const compilerFiles = compilePackage.backendProjectFiles || compileProjectFiles
      const configFiles = Object.fromEntries(
        Object.entries(compilerFiles).filter(([path]) => !path.startsWith('__') && path !== mainPath),
      )
      const compileMetadata = Object.fromEntries(
        Object.entries(compilerFiles).filter(([path]) => path === '__mainFile'),
      )

      const blob = await compileFirmware(
        code,
        { ...configFiles, ...compileMetadata },
        onStatus,
        onLog,
        { projectId: projectId || `generation-${Date.now()}` },
      )
      const artifact = createFirmwareArtifact(blob)
      return {
        firmware: blob,
        artifact,
        buildEvidence: artifact?.buildEvidence || null,
      }
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm run test:workflow-compiler-adapter
```

Expected: PASS and prints `workflow compiler adapter tests passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/test-workflow-compiler-adapter.mjs src/domain/workflow/workflowCompilerAdapter.js
git commit -m "Add workflow compiler adapter"
```

## Task 5: Use Compiler Adapter From ChatPanel

**Files:**
- Modify: `src/components/ChatPanel.jsx`
- Test: `npm run build`, `npm run test:workflow-compiler-adapter`, `npm run test:hardware-workflow`

- [ ] **Step 1: Import adapter in ChatPanel**

In `src/components/ChatPanel.jsx`, add:

```js
import { createWorkflowCompilerAdapter } from '../domain/workflow/workflowCompilerAdapter'
```

- [ ] **Step 2: Replace `compileGeneratedFiles` body**

Keep the existing function name so the rest of `ChatPanel.jsx` does not change.
Replace its body with:

```js
async function compileGeneratedFiles({ boardId, files, selectedSkills, onStatus, onLog }) {
  const adapter = createWorkflowCompilerAdapter({
    assembleCompileFiles,
    compileFirmware,
  })
  const result = await adapter.compile({
    boardId,
    projectId: `generation-${Date.now()}`,
    files,
    selectedSkills,
    onStatus,
    onLog,
  })
  return result.firmware
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
npm run test:workflow-compiler-adapter
npm run test:hardware-workflow
```

Expected: both pass.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: Vite build exits 0. Existing Vite CJS deprecation and chunk-size
warnings are acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatPanel.jsx
git commit -m "Use workflow compiler adapter in chat workflow"
```

## Task 6: Use Workflow Message Helpers From ChatPanel

**Files:**
- Modify: `src/components/ChatPanel.jsx`
- Modify: `src/domain/workflow/hardwareWorkflowEvents.js`
- Test: `npm run build`, `npm run test:hardware-workflow`

- [ ] **Step 1: Add helper for replacing last assistant message**

In `src/domain/workflow/hardwareWorkflowEvents.js`, add:

```js
export function replaceLastAssistantMessage(messages, nextMessage) {
  const updated = [...(messages || [])]
  if (updated.length === 0) return [nextMessage]
  updated[updated.length - 1] = nextMessage
  return updated
}
```

- [ ] **Step 2: Extend test**

In `scripts/test-hardware-workflow.mjs`, import `replaceLastAssistantMessage`
and add:

```js
const replaced = replaceLastAssistantMessage(
  [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'old' }],
  { role: 'assistant', content: 'new' },
)
assert.deepEqual(replaced, [
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: 'new' },
])
```

- [ ] **Step 3: Run test to verify it fails before implementation**

If Step 1 has not been implemented yet, run:

```bash
npm run test:hardware-workflow
```

Expected: FAIL because `replaceLastAssistantMessage` is missing.

- [ ] **Step 4: Run test after implementation**

Run:

```bash
npm run test:hardware-workflow
```

Expected: PASS.

- [ ] **Step 5: Use helper in one ChatPanel path**

In `src/components/ChatPanel.jsx`, import:

```js
import { replaceLastAssistantMessage } from '../domain/workflow/hardwareWorkflowEvents'
```

Replace one repeated pattern:

```js
setMessages(prev => {
  const next = [...prev]
  next[next.length - 1] = {
    role: 'assistant',
    content: message,
    error: true,
  }
  return next
})
```

with:

```js
setMessages(prev => replaceLastAssistantMessage(prev, {
  role: 'assistant',
  content: message,
  error: true,
}))
```

Only replace the first matching error path in this task. Do not refactor all of
`ChatPanel.jsx` yet.

- [ ] **Step 6: Run build**

Run:

```bash
npm run build
```

Expected: Vite build exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatPanel.jsx src/domain/workflow/hardwareWorkflowEvents.js scripts/test-hardware-workflow.mjs
git commit -m "Extract chat workflow message helper"
```

## Task 7: Verify Phase 1 And Write Follow-Up Plan Notes

**Files:**
- Modify: `docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md`

- [ ] **Step 1: Add implementation status section**

Append this section to the spec:

```markdown
## Implementation Status

Phase 1 started with the Hardware Workflow foundation plan:

- `docs/superpowers/plans/2026-06-04-vibeboard-hardware-workflow-foundation.md`

The first implementation phase deliberately stops before broad UI rewrites. The
next plans should be:

1. Preview Runtime Module extraction.
2. CompileDelivery Module extraction.
3. BoardCapabilityProfile Module extraction.
```

- [ ] **Step 2: Run full phase verification**

Run:

```bash
npm run test:hardware-workflow
npm run test:workflow-compiler-adapter
npm run build
```

Expected: both test scripts pass; Vite build exits 0.

- [ ] **Step 3: Check git status**

Run:

```bash
git status --short --branch
```

Expected: only the spec status update is modified.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-04-vibeboard-architecture-deepening-design.md
git commit -m "Document hardware workflow foundation status"
```

## Follow-Up Plans

After this plan is complete, write separate plans for:

1. **Preview Runtime Module**
   - Create `src/domain/digitalTwin/previewRuntime/`.
   - Wrap `/preview/lvgl` as `HeadlessLvglAdapter`.
   - Normalize semantic, intent fallback, real LVGL, and WASM unavailable
     results.

2. **CompileDelivery Module**
   - Promote FirmwareArtifact from workflow adapter into
     `src/domain/compileDelivery/`.
   - Wrap USB, WiFi OTA, BLE OTA, and remote OTA as Delivery Adapters.
   - Move remote job polling out of `CompilePanel.jsx`.

3. **BoardCapabilityProfile Module**
   - Centralize skill dependency, coverage, config, prompt, and validation
     semantics.
   - Add one fake board Adapter test after the interface stabilizes.

## Self-Review Checklist

- Spec coverage: This plan covers the approved spec's first implementation
  phase and creates explicit follow-up entries for Preview Runtime,
  CompileDelivery, and BoardCapabilityProfile.
- Placeholder scan: no placeholder markers or unspecified "add tests" steps.
- Type consistency: `HardwareWorkflowEvent`, `FirmwareArtifact`,
  `CompileTarget`, and Adapter names match the design spec.
