# VibeBoard

VibeBoard is a local-agent hardware execution and verification console. Local
coding agents such as Codex and Claude Code edit firmware in the user's repo;
VibeBoard provides the board context, MCP tools, compiler services, local
bridge flows, flashing, preview rendering, logs, readback verification, and
evidence reports that prove what actually ran on hardware.

The browser app is not the AI code-generation surface. It is the hardware
console for compile status, flashing, OTA, local bridge readiness, logs,
preview, readback verification, evidence export, and MCP activity.

Public deployment:

```text
http://150.158.146.192:6054/
```

The current product focus is narrow by design:

- ESP32-S3: compile, USB / OTA delivery, device evidence, and evidence report
  export.
- Huangshan Pi / SiFli SF32LB52: server/local bridge compile, local bridge
  flash, LVGL preview, serial monitor, flash readback verification, and
  evidence report export.
- Nordic nRF52840: visible as an experimental/basic workspace, not yet the same
  sellable full verification path as ESP32-S3 and Huangshan Pi.
- Write boundary: local agents write application source; VibeBoard owns trusted
  board/project assembly, build files, BSP files, dependencies, sdkconfig, flash
  metadata, and evidence.

## Workflow

```text
Local coding agent
  -> VibeBoard MCP tools
  -> trusted board/project assembly
  -> compiler / preview / delivery / bridge services
  -> Build Evidence / Flash Evidence / Device Evidence / Preview Evidence
  -> exported evidence report
  -> local agent repairs source files
```

## Start Here

- [docs/README.md](./docs/README.md): documentation index.
- [docs/project-map.md](./docs/project-map.md): repository map and ownership
  boundaries.
- [CONTEXT.md](./CONTEXT.md): product boundary and domain language.
- [docs/development-plan.md](./docs/development-plan.md): current engineering
  roadmap.
- [AGENTS.md](./AGENTS.md): rules for AI/code agents working in this repo.

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

`localhost` is a browser secure context, so Web Serial can be used during local
development. Full local setup details are in
[docs/guides/local-development.md](./docs/guides/local-development.md).

## Main Directories

| Path | Purpose |
| --- | --- |
| `src/` | React/Vite browser app. |
| `src/context/boards/` | Board profiles, capability skills, and driver contracts. |
| `src/domain/` | Program intent, manifest, workflow, evidence, digital twin, and Huangshan domain logic. |
| `src/utils/` | Browser-side adapters for AI, compiler, flash, OTA, BLE, and validation. |
| `backend/compiler-service/` | ESP-IDF build service and firmware build templates. |
| `backend/mcp-server/` | Local stdio MCP server for Codex, Claude Code, and other local agents. |
| `backend/lvgl-sim-service/` | LVGL simulation service boundary. |
| `backend/huangshan-service/` | Huangshan Pi local service boundary. |
| `deploy/` | Deployment config and HTTPS USB flashing notes. |
| `docs/` | Architecture, guides, plans, board notes, and business material. |
| `scripts/` | Focused test and helper scripts. |

## Common Commands

```bash
npm run build
npm run test:evidence-package
npm run test:no-web-code-generation-ui
npm run test:no-legacy-web-agent-docs
npm run test:huangshan-device-actions
npm run test:compile-package
npm run test:compiler-security
npm run test:project-validation
npm run test:program-manifest
npm run test:hardware-workflow
```

More focused test groups are listed in
[docs/guides/local-development.md](./docs/guides/local-development.md).

## Hardware And Delivery Guides

- [ESP32-S3 5 minute demo](./docs/guides/esp32-s3-5-minute-demo.md)
- [Huangshan Pi 5 minute demo](./docs/guides/huangshan-pi-5-minute-demo.md)
- [Sales demo](./docs/guides/sales-demo.md)
- [Huangshan Pi native architecture](./docs/huangshan-native-architecture.md)
- [USB flashing](./docs/guides/flashing.md)
- [WiFi, remote, and BLE OTA](./docs/guides/ota.md)
- [Compiler service](./docs/guides/compiler-service.md)
- [HTTPS Web Serial deployment](./deploy/HTTPS_USB_FLASH.md)
- [Digital twin architecture](./docs/digital-twin-architecture.md)

## License

See [LICENSE](./LICENSE).
