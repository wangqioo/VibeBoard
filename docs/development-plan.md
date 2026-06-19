# VibeBoard Development Plan

This plan tracks the engineering path for the MCP hardware-console pivot. It
should stay practical: every major item needs a clear user value, a bounded
implementation surface, and a way to verify it.

## Product Goal

VibeBoard should let local coding agents generate and repair firmware in the
user's repo while VibeBoard provides trusted board context, ESP-IDF project
assembly, compiler access, delivery operations, preview rendering, and
structured build/device evidence through MCP tools and the web console.

The target loop is:

```text
Local coding agent
  -> VibeBoard MCP tools
  -> trusted board/project assembly
  -> compiler / preview / delivery services
  -> Build Evidence / Device Evidence
  -> local agent repairs source files
```

## Current Baseline

- ESP32-S3 / ESP-IDF is the mature platform track.
- Local agents write application source; VibeBoard owns system project files.
- The compiler service rejects or ignores client-controlled build files and
  generates `main/CMakeLists.txt`, `main/idf_component.yml`,
  `sdkconfig.defaults`, and `partitions.csv` from trusted skill metadata.
- Official SZPI examples, OTA receiver firmware, BLE OTA receiver firmware, USB
  flashing, and WiFi/BLE OTA flows exist.
- Program Intent, Program Manifest, Build Evidence, Hardware Workflow, and
  Digital Twin domain modules exist, but MCP-facing evidence export still needs
  to become the main integration path.
- Huangshan Pi support has a first independent workspace slice under
  `src/domain/huangshan/`, `backend/huangshan-service/`, and
  `src/components/HuangshanWorkspace.*`.
- The browser preview is still primarily semantic; real LVGL runtime preview is
  incomplete.

## Development Principles

- Keep ESP32-S3 / ESP-IDF stable before expanding broadly.
- Preserve the write boundary: local agents may patch application source, not
  system-owned build files or BSP files.
- Prefer small, test-backed changes around one workflow at a time.
- Treat real hardware logs and compiler output as first-class MCP evidence.
- Keep Huangshan independent until its build, flash, preview, and device
  evidence loops are proven.
- Move durable explanations into `docs/`; keep `README.md` short.

## Current Development Phases

1. **MCP console pivot**: archive legacy web-agent docs, hide browser chat generation, and make active docs point to the MCP hardware-console architecture.
2. **Evidence export**: package Build Evidence, Device Evidence, artifacts, board selection, and source fingerprints for local agents.
3. **MCP server skeleton**: expose `vibeboard.health` and `vibeboard.list_capabilities` over local stdio MCP.
4. **Compile tool**: expose ESP-IDF compile through MCP while preserving the Application Source vs System-Owned Project File boundary.
5. **Preview and delivery tools**: expose LVGL preview, USB/WiFi/BLE delivery, and blocked bridge states.
6. **Platform expansion**: add Huangshan and Nordic MCP tools only after ESP-IDF compile is stable.

## Acceptance

- Active docs point to `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md` for current architecture.
- The web console presents compile, delivery, preview, evidence, and MCP
  activity as the current product surface.
- Local MCP tools return structured Build Evidence, Device Evidence, artifact
  metadata, and blocked bridge states that local agents can use for repair.

## Current Verification Focus

```bash
npm run test:compiler-security
npm run test:compile-package
npm run test:project-config
npm run test:official-examples-backend
npm run test:evidence-package
npm run test:mcp-server-capabilities
npm run test:no-legacy-web-agent-docs
```
