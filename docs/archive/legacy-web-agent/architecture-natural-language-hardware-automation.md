> Legacy document: superseded by `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`. This file is retained for historical context only. Do not use it as current implementation guidance.

# Natural-Language Hardware Automation Architecture

## Goal

VibeBoard should become an end-to-end natural-language hardware development
system:

```text
natural language
  -> interpreted intent
  -> selected board skills
  -> program manifest
  -> generated application source
  -> project validation
  -> ESP-IDF project assembly
  -> cloud or local build
  -> firmware delivery
  -> device evidence
  -> AI repair loop
```

The reference project `embed-ai-tool` is useful because it treats embedded work
as composable skills and workflows. VibeBoard should not copy its `.claude`
installation shape. VibeBoard should internalize the useful idea: each hardware
operation is a structured capability with inputs, detection rules, execution,
failure categories, and handoff output.

## Architectural Position

`embed-ai-tool` is a skill collection for coding assistants.

VibeBoard should be a productized hardware automation workspace. The skill
system should be inside the app, visible in the UI, testable in source code, and
connected to real build and device workflows.

```text
embed-ai-tool
  = external assistant skills + scripts

VibeBoard
  = board-aware product shell + internal skills + executable workflows
```

## MCU Development Layering Standard

VibeBoard treats MCU firmware generation differently from Linux application
generation. A Linux application usually sits above an OS, stable system APIs,
and mature device drivers. MCU firmware must satisfy product behavior and the
physical board at the same time: pin ownership, peripheral configuration, BSP
APIs, sdkconfig, partition layout, boot/flashing constraints, runtime timing,
memory, and device feedback.

The project standard is:

```text
L0 Hardware Facts
  Chip, module, Flash/PSRAM, device models, pinout, reserved pins.

L1 Chip Peripherals
  GPIO, I2C, SPI, I2S, UART, WiFi, BLE, DMA, interrupts, timers.

L2 Board Support
  BSP APIs, board init sequence, power/reset/IO expander behavior,
  official-example facts, generated build configuration.

L3 Driver Contracts
  Per-capability API boundary: required init order, allowed APIs,
  forbidden APIs, required components, acceptance checks, common failures.

L4 Application Orchestration
  app_main, FreeRTOS tasks, event loops, state machines, UI logic,
  peripheral composition, logs, error handling.

L5 Product Behavior
  The user's natural-language device behavior, interactions, and observable
  success criteria.
```

Responsibility boundary:

- VibeBoard owns L0-L3. These layers are product data and system-owned files.
- AI owns L4-L5. It generates application source that composes approved
  hardware capabilities.
- AI must not freely generate CMakeLists, sdkconfig, partition tables, BSP
  components, pin maps, or low-level board drivers.
- Every hardware capability should move from prompt-only knowledge to a
  structured Driver Contract.

This is the core product distinction from general AI coding tools: the assistant
does not merely write C code; it writes application orchestration inside a
board-aware hardware contract.

## Reusable Pieces Moved From `embed-ai-tool`

These parts are useful enough to bring into VibeBoard directly, adapted to the
product's ESP-IDF-first architecture:

- Shared outcome statuses: `success`, `partial_success`, `blocked`, `failure`.
- Shared failure categories: `environment-missing`, `project-config-error`,
  `connection-failure`, `artifact-missing`, `permission-problem`,
  `ambiguous-context`, plus VibeBoard-specific manifest and write-surface
  categories.
- Skill handoff rules: preserve structured evidence and recommend the next
  workflow step instead of returning unstructured logs.
- Acceptance scenarios: every capability and workflow needs happy-path,
  missing-dependency, ambiguous-context, guardrail, and repair-loop coverage.
- ESP-IDF build artifact ideas: scan build outputs, keep command/evidence, and
  separate environment failure from project failure and artifact failure.

These are now represented under `src/domain/workflow/` and should be reused by
manifest validation, compiler results, delivery adapters, log capture, and
repair workflows.

## Core Modules

### 1. Board Profile Registry

Current files:

- `src/context/boards/index.js`
- `src/context/boards/szpi_esp32s3/definition.js`
- `src/context/boards/szpi_esp32s3/skills/*`

Target responsibility:

- Register supported boards.
- Provide hardware facts, forbidden pins, BSP API surface, ESP-IDF target, flash
  and PSRAM defaults, and board pitfalls.
- Expose a typed list of Capability Skills.
- Generate base system context for AI.

The Board Profile should be deep: callers should not need to know how sdkconfig,
component manifests, partitions, pins, and prompt context are assembled.

### 2. Capability Skill Registry

Current state:

- Existing board skills already contain `id`, `label`, `projectConfig`, and
  `systemPrompt`.

