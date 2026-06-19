# Agent MCP Hardware Console Design

Date: 2026-06-19

## Purpose

VibeBoard should stop hosting a browser-based AI code-generation agent. The
browser chat flow has poor generation quality because it lacks the local
workspace context, file-system control, iterative editing tools, and terminal
feedback that local coding agents already have.

The new architecture is:

```text
Codex / Claude Code / local coding agent
  -> VibeBoard MCP server
  -> compiler, flasher, preview, and evidence services
  -> VibeBoard web console for visibility and manual control
```

The browser remains valuable as a hardware console: it can show build status,
firmware artifacts, USB flashing state, OTA progress, device logs, and preview
rendering. It should not be the place where AI writes or repairs code.

## Product Boundary Change

### Removed From The Web Product

- Browser-hosted AI chat as the primary code-generation interface.
- Browser API-key and model configuration as first-run product setup.
- Browser-internal source repair and build repair loops.
- UI paths that imply the web app owns the coding agent workflow.

### Kept In The Web Product

- Project file viewing and light editing when useful for inspection.
- Board and platform selection.
- Compile controls and build evidence display.
- USB flash, WiFi OTA, BLE OTA, Nordic DFU, and delivery evidence display.
- Device logs, serial/WebSocket capture, and Device Evidence display.
- Digital Twin, semantic preview, and LVGL render status.
- A visible MCP activity panel showing recent tool calls, artifacts, and
  hardware state.

### Moved To Local Agents

- Natural-language program generation.
- Source-file edits.
- Build-failure repair.
- Runtime-log diagnosis and source patching.
- Multi-step agent planning.

Local agents can still use VibeBoard's board facts, manifests, validation, build
evidence, device evidence, and preview evidence. They access those through MCP
tools instead of a browser chat component.

## Architecture

### Runtime Shape

```text
local repo checkout
  |
  |  MCP stdio
  v
backend/mcp-server/
  |-- reads project files from explicit workspace paths
  |-- calls compiler service
  |-- calls preview service
  |-- coordinates artifacts and evidence
  |-- emits status events
  |
  +--> backend/compiler-service/
  +--> backend/lvgl-sim-service/
  +--> optional browser bridge for Web Serial / Web Bluetooth
  +--> later web console status channel
```

The MCP server is a local Node stdio service, not a browser-only server. It can
safely interact with local files, child processes, Docker-backed services, and
artifact directories. A browser console status channel can be added later, after
the MCP tool contracts are stable.

### Why Node MCP Server First

- MCP clients such as Codex and Claude Code need a stable local tool server.
- Stdio MCP is the first transport. HTTP or WebSocket status APIs are a later
  console integration, not part of the first tool contract.
- Local agents already operate on the repo checkout; MCP tools can accept
  explicit workspace paths and return structured evidence.
- Build and preview operations produce artifacts that are easier to manage from
  a local process than from browser storage.
- Browser Web Serial and Web Bluetooth are still useful, but they are capability
  bridges, not the primary agent integration surface.

## First MCP Tool Set

The first implementation should expose a small, stable tool set. It should not
try to recreate the old browser Agent workflow.

### `vibeboard.compile_project`

Input:

```json
{
  "workspacePath": "/absolute/path/to/project",
  "boardId": "szpi_esp32s3",
  "selectedSkills": ["lvgl", "wifi"],
  "projectId": "optional-stable-id"
}
```

Output:

```json
{
  "status": "success",
  "artifact": {
    "firmwarePath": "/absolute/path/to/firmware.bin",
    "flashManifestPath": "/absolute/path/to/flash-manifest.json",
    "size": 123456
  },
  "buildEvidence": {
    "status": "success",
    "errorCategory": null,
    "logExcerpt": "...",
    "failingFile": null,
    "failingLine": null
  }
}
```

The tool uses VibeBoard's existing project assembly boundary: local agents may
write Application Source, while VibeBoard owns System-Owned Project Files.

### `vibeboard.get_build_evidence`

Returns the latest structured Build Evidence for a project or artifact id. This
lets the agent repair source files using compiler output without scraping UI
logs.

### `vibeboard.flash_usb`

Flashes a built artifact over USB when a browser bridge or local serial flashing
backend is available. If browser permission is required, the tool returns a
blocked result with an instruction for the web console to complete pairing.

### `vibeboard.flash_wifi_ota`

