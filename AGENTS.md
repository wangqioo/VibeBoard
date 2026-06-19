# VibeBoard

VibeBoard is an ESP-IDF-first hardware console and local-agent integration layer.

Read these files before changing architecture or generation behavior:

- [CONTEXT.md](CONTEXT.md) for product boundary and domain language.
- [README.md](README.md) for current features and local run instructions.
- [docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md](docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md) for the current MCP hardware-console architecture.

Important current rules:

- Treat SZPI ESP32-S3 + ESP-IDF as the current supported product line.
- Local coding agents may write Application Source under `main/`.
- VibeBoard owns System-Owned Project Files such as `CMakeLists.txt`,
  `sdkconfig.defaults`, `main/idf_component.yml`, `partitions.csv`, BSP files,
  and compiler templates.
- Do not add new browser-hosted code-generation or repair flows.
- Build, flash, logs, preview, MCP activity, and evidence are part of one
  hardware-console workflow; local agents repair source files through MCP
  evidence and tools.
