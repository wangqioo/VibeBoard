# VibeBoard Agent Context

## Project Overview

VibeBoard is an ESP-IDF-first hardware console and local-agent integration layer
for the SZPI ESP32-S3 board family. The web app is the console for compile
status, firmware delivery, logs, preview, evidence, and MCP activity. Code
generation and source repair happen in local agents such as Codex and Claude
Code.

Do not build new in-browser code generation or repair flows. VibeBoard exposes
hardware operations and evidence through a local Node stdio MCP server and the
browser console.

## Current Architecture

Read
`docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`
before changing architecture or implementation guidance.

```text
Codex / Claude Code / local coding agent
  -> backend/mcp-server/
  -> compiler, preview, delivery, and evidence services
  -> VibeBoard web console for visibility and manual control
```

## Target Hardware

**Board:** Lichuang SZPI ESP32-S3
**Module:** ESP32-S3-WROOM-1-N16R8 with 16MB flash and 8MB Octal PSRAM
**Framework:** ESP-IDF v5.4
**BSP:** `esp32_s3_szp.h` / `esp32_s3_szp.c`

Key hardware facts are defined in
`src/context/boards/szpi_esp32s3/definition.js` and related capability skills.

## Ownership Boundary

- Local agents may write Application Source under `main/`.
- VibeBoard owns System-Owned Project Files such as `CMakeLists.txt`,
  `sdkconfig.defaults`, `main/idf_component.yml`, `partitions.csv`, BSP files,
  compiler templates, and generated simulator glue.
- MCP tools should return structured Build Evidence, Device Evidence, artifact
  metadata, preview status, and blocked bridge states.
- The browser app displays and controls hardware operations; it is not the
  coding agent host.

## Main Source Areas

```text
src/                         React/Vite hardware console
src/context/boards/          Board profiles and capability skills
src/domain/                  Product domain modules and evidence types
src/utils/                   Browser-side compiler, flash, OTA, BLE, preview adapters
backend/mcp-server/          Local stdio MCP server for local coding agents
backend/compiler-service/    ESP-IDF compiler and firmware templates
backend/lvgl-sim-service/    LVGL preview service boundary
backend/huangshan-service/   Huangshan Pi service boundary
docs/                        Durable architecture, guides, plans, and references
scripts/                     Focused test and helper scripts
```

## Development

```bash
npm install --include=dev
npm run dev
npm run build
```

## Verification Focus

Use focused tests for the area being changed. For MCP-console work, prefer:

```bash
npm run test:compiler-security
npm run test:compile-package
npm run test:project-config
npm run test:evidence-package
npm run test:mcp-server-capabilities
npm run test:no-legacy-web-agent-docs
```

## Deployment Notes

The production frontend is baked into the Docker image at build time. After
building `dist/`, copy files into the running container or rebuild/recreate the
container so nginx serves the new assets.