Target shape:

```js
{
  id: 'wifi',
  label: 'WiFi',
  description: 'Station mode, scan/connect, OTA prerequisites',
  dependencies: ['nvs'],
  conflicts: [],
  projectConfig: {
    sdkconfig: [],
    idfComponents: [],
    partitions: [],
    srcs: [],
    spiffs: false,
    compileOptions: []
  },
  driverContractIds: ['network.wifi-sta'],
  promptContext: '',
  validationRules: [],
  examples: []
}
```

This is where VibeBoard should borrow from `embed-ai-tool`: each skill needs
applicability, required inputs, detection, execution steps, failure split, output
contract, and handoff relationship. In VibeBoard these become structured fields,
not just Markdown.

### 3. Intent Interpreter

New module:

- `src/domain/intent/`

Responsibility:

- Convert the user's natural-language request into Program Intent.
- Detect whether the user wants explanation, code generation, build, flash,
  diagnosis, or a full workflow.
- Suggest Capability Skills based on the request and current board.
- Keep user-visible uncertainty explicit. If the request could mean camera or
  display, ask before generating code.

Suggested output:

```json
{
  "mode": "generate-program",
  "boardId": "szpi_esp32s3",
  "skillIds": ["lvgl", "wifi"],
  "summary": "Show WiFi scan results on the LCD",
  "constraints": ["ESP-IDF", "application-source-only"],
  "questions": []
}
```

### 4. Program Manifest

New module:

- `src/domain/program/manifest.js`
- `src/domain/program/validateManifest.js`

Responsibility:

- Represent the generated firmware before source files are written.
- Make selected skills, file plan, runtime services, and validation expectations
  explicit.
- Give the UI a previewable artifact: what will be created and why.

Suggested shape:

```json
{
  "schemaVersion": 1,
  "boardId": "szpi_esp32s3",
  "skillIds": ["lvgl", "wifi"],
  "programName": "wifi_scan_display",
  "entry": "main/main.c",
  "files": [
    { "path": "main/main.c", "role": "entry" },
    { "path": "main/wifi_scan.c", "role": "module" },
    { "path": "main/wifi_scan.h", "role": "header" }
  ],
  "requires": {
    "nvs": true,
    "display": true,
    "network": true
  },
  "driverContracts": ["display.lvgl-ui", "network.wifi-sta"],
  "runtimeServices": ["freertos-task", "nvs", "wifi", "lvgl", "serial-log"],
  "acceptanceChecks": ["LCD shows WiFi status", "serial log contains WIFI_READY"],
  "allowedWriteSurface": "application-source-only"
}
```

The manifest becomes the stable seam between AI planning and AI code writing.
If code generation fails, the repair loop can ask for a patch against the
manifest instead of restarting from raw chat.

The manifest carries the MCU layering boundary:

- `skillIds`: L2/L3 capability selection.
- `driverContracts`: exact L3 contracts the generated source must obey.
- `runtimeServices`: runtime resources such as FreeRTOS tasks, NVS, WiFi, BLE,
  LVGL, OTA, or serial logs.
- `acceptanceChecks`: observable build or device behavior used by evidence and
  repair loops.

### 5. Source Generator

Current file:

- `src/utils/codeGeneration.js`

Target responsibility:

- Generate files from a Program Manifest.
- Keep JSON-only model output.
- Write application files only.
- Generate files in smaller units when the manifest contains multiple modules.
- Support patch generation after build or device failures.

This module should no longer decide skill selection. It should consume Program
Intent and Program Manifest.

### 6. Project Validator

Current files:

- `src/utils/filePlacement.js`
- `src/utils/projectValidation.js`
- `scripts/test-file-placement.mjs`
- `scripts/test-code-generation.mjs`
- `scripts/test-project-config.mjs`

Target responsibility:

- Validate manifest, paths, include graph, selected skills, forbidden BSP APIs,
  forbidden pins, and System-Owned Project Files.
- Check that every quoted local include has a matching file.
- Check selected skills match used APIs when possible.
- Check generated source against Driver Contract forbidden APIs and headers
  before compile.
- Produce structured validation errors for the UI and repair loop.

Failure categories should mirror the style of `embed-ai-tool`:

- `ambiguous-intent`
- `manifest-invalid`
- `unsafe-path`
- `system-file-write-denied`
- `missing-entrypoint`
- `missing-local-include`
- `skill-not-selected`
- `forbidden-board-api`
- `build-failed`
- `artifact-missing`
- `flash-failed`
- `runtime-failed`

### 7. Project Assembler

Current file:

- `src/utils/projectAssembly.js`

Target responsibility:

