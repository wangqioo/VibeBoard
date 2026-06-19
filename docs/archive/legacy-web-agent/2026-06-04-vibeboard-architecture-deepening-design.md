> Legacy document: superseded by `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`. This file is retained for historical context only. Do not use it as current implementation guidance.

# VibeBoard Architecture Deepening Design

Date: 2026-06-04

## Purpose

VibeBoard already has the right product language: Board Profile, Capability
Skill, Program Intent, Program Manifest, Application Source, System-Owned
Project File, Build Evidence, Device Evidence, Repair Loop, and Digital Twin.
The current architecture problem is not missing vocabulary. The problem is that
the executable hardware workflow still lives mostly in UI modules.

This design turns the current implicit workflow into four deep Modules:

```text
Hardware Workflow Module
  -> BoardCapabilityProfile Module
  -> Preview Runtime Module
  -> CompileDelivery Module
```

The goal is better Locality and Leverage. A future maintainer should be able to
change skill rules, preview fidelity, compile delivery, or repair-loop behavior
without understanding a thousand-line React component.

## Current Friction

`src/components/ChatPanel.jsx` owns the live hardware workflow order: scope
clarification, LVGL design draft, Program Manifest generation, Application
Source generation, source validation, source repair, build verification, build
repair, file application, and compile artifact handoff.

`src/components/DigitalTwinPreview.jsx` owns renderer eligibility, semantic
preview rendering, LVGL preview request construction, interaction replay, log
state, and preview context emission.

`src/components/CompilePanel.jsx` owns compile mode selection, firmware state,
Build Evidence, WiFi OTA, BLE OTA, USB flash, remote OTA, remote device polling,
auto-flash policy, status labels, and repair handoff.

`src/context/*`, `src/domain/program/*`, `src/utils/codeGeneration.js`, and
`src/utils/projectValidation.js` each carry parts of the same Capability Skill
semantics: dependency expansion, prompt text, required config, manifest
requirements, allowed headers, API rules, Driver Contracts, and skill coverage.

These modules are shallow in the architectural sense: callers must know nearly
as much as the implementation. The proposed design moves the seams to domain
Interfaces and leaves UI modules as display shells.

## Design Principles

- Keep the current product line narrow: SZPI ESP32-S3 and ESP-IDF first.
- Preserve Application Source vs System-Owned Project File ownership.
- Move orchestration out of React before doing broad file moves.
- Keep existing utility files as Adapters until a rename gives real Locality.
- Test each new Interface with fake Adapters before converting the UI.
- Do not claim semantic preview is real LVGL rendering.
- Do not make a hypothetical seam just for style. A seam earns its keep when it
  hides real workflow behavior or has more than one Adapter.

## Module 1: Hardware Workflow Module

### Responsibility

The Hardware Workflow Module is the executable chain:

```text
user request
  -> Program Intent / scope
  -> optional LVGL design draft
  -> Program Manifest
  -> Application Source
  -> validation
  -> compile verification
  -> repair loops
  -> workflow outcome
```

It should live under `src/domain/workflow/`.

### Interface

```js
runHardwareWorkflow(input, adapters) -> AsyncIterable<HardwareWorkflowEvent>
```

`input`:

```js
{
  boardId,
  board,
  userRequest,
  selectedSkills,
  projectFiles,
  latestManifest,
  pendingDesign,
  activeFile
}
```

Events:

```js
{
  type:
    | 'step'
    | 'message'
    | 'skills-resolved'
    | 'design-draft-ready'
    | 'manifest-ready'
    | 'source-ready'
    | 'compile-artifact-ready'
    | 'blocked'
    | 'failed'
    | 'completed',
  payload
}
```

Outcome:

```js
{
  status,
  failureCategory,
  selectedSkills,
  manifest,
  files,
  buildEvidence,
  artifact,
  nextAction
}
```

### Seam And Adapters

The seam is the `adapters` object. The Module owns ordering and outcome
normalization; Adapters own concrete IO.

- `AgentAdapter`: scope clarification, LVGL design draft, Program Manifest,
  code generation, source repair, build repair.
- `CompilerAdapter`: compile generated project files and return Build Evidence
  plus a FirmwareArtifact.
- `SourceValidationAdapter`: normalize Application Source and validate board
  contracts.
- `PreviewAdapter`: validate preview contracts and provide preview evidence.
- `WorkspaceAdapter`: UI edge only; applies source files and compile artifacts.

### Migration Slices

1. Move workflow event/status helpers out of `ChatPanel.jsx`.
2. Extract the current `compileGeneratedFiles` helper into a compiler Adapter.
3. Extract manifest generation plus source validation into a callable workflow
   subroutine.
4. Move source repair and build repair loops behind the workflow Interface.
5. Convert `ChatPanel.generateCodeFromInput` to consume workflow events.
6. Add Device Evidence as another Adapter after Build Evidence is stable.

### Tests

Add `scripts/test-hardware-workflow.mjs` with fake Adapters. Cover happy path,
scope clarification blocked, LVGL design draft gate, manifest invalid failure,
system-file rejection, source repair success, compile failure then build repair
success, compile failure after max attempts, and artifact-ready outcome.

