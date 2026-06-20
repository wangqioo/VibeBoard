# VibeBoard Optimized Development Plan

This plan is the current product roadmap after the web-agent pivot. It replaces
the old browser AI code-generation direction with a hardware execution and
verification console built around local coding agents.

## Product Thesis

VibeBoard should not compete with Codex, Claude Code, Cursor, or other local
coding agents. Those tools write and repair firmware in the user's repo.
VibeBoard sells the missing embedded-hardware layer: trusted board context,
compile, flash, preview, logs, readback, and evidence that proves the code
really ran on a device.

The product loop is:

```text
Local coding agent edits firmware
  -> VibeBoard web console triggers action
  -> server compiler or local bridge compiles
  -> local bridge flashes and monitors USB devices
  -> VibeBoard records Build / Flash / Device Evidence
  -> local coding agent uses evidence to repair source
```

## Current Verified Baseline

- Web-side AI code generation is no longer the product surface. Browser AI
  prompts and legacy docs are archived or guarded from active workflows.
- The public web app is deployed at `http://150.158.146.192:6054/`.
- ESP32-S3 has a verified real compile, USB flash, and serial-log path through
  MCP/local tooling.
- Huangshan Pi / SiFli SF32LB52 has a verified real compile and local bridge
  flash path. A flash readback of `main.bin` matched the local build artifact
  byte-for-byte by SHA256.
- The Huangshan web workspace can target either the server service or a local
  bridge URL such as `http://127.0.0.1:8771`.
- Nordic exists as an early workspace, but it is not part of the near-term
  sellable MVP.

## Product Boundaries

### In Scope

- Local-agent integration through MCP and repo files.
- Web console actions: build, flash, monitor, preview, evidence, artifacts, and
  diagnostics.
- Server compile services for workflows that do not need the user's USB.
- Local bridge services for USB flash, serial logs, readback, and optional
  local builds.
- First-class support for ESP32-S3 and Huangshan Pi as the sellable hardware
  samples.

### Out Of Scope For The MVP

- Browser-hosted AI code generation.
- A general-purpose cloud IDE.
- Multi-user project management.
- Broad chip expansion before ESP32-S3 and Huangshan Pi are polished.
- Nordic productization until the two primary samples feel reliable.

## Target Customer

1. **Development board vendors**
   - Value: make boards easier to demonstrate, support, and validate.
   - Outcome: "plug in board, start bridge, compile, flash, prove it runs."

2. **AI hardware courses and labs**
   - Value: students use local agents to write code while instructors get
     consistent build and device evidence.
   - Outcome: assignments can be checked against real hardware traces.

3. **Embedded teams**
   - Value: standardize flashing, logs, artifact metadata, and acceptance
     evidence across developers.
   - Outcome: fewer environment-specific scripts and better repair loops.

## Roadmap

### Phase 1: Product Shape Cleanup

**Goal:** make the repo, docs, and UI unmistakably describe the new product.

- Remove or archive active docs that still position VibeBoard as a browser AI
  coding agent.
- Keep `src/utils/codeGeneration.js` only as legacy support until remaining ESP
  UI paths no longer import it.
- Rename visible "Legacy Agent" surfaces where they remain, or make them
  clearly secondary/debug-only.
- Make every hardware workspace show whether actions target `SERVER` or
  `LOCAL`.
- Keep Nordic visible only as experimental if it remains in the UI.

**Acceptance:**

- `npm run test:no-legacy-web-agent-docs` passes.
- A new reader can understand from `README.md`, `CONTEXT.md`, and this file that
  local agents write code and VibeBoard executes hardware workflows.
- The web app does not advertise browser AI generation as a primary workflow.

### Phase 2: Local Bridge Productization

**Goal:** turn local bridge from a developer command into a product capability.

- Define a shared bridge health contract:
  - service online/offline
  - host OS
  - available toolchains
  - SDK path checks
  - flasher tool checks
  - serial ports
  - supported board families
  - last action summary
- Add web bridge auto-detection for `http://127.0.0.1:8771`.
- Add clear bridge states:
  - not running
  - connected
  - missing SDK
  - missing flasher
  - no device
  - device ready
  - action running
- Add copyable start commands for ESP and Huangshan.
- Add CORS and OPTIONS tests for every local bridge service.

**Acceptance:**

- With no bridge running, the UI explains what is missing and how to start it.
- With a bridge running but no board attached, the UI shows "no device" rather
  than a generic error.
- With `/dev/cu.usbserial-*` or ESP USB serial present, the UI marks the device
  ready and selects the recommended port.

### Phase 3: ESP32-S3 Sellable Sample

**Goal:** make one ESP32-S3 board path reliable enough for a sales demo.