- Combine Application Source from the editor with System-Owned Project Files
  generated from Board Profile and Capability Skills.
- Keep ESP-IDF configuration deterministic.
- Produce a full project bundle that can be sent to the compiler service.

The assembler should be the only module that knows how `sdkconfig.defaults`,
`main/idf_component.yml`, partitions, and component requirements are merged.

### 8. Build Runner

Current files:

- `src/utils/compiler.js`
- `backend/compiler-service/server.py`
- `src/components/CompilePanel.jsx`

Target responsibility:

- Accept a full assembled project bundle.
- Stream Build Evidence, not just raw SSE lines.
- Return firmware artifact metadata.
- Preserve enough logs for repair.
- Categorize failures.

Suggested backend result:

```json
{
  "status": "failure",
  "category": "build-failed",
  "summary": "fatal error: wifi_scan.h: No such file",
  "buildId": "a1b2c3d4",
  "evidence": {
    "command": "idf.py -C ... build",
    "tail": [],
    "firstError": {
      "file": "main/main.c",
      "line": 12,
      "message": "wifi_scan.h: No such file"
    }
  }
}
```

### 9. Firmware Delivery

Current files:

- `src/utils/ota.js`
- `src/utils/bleOta.js`
- `src/utils/usbFlash.js`
- `src/components/CompilePanel.jsx`

Target responsibility:

- Treat WiFi OTA, BLE OTA, and browser USB flash as delivery adapters.
- Emit Device Evidence with status, progress, device identity, and errors.
- Feed failures into the repair loop when relevant.

Delivery adapters should have explicit trust and artifact requirements:

| Adapter | Browser trust requirement | Firmware artifact | Best use |
| --- | --- | --- | --- |
| WiFi OTA | ordinary HTTP app page is enough | application `.bin` | devices already running the OTA receiver |
| BLE OTA | ordinary HTTP app page is enough | application `.bin` | local wireless update without IP routing |
| Browser USB flash | trusted HTTPS or `localhost` secure context | application `.bin` at `0x10000` today | direct cable update from Chrome/Edge |

The browser USB adapter uses Web Serial. It must stay disabled on plain public
HTTP pages because Chrome only exposes `navigator.serial` in a secure context:
trusted HTTPS or localhost. FRP TCP forwarding can expose a port, but it does
not by itself make the page HTTPS-trusted. A production public USB-flash URL
therefore needs one of these:

- A real HTTPS termination point on the public server, usually port 443 with a
  trusted certificate, reverse-proxying to the existing VibeBoard HTTP service.
- A domain with DNS-challenge certificate automation if the service must live
  behind a non-standard TCP tunnel.
- A local desktop/dev entrypoint such as `http://localhost:5173`, which browsers
  treat as a secure context for Web Serial.

Current browser USB flash is application-only: it writes the compiled app image
to `0x10000`. Blank-chip provisioning still needs a full flash manifest with
bootloader, partition table, OTA data, and app offsets returned by the compiler
service before the UI should offer "full device flash".

### 10. Device Evidence and Repair Loop

Current files:

- `src/components/LogPanel.jsx`
- `src/utils/logStream.js`

Target responsibility:

- Capture logs and runtime symptoms.
- Summarize evidence for the assistant.
- Ask the model for a patch scoped to Application Source.
- Revalidate before applying.
- Rebuild and rerun.

This is the heart of "natural language to real hardware automation": the loop
does not stop at generated code. It closes on observed behavior.

## Proposed Directory Layout

```text
src/
  domain/
    boards/
      registry.js
    skills/
      capabilitySkillSchema.js
      resolveSkills.js
    intent/
      interpretIntent.js
      intentSchema.js
    program/
      manifestSchema.js
      generateManifest.js
      validateManifest.js
      extractManifestFromSource.js
    workflow/
      hardwareWorkflow.js
      workflowState.js
      failureCategories.js
    evidence/
      buildEvidence.js
      deviceEvidence.js
      repairContext.js
  adapters/
    ai/
      chatClient.js
      jsonCompletion.js
    build/
      compilerClient.js
    flash/
      wifiOtaAdapter.js
      bleOtaAdapter.js
  context/
    boards/
      szpi_esp32s3/
        definition.js
        skills/
```

This layout does not need to be created all at once. It is the target shape for
incremental migration.

## Workflow Designs

### Explain

```text
user request
  -> Intent Interpreter: mode=explain
  -> Board Profile prompt
  -> AI answer
  -> no project mutation
```

### Generate Program

```text
user request
  -> Intent Interpreter
  -> Skill Resolver
  -> Program Manifest Generator
  -> Manifest Validator
  -> Source Generator
  -> Project Validator
  -> Apply Application Source
```

### Build And Flash