## Module 2: Preview Runtime Module

### Responsibility

The Preview Runtime Module owns preview request normalization, renderer
selection, fidelity labeling, peripheral derivation, interaction replay, preview
contract validation, and evidence shape.

It should live under `src/domain/digitalTwin/previewRuntime/`.

### Interface

```js
PreviewRuntime.render(request) -> PreviewRuntimeResult
```

Request:

```js
{
  boardId,
  selectedSkills,
  projectFiles,
  programManifest,
  uiManifest,
  viewport,
  interactions,
  requestedDepth
}
```

Result:

```js
{
  status,
  depth,
  renderer,
  artifact,
  viewport,
  peripherals,
  diagnostics,
  interactionTrace,
  evidence
}
```

Depth values should be explicit:

- `semantic`: React/manifest scene preview.
- `intent-fallback`: inferred PNG fallback, not real LVGL.
- `real-lvgl-headless`: actual LVGL 8.3 framebuffer screenshot.
- `wasm-unavailable`: runtime package path exists but browser/WASM rendering is
  not wired yet.

### Seam And Adapters

- `SemanticPreviewAdapter`: L1 semantic preview from source analysis or
  `uiManifest`.
- `HeadlessLvglAdapter`: compiler-service `/preview/lvgl`, returning PNG
  framebuffer evidence.
- `WasmLvglAdapter`: `backend/lvgl-sim-service /simulate-lvgl`, initially
  returning structured unavailable evidence.
- `IntentFallbackAdapter`: backend or frontend fallback renderer.
- `PeripheralMockAdapter`: display, touch, WiFi, BLE, audio, camera, IMU,
  storage, speech, GPIO mock state.

### Contract Decision

Unify `app_ui_create` and `app_ui_start`. The preview contract should require
`app_ui_create(lv_obj_t *root)` for portable LVGL preview. Firmware generation
may also include `app_ui_start()`, but the Preview Runtime should be able to
derive or ignore that wrapper.

### Migration Slices

1. Extract request/result normalization from `src/utils/preview.js`.
2. Move `hasLvglPreviewContract`, preview manifest construction, peripheral
   derivation, and fingerprinting out of `DigitalTwinPreview.jsx`.
3. Add `HeadlessLvglAdapter` around the existing compiler-service endpoint.
4. Add `SemanticPreviewAdapter`; make the UI render by result depth/artifact.
5. Add `WasmLvglAdapter` with structured `toolchain-missing` and
   `lvgl-runtime-not-wired` outcomes.
6. Move backend preview helpers into a Python preview-runtime package so
   `/preview/lvgl` and `/simulate-lvgl` share validation vocabulary.

### Tests

Add contract tests for `PreviewRuntime.render` across semantic, intent fallback,
headless LVGL, and WASM unavailable Adapters. Keep `test:lvgl-preview-backend`,
`test:lvgl-runtime-package`, and `test:lvgl-sim-service` as Adapter-level
coverage.

## Module 3: CompileDelivery Module

### Responsibility

The CompileDelivery Module owns the chain:

```text
CompileTarget -> FirmwareArtifact -> DeliveryRequest -> DeliveryOutcome
```

It should live under `src/domain/compileDelivery/` or as a submodule under the
Hardware Workflow area. `CompilePackage` is already relatively deep and should
be reused, not rewritten.

### Interface

```js
createCompileDeliveryModule({
  compileAdapter,
  deliveryAdapters,
  deviceRegistryAdapter,
  clock
})

compileDelivery.compile(target, observers) -> CompileOutcome
compileDelivery.deliver(artifact, request, observers) -> DeliveryOutcome
compileDelivery.listDeliveryTargets() -> DeliveryTarget[]
compileDelivery.getRemoteDevices() -> RemoteDevice[]
compileDelivery.watchRemoteJob(jobId, observers) -> unsubscribe
```

Core types:

```js
CompileTarget =
  | { kind: 'project', boardId, projectId, compilePackage, manifest }
  | { kind: 'official-example', exampleId }
  | { kind: 'wifi-ota-receiver', wifiSsid, wifiPassword, serverUrl, deviceId, deviceToken }
  | { kind: 'ble-ota-receiver' }

FirmwareArtifact = {
  bytes,
  filename,
  size,
  flashPlan,
  agent,
  buildEvidence
}

DeliveryRequest =
  | { kind: 'usb', port, automatic }
  | { kind: 'wifi-ota', ip }
  | { kind: 'ble-ota' }
  | { kind: 'remote-ota', deviceId }
```

### Seam And Adapters

- `CompilerAdapter`: converts compiler-service responses into
  FirmwareArtifact. It should not expose mutated Blob shape as the domain
  Interface.
- `UsbFlashAdapter`: delivers `FirmwareArtifact.flashPlan`.
- `WifiOtaAdapter`: delivers `FirmwareArtifact.bytes` to device IP.
- `BleOtaAdapter`: connects, streams, commits, and disconnects BLE OTA.
- `RemoteOtaAdapter`: uploads artifact, creates job, polls job, normalizes
  states.