- Pick one primary ESP32-S3 board profile for MVP messaging.
- Keep server compile working for the selected board.
- Keep local USB flash working through MCP/local flasher.
- Add a device verification action that captures either:
  - boot serial marker, or
  - flash/readback hash, or
  - LVGL/display runtime marker when available.
- Add diagnostics for:
  - wrong port
  - port busy
  - board not in bootloader
  - missing `esptool.py`
  - compiler service unavailable
  - generated source compile failure

**Acceptance:**

- Demo path completes: compile -> flash -> verify -> evidence report.
- A failed flash returns a specific repair hint.
- Build Evidence and Device Evidence are available to MCP tools and visible in
  the web console.

### Phase 4: Huangshan Pi Sellable Sample

**Goal:** turn the already verified Huangshan Pi path into a polished workflow.

- Keep the server Huangshan build service available for online compile.
- Keep the local bridge path available for compile, flash, serial, and readback.
- Add a web "readback verify" action for:
  - `bootloader/bootloader.bin@0x12010000`
  - `main.bin@0x12020000`
  - `ftab/ftab.bin@0x12000000`
- Store readback SHA256 values in Flash Evidence.
- Add UI hints when serial monitoring has no logs:
  - try reset
  - check baud
  - confirm app emits logs
- Add 3-5 real examples:
  - LVGL status screen
  - GPIO output
  - ADC readout
  - UART echo
  - sensor dashboard where supported by the board data

**Acceptance:**

- Demo path completes: build -> flash -> readback verify -> evidence report.
- The UI can prove that board flash contents match the build artifact.
- Huangshan examples avoid claiming unsupported hardware behavior as real.

### Phase 5: Evidence Reports

**Goal:** make verification the product differentiator.

- Define `BuildEvidence`, `FlashEvidence`, `DeviceEvidence`, and
  `PreviewEvidence` as user-facing concepts.
- Add a run history model for each workflow attempt.
- Show artifact metadata:
  - file name
  - size
  - SHA256
  - flash address when relevant
  - source fingerprint or commit
- Show tool metadata:
  - compiler toolchain
  - flasher command
  - bridge/server target
  - board profile
  - elapsed time
- Export a single markdown or JSON report for a completed run.

**Acceptance:**

- A user can export a report that proves what was built, what was flashed, and
  what device evidence was captured.
- Local agents can consume the same evidence without scraping the UI.

### Phase 6: Onboarding And Sales Demo

**Goal:** make a buyer understand and run the product in minutes.

- Add a "5 minute ESP32-S3 demo" guide.
- Add a "5 minute Huangshan Pi demo" guide.
- Add bridge install/start instructions for macOS first.
- Add a short sales demo script:
  1. open VibeBoard
  2. start local bridge
  3. attach board
  4. compile
  5. flash
  6. verify
  7. export evidence
- Update business material to sell the hardware verification layer, not browser
  AI coding.

**Acceptance:**

- A new developer can follow one guide and get a real board verified.
- The pitch clearly says VibeBoard complements local coding agents instead of
  replacing them.

## Technical Workstreams

### Bridge

- `backend/huangshan-service/`: keep as the first concrete local bridge.
- Add shared health schema and tests.
- Consider a unified bridge entrypoint once ESP and Huangshan contracts match.

### Web Console

- `src/components/HuangshanWorkspace.*`: promote bridge state and readback
  verification.
- ESP compile/flash panels: add the same bridge-state vocabulary.
- `src/components/McpPanel.jsx`: show tool status and recent evidence.

### MCP

- Keep MCP tools focused on evidence-backed actions.
- Add or refine tools only when the matching web/backend path is already
  verified.
- Return blocked states instead of pretending hardware access is available.

### Documentation

- Active docs should point to this roadmap and the MCP hardware-console design.
- Legacy web-agent material should remain archived, not mixed into the current
  reading path.
- Guides should be task-based, not architecture essays.

## Near-Term Implementation Order

1. Audit active docs and UI labels for stale browser-agent language.
2. Add a shared bridge status vocabulary and Huangshan bridge health UI.
3. Add Huangshan readback verification to the web UI.
4. Add ESP32-S3 device verification parity.
5. Add evidence report export.
6. Add two 5-minute demo guides.
7. Update business material around the hardware verification console thesis.

## Verification Commands

Run focused checks for the touched area, then the core guards:

```bash
npm run test:no-legacy-web-agent-docs
npm run test:mcp-server-capabilities
npm run test:evidence-package
npm run test:huangshan-workspace-ui
npm run test:huangshan-device-actions
npm run test:huangshan-app-template
npm run test:huangshan-app-builder
npm run build
```

Hardware verification is required before claiming a platform is product-ready.
For Huangshan Pi, product-ready means readback hashes match flashed artifacts.
For ESP32-S3, product-ready means a real flash plus boot/readback evidence.