```text
current source + selected skills
  -> Project Validator
  -> Project Assembler
  -> Build Runner
  -> firmware artifact
  -> Delivery Adapter
  -> Device Evidence
```

### Repair Build Failure

```text
Build Evidence
  -> Repair Context
  -> AI source patch
  -> Project Validator
  -> Apply patch
  -> Build Runner
```

### Repair Runtime Failure

```text
Device Evidence + user symptom
  -> Repair Context
  -> AI source patch
  -> Project Validator
  -> Build Runner
  -> Delivery Adapter
  -> Device Evidence
```

## Migration Plan

### Phase 1: Make The Domain Explicit

- Add `CONTEXT.md`.
- Keep ESP-IDF-only and SZPI ESP32-S3-first boundaries.
- Define Board Profile, Capability Skill, Program Intent, Program Manifest,
  Build Evidence, Device Evidence, and Repair Loop.
- Document the L0-L5 MCU development layering standard.
- Fix stale agent docs references.

Exit criteria:

- Contributors can tell where each concept belongs.
- README and agent docs use the same language.

### Phase 2: Standardize Capability Skills

- Rename `systemPrompt` to or alias it as `promptContext`.
- Add `description`, `dependencies`, `conflicts`, `validationRules`, and
  `examples` to each board skill.
- Add `driverContractIds` to each board skill that touches hardware.
- Add a schema validator for skills.
- Add tests that every board skill has valid project config.

Exit criteria:

- Selecting skills is data-driven.
- Project config generation no longer relies on undocumented skill fields.
- Each hardware-facing skill points at one or more Driver Contracts.

### Phase 3: Introduce Driver Contracts

- Add `driverContracts.js` per board.
- Each contract defines `requiredInit`, `allowedApis`, `forbiddenApis`,
  `requiredComponents`, `acceptanceChecks`, and `commonFailures`.
- Attach contracts to skills.
- Inject selected contracts into planning, source generation, and repair prompts.
- Validate contract IDs and contract-skill ownership in the manifest.
- Add source validation for forbidden contract patterns.

Exit criteria:

- AI sees a structured hardware API boundary before writing source.
- Generated source can be rejected before compile when it violates a contract.

### Phase 4: Introduce Program Manifest

- Add manifest schema and validator.
- Change generation to produce manifest first, then source files.
- Show manifest preview in the UI before applying code.
- Store the latest manifest alongside project files.

Exit criteria:

- AI code generation has a stable plan artifact.
- Invalid plans fail before code is written.

### Phase 5: Split Generation Into Workflow Steps

- Move chat-only explanation away from generation internals.
- Add workflow state for `intent -> manifest -> files -> validate -> applied`.
- Keep current `Generate Code` button, but route through the workflow.

Exit criteria:

- The UI can show which step failed.
- The assistant can retry a failed step without restarting the whole task.

### Phase 6: Structure Build Evidence

- Update compiler service and client to emit structured build result events.
- Preserve full build logs long enough for repair.
- Parse first compiler error when possible.
- Add tests for build error summarization.

Exit criteria:

- Build failure is machine-readable.
- Repair prompts no longer depend on copying ad hoc terminal text.

### Phase 7: Add Repair Loop

- Add "修复编译错误" using Build Evidence.
- Restrict repair output to Application Source.
- Revalidate patches before applying.
- Add "根据日志修复" using Device Evidence.

Exit criteria:

- A failed build or runtime log can trigger a controlled source patch.
- System-Owned Project Files remain protected.

### Phase 8: Add More Delivery Adapters And Local Agents

- Keep WiFi OTA and BLE OTA as first delivery adapters.
- Add serial `idf.py flash` or local-agent bridge later.
- Consider MCP only after the internal workflow contracts are stable.

Exit criteria:

- Firmware delivery is an adapter behind a common interface.
- The workflow can choose delivery based on available device connection.

## What To Avoid

- Do not make VibeBoard a generic multi-framework tool yet. The product is
  stronger while it is ESP-IDF-first and board-aware.
- Do not let AI write System-Owned Project Files by default.
- Do not rely on parsing Markdown code blocks for project mutation.
- Do not put build, flash, and repair logic inside UI components long term.
- Do not copy `.claude/skills` as the product architecture. Use the skill
  contract idea, not the installer shape.

## First Implementation Slice

The smallest useful code slice after this document is:

1. Add `src/domain/program/manifestSchema.js`.
2. Add `src/domain/program/validateManifest.js`.
3. Add a new generation prompt that produces a Program Manifest.
4. Add tests for manifest validation.
5. Keep existing file generation as the second stage.

That slice gives VibeBoard a real seam between natural language and source code
without breaking the current compile and OTA path.