- `DeviceRegistryAdapter`: lists remote devices and applies online/offline
  rules.

### Migration Slices

1. Introduce FirmwareArtifact conversion while preserving current utility
   exports and `downloadBin`.
2. Add a CompileTarget builder from existing compile mode state.
3. Wrap existing WiFi, BLE, USB, and remote OTA utilities in Delivery Adapters
   with a shared progress event shape.
4. Move auto USB flash policy into the Module.
5. Move remote job polling out of `CompilePanel.jsx`.
6. Replace CompilePanel handlers with compile/deliver calls while preserving the
   existing UI.

### Tests

Add tests for target mapping, FirmwareArtifact creation, delivery outcome
normalization, auto-flash policy, and remote job watch state transitions. Keep
the existing compile package, official examples backend, remote OTA backend,
compiler cache, and BLE OTA guard tests.

## Module 4: BoardCapabilityProfile Module

### Responsibility

The BoardCapabilityProfile Module owns board-specific knowledge:

- Board Profile facts.
- Capability Skill dependency and coverage rules.
- prompt context.
- project config.
- validation contracts.
- Driver Contracts.
- LVGL design profiles.

It should live under `src/context/boards/` or `src/domain/boardProfile/`, with a
stable public Interface that workflows call.

### Interface

```js
profile = getBoardCapabilityProfile(boardId)

profile.resolveSkills(skillIds)
profile.inferIntentHints(userRequest, selectedSkillIds)
profile.planContext({ skillIds, manifest })
profile.projectConfig({ skillIds, projectName })
profile.validationContract({ skillIds, manifest })
profile.driverContracts({ skillIds, contractIds })
```

### Seam And Adapters

The seam is between domain workflows and board-specific knowledge.

- `SzpiBoardAdapter`: wraps current `definition.js`, skill files, Driver
  Contracts, debug transport config, and LVGL design profiles.
- `PromptAdapter`: board prompt, selected skill prompt, official example
  guidance, Driver Contract guidance.
- `ProjectConfigAdapter`: sdkconfig, components, partitions, CMake requirements,
  System-Owned Project Files.
- `ValidationAdapter`: allowed headers, API rules, skill coverage, forbidden
  calls, preview/device-entry rules.
- `IntentAdapter`: keyword rules, requirement rules, dependency/coverage
  resolution.

### Migration Slices

1. Add `resolveCapabilitySkills(board, selectedSkillIds)` and move dependency
   and coverage maps into skill metadata.
2. Move prompt assembly and Driver Contract formatting behind
   `profile.planContext()`.
3. Move `buildProjectFiles()` internals behind `profile.projectConfig()`.
4. Move header/API/coverage/forbidden-call rules behind
   `profile.validationContract()`.
5. Update Program Manifest validation to ask the profile whether requirements
   are satisfied.
6. Add one fake board Adapter in tests after the interface stabilizes.

### Tests

Add profile contract tests for skill resolution, prompt context, project config,
validation contract, and Driver Contract selection. Preserve
`test:board-skills`, `test:program-intent`, `test:program-manifest`,
`test:project-config`, `test:project-validation`, and `test:compile-package`.

## Implementation Order

1. Create repo-local skill configuration:
   `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and
   `docs/agents/domain.md`, then add an `Agent skills` block to `CLAUDE.md`.
2. Implement Hardware Workflow Module tests with fake Adapters.
3. Extract the first Hardware Workflow slices without changing behavior.
4. Introduce Preview Runtime request/result types and HeadlessLvglAdapter.
5. Introduce FirmwareArtifact and CompileDelivery Adapters.
6. Introduce BoardCapabilityProfile Interface and migrate duplicated skill maps.
7. Add ADRs for durable choices: preview fidelity contract, FirmwareArtifact
   shape, and BoardCapabilityProfile seam.

## Non-Goals

- Do not broaden beyond SZPI ESP32-S3 during the first pass.
- Do not rewrite the compiler-service backend before the frontend seam exists.
- Do not replace the existing LVGL headless preview; wrap it first.
- Do not move every utility file into new folders before Interfaces are tested.
- Do not implement WASM rendering in this architecture pass.
- Do not remove semantic preview; keep it as a fast fallback with honest labels.

## Acceptance Criteria

- UI modules no longer own workflow ordering after the first implementation
  phase.
- `ChatPanel.jsx`, `DigitalTwinPreview.jsx`, and `CompilePanel.jsx` become
  display shells over domain events/outcomes.
- Build Evidence and Device Evidence are carried through structured outcomes.
- Preview results always expose renderer and depth.
- Firmware artifacts have a stable domain shape instead of mutated Blob fields.
- Capability Skill semantics are defined once and consumed by prompt, config,
  validation, and manifest code.
- Each new Module has focused script tests using fake Adapters.

## Implementation Status

Phase 1 started with the Hardware Workflow foundation plan:

- `docs/superpowers/plans/2026-06-04-vibeboard-hardware-workflow-foundation.md`

The first implementation phase deliberately stops before broad UI rewrites. The
next plans should be:

1. Preview Runtime Module extraction.
2. CompileDelivery Module extraction.
3. BoardCapabilityProfile Module extraction.