Runs local or remote WiFi OTA against a known device endpoint. The tool returns
Delivery Evidence rather than free-form text.

### `vibeboard.flash_ble_ota`

Runs BLE OTA when a bridge is available. If browser Bluetooth permission is
required, the tool returns a blocked result with bridge status.

### `vibeboard.render_lvgl_preview`

Builds or requests the strongest available preview artifact:

- `semantic` when only manifest/source inference is available.
- `real-lvgl-headless` when the LVGL sim service can produce a framebuffer or
  browser-renderable artifact.
- `unavailable` with diagnostics when the service is not reachable.

### `vibeboard.collect_device_evidence`

Collects logs, OTA results, BLE delivery results, device info, resets, crashes,
and user-provided symptoms into a structured Device Evidence object.

## Web Console Changes

### Replace Chat With Activity And Evidence

The right panel should stop presenting "AI 工作流" as a browser chat surface. It
should become:

- `Build`: compile status, artifact metadata, Build Evidence.
- `Device`: serial/WebSocket logs, Device Evidence, delivery results.
- `Preview`: semantic/real preview status and artifacts.
- `MCP`: recent tool calls, active bridge status, last artifact ids, connection
  state.

### Settings

AI provider settings should be removed from the main web app. Settings should
focus on:

- compiler service URL
- MCP server URL/status
- preview service URL
- bridge capabilities
- default board/platform

### Repair Buttons

Buttons that currently route build failures or logs into `ChatPanel` should be
replaced with evidence export actions:

- copy Build Evidence JSON
- copy Device Evidence JSON
- save evidence package
- show "Use your local agent with VibeBoard MCP to repair this"

## Migration Plan

### Slice 1: Document And Flag The Boundary

- Update README, CONTEXT, and development plan to state that web AI generation
  is deprecated.
- Add a product flag that hides `ChatPanel` by default.
- Rename visible UI labels from "AI 工作流" to hardware-console terms.

### Slice 2: Extract Evidence Export Paths

- Add pure helpers that package Build Evidence, Device Evidence, selected board,
  selected skills, manifest, artifact metadata, and source fingerprints.
- Replace "AI repair" callbacks with export/copy/save actions.
- Keep existing compile and log behavior working.

### Slice 3: Introduce Local MCP Server Skeleton

- Create `backend/mcp-server/`.
- Add a Node stdio MCP server entrypoint with `vibeboard.health` and
  `vibeboard.list_capabilities`.
- Add a shared status/artifact store.
- Add tests for tool input validation and output shapes.

### Slice 4: Wire Compile Tool

- Reuse existing compile-package and project-assembly semantics.
- Call the existing compiler service.
- Return artifact metadata plus Build Evidence.
- Add tests for successful compile response mapping and failed compile evidence.

### Slice 5: Wire Preview And Evidence Tools

- Expose preview request packaging through MCP.
- Expose Device Evidence packaging through MCP.
- Keep browser bridge integration behind explicit blocked/available states.

### Slice 6: Remove Browser Agent Surface

- Remove `ChatPanel` from the default product path.
- Remove browser AI settings from first-run UX.
- Keep old generation code only if needed for tests or migration, marked as
  deprecated and unreachable from the default UI.

## Non-Goals

- Do not implement a new AI coding agent inside VibeBoard.
- Do not let MCP tools write arbitrary System-Owned Project Files.
- Do not require the browser to be open for compile-only MCP tools.
- Do not require real hardware to validate the first compile/evidence slices.
- Do not generalize every platform before the ESP-IDF compile tool is stable.

## Testing Strategy

- Unit-test evidence packaging and MCP input validation with Node scripts.
- Use fake compiler/preview adapters for MCP server tests before calling real
  services.
- Keep `npm run build` passing after UI label and routing changes.
- Keep existing compiler-security and compile-package tests as guardrails for
  the Application Source vs System-Owned Project File boundary.
- Add manual verification only for browser bridge flows that require Web Serial
  or Web Bluetooth permission.

## Open Decisions

The first implementation should assume the local Node MCP server is authoritative
for compile, preview, artifact, and evidence tools over stdio MCP. USB and BLE
delivery may initially return a blocked bridge-required result until the browser
bridge is connected and permissioned.

Huangshan and Nordic tools should not be part of the first MCP slice unless the
ESP-IDF compile tool boundary is already stable. They should reuse the same tool
result vocabulary later.
