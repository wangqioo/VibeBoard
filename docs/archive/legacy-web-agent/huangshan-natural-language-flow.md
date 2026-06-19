> Legacy document: superseded by `docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md`. This file is retained for historical context only. Do not use it as current implementation guidance.

# Huangshan Pi Natural-Language Development Flow

This document defines the current Huangshan Pi path inside VibeBoard. Huangshan
uses the SiFli SDK, RT-Thread, and SCons, so VibeBoard keeps a separate
workspace boundary while sharing the same product loop: describe, generate,
preview, build, flash, and inspect evidence. The architecture is native to the
SiFli board/app split; it is not a direct copy of the ESP-IDF `main/` and CMake
model. See [Huangshan Pi Native Architecture](./huangshan-native-architecture.md).

## Source Workspaces

The local service resolves paths in this order:

```text
HUANGSHAN_WORKSPACE
../huangshan-pi-sf32-dev next to the VibeBoard repo
~/huangshan-pi-workspace/huangshan-pi-sf32-dev
/Users/wq/huangshan-pi-workspace/huangshan-pi-sf32-dev
```

```text
SIFLI_SDK_PATH
../sifli-sdk next to the VibeBoard repo
~/huangshan-pi-workspace/sifli-sdk
/Users/wq/huangshan-pi-workspace/sifli-sdk
```

On Windows the service runs `scripts/build.ps1` and expects `export.ps1` in the
SiFli SDK. On macOS and Linux it runs `scripts/build.sh` and expects `export.sh`.

## Generation Contract

Natural-language requests are first converted into a small Huangshan Builder JSON
object, not raw C code. The next architecture step is to compile this Builder
JSON into a Huangshan App Capsule before file generation:

```json
{
  "displayName": "Board Diagnostics",
  "description": "Show display, touch, and timer status.",
  "components": [
    { "type": "status", "capability": "status", "label": "Status", "value": "Ready", "enabled": true }
  ]
}
```

Allowed component types:

```text
status, metric, battery, bluetooth, action
```

Allowed capability values:

```text
status, ambient_light, imu, magnetometer, battery, adc_gpio, bluetooth, key,
gpio_output, led, motor, uart2
```

The Builder then generates only these workspace files:

```text
src/gui_apps/<AppName>/main.c
src/gui_apps/<AppName>/SConscript
project/proj.conf
```

`project/proj.conf` is merged line-by-line so existing board/application config
is preserved. Arbitrary paths, SDK edits, and app utility edits are rejected by
the Huangshan service.

## Build And Device Loop

The intended workflow is:

```text
user prompt
  -> Huangshan Builder JSON
  -> generated LVGL/RT-Thread app files
  -> semantic preview and optional real LVGL render
  -> /huangshan/build
  -> firmware artifact summary
  -> /huangshan/flash
  -> /huangshan/monitor
  -> serial evidence
```

The real board remains the source of truth. A generated app is not considered
done just because the Builder produced C files. The minimum completion evidence
is a successful SCons build. Hardware-facing changes should also collect flash
and serial logs when a board is connected.

## Board Facts To Preserve

Do not duplicate board bring-up facts inside generated apps. The app should
consume the existing Huangshan board support from the SiFli SDK:

```text
target board: sf32lb52-lchspi-ulp
display: CO5300 AMOLED, 390x450
touch: FT6146
launcher app model: src/gui_apps/<AppName> with BUILTIN_APP_EXPORT
```

The known CO5300 bring-up patch is an SDK/environment prerequisite. If the build
or device log indicates missing SDK, LCD ID mismatch, or LCDC timeout, classify
it as environment or board bring-up evidence before asking AI to rewrite app
logic.

## Local Verification

Useful checks:

```powershell
npm run test:huangshan-profile
npm run test:huangshan-app-builder
npm run test:huangshan-workspace-files
npm run test:huangshan-device-actions
npm run test:huangshan-service-health
```

`test:huangshan-service-health` requires a real SiFli SDK checkout. If it fails
only on `sdkExport`, set `SIFLI_SDK_PATH` or clone/install the SDK next to the
VibeBoard repo.
