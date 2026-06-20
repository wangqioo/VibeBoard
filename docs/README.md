# VibeBoard Documentation

This directory holds durable project material: architecture notes, guides,
board references, implementation plans, and business documents. Keep the root
README short; add details here.

## Reading Order

1. [Optimized development plan](./development-plan.md): current product
   roadmap for selling VibeBoard as a local-agent hardware execution and
   verification console.
2. [Agent MCP hardware console design](./superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md): current architecture.
3. [Project map](./project-map.md): repository structure and ownership boundaries.
4. [Legacy web-agent archive](./archive/legacy-web-agent/): historical docs superseded by the MCP console pivot.
5. [Context](../CONTEXT.md): product boundary and domain vocabulary.
6. [Digital twin architecture](./digital-twin-architecture.md): preview fidelity
   ladder from semantic preview to real LVGL and hardware evidence.

## Guides

- [Local development](./guides/local-development.md)
- [USB flashing](./guides/flashing.md)
- [OTA workflows](./guides/ota.md)
- [Compiler service](./guides/compiler-service.md)
- [Nordic nRF build and browser DFU](./guides/nordic.md)
- [HTTPS USB flashing deployment](../deploy/HTTPS_USB_FLASH.md)

## Architecture And Product Notes

- [Agent skill integration](./agent-skill-integration.md)
- [Agent MCP hardware console design](./superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md)
- [LVGL preview runner](./lvgl-preview-runner.md)
- [Agent domain notes](./agents/domain.md)
- [Issue tracker agent notes](./agents/issue-tracker.md)
- [Triage labels](./agents/triage-labels.md)

## Board References

The current product line is SZPI ESP32-S3 first, but earlier board research is
kept for reference.

- [ESP32-P4-WIFI6-Touch-LCD-3.5](./boards/ESP32-P4-WIFI6-Touch-LCD-3.5.md)
- [ESP32-S3-ePaper-1.54](./boards/ESP32-S3-ePaper-1.54.md)
- [ESP32-S3-RLCD-4.2](./boards/ESP32-S3-RLCD-4.2.md)
- [ESP32-S3-Touch-AMOLED-1.43C](./boards/ESP32-S3-Touch-AMOLED-1.43C.md)
- [ESP32-S3-Touch-AMOLED-1.8](./boards/ESP32-S3-Touch-AMOLED-1.8.md)
- [Seeed XIAO nRF52840 Sense](./boards/Seeed_XIAO_nRF52840_Sense.md)

## Plans And Specs

- [Optimized development plan](./development-plan.md)
- [Huangshan workspace plan](./superpowers/plans/2026-06-09-huangshan-workspace.md)
- [Agent MCP hardware console pivot plan](./superpowers/plans/2026-06-19-agent-mcp-hardware-console.md)
- [Agent MCP hardware console design](./superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md)
- [Huangshan workspace spec](./superpowers/specs/2026-06-09-huangshan-workspace-design.md)

## Business Material

- [Business plan](./business/business-plan.md)
- [Professional business plan](./business/professional-business-plan.md)
- [Strategy summary](./business/strategy-summary.md)
- [Pitch deck](./business/pitch-deck.pptx)

## Documentation Rules

- Put operation steps in `docs/guides/`.
- Put long-term architecture and product language in top-level docs files.
- Put dated implementation plans under `docs/superpowers/`.
- Keep local generated outputs, build artifacts, and exported zips out of docs.
- Avoid duplicating full instructions in the root README; link to the guide
  instead.
