# Huangshan Workspace Design

Date: 2026-06-09

## Purpose

VibeBoard should grow from a single ESP-IDF web board into a platform that can
host multiple board workspaces. The Huangshan Pi should join the platform as an
independent workspace, not as a forced ESP-IDF-compatible board option.

The first Huangshan workspace must preserve the real development model:

```text
LCKFB Huangshan Pi
  -> SF32LB52 / SiFli SDK release/v2.4
  -> RT-Thread + SCons
  -> LVGL watch launcher / GUI app modules
  -> CH340 UART flash and logs
```

The goal is to reuse VibeBoard's web-board ideas: board context, AI write
surface control, generated app templates, build logs, flashing/log evidence, and
repair loops. The goal is not to make SiFli look like ESP-IDF.

## Source Of Truth

Use three source layers, in this order:

1. Local verified Huangshan workspace:
   `/Users/wq/huangshan-pi-workspace/huangshan-pi-sf32-dev`
2. Local SiFli SDK:
   `/Users/wq/huangshan-pi-workspace/sifli-sdk`, branch `release/v2.4`
3. LCKFB example repository:
   `/Users/wq/huangshan-pi-workspace/lckfb-hspi-ulp_example`

The SiFli SDK is the board and driver fact source. Important paths include:

```text
customer/boards/sf32lb52-lchspi-ulp/
customer/peripherals/co5300/
customer/peripherals/ft6146/
customer/peripherals/sensor/LSM6DSL/
customer/peripherals/sensor/LTR303/
customer/peripherals/charger/
example/multimedia/lvgl/
example/rt_device/
example/ble/
example/pm/
example/storage/
```

The LCKFB examples are the practical application-template source. Important
paths include:

```text
lvgl/watch
lvgl/lvgl_v8_demos
lvgl/lvgl_v9_demos
RT-Device/sensor
I2C/charger
gpio
uart
ws2812
```

The local Huangshan workspace is the integration source because it already has
working scripts, a copied watch-app structure, and the verified `Codex_Test`
app.

The local SiFli SDK currently contains bring-up changes. Treat
`customer/peripherals/co5300/co5300.c` as a required board bring-up patch unless
later validation proves that upstream fixed the panel ID and LCDC sync behavior.

## Board Profile Facts

The first profile is:

```text
id: huangshan_pi_sf32lb52
name: LCKFB Huangshan Pi / 立创黄山派
module: SF32LB52x-MOD-1-N16R8
chip: SF32LB525UC6
target board: sf32lb52-lchspi-ulp
framework: SiFli SDK release/v2.4 + RT-Thread + SCons
display: 1.85 inch AMOLED, 390x450, Quad SPI, CO5300AF-01
touch: FT6146-M00
memory: 576KB SRAM, 8MB OPI PSRAM, 16MB QSPI NOR Flash
debug/flash: CH340N USB UART
local serial default: /dev/cu.usbserial-110
log baud: 1000000
```

Hardware capabilities captured in the profile:

```text
lvgl_display: CO5300 AMOLED + FT6146 touch, 390x450
sensor_imu: LSM6DS3TR-C
sensor_magnetometer: MMC5603NJ
sensor_light: LTR-303ALS-01
audio_input: MEMS microphone
audio_output: Class-D PA, external speaker connector
storage_tf: SPI TF card slot
rgb_led: WS2812B-2020
keys: function key, power/reset key
motor: board motor driver pads
charger: AW32001ECSR path plus power-management parts
uart_debug: CH340N
usb_fs: USB 2.0 FS exposed through expansion connector
```

The board profile must include known bring-up caveats:

- The CO5300 panel may read `0x331100`, `0x1fff`, or `0x3fff`.
- The verified local path uses `HAL_LCDC_SYNC_DISABLE`.
- Normal runtime requires the documented power-measurement jumpers to be
  shorted.
- The board is a watch/band prototype form factor, but the workspace must not
  be limited to watch UI products.

## Platform Shape

VibeBoard should contain separate board workspaces:

```text
VibeBoard Platform
  -> ESP32-S3 ESP-IDF Workspace
  -> Huangshan Pi SiFli Workspace
```

The workspaces may share platform shell concepts:

```text
AI settings
chat / generation panel
project file viewer
build log viewer
artifact/evidence display
repair-loop language
```

They must not share framework-specific internals:

```text
ESP-IDF CMake project assembly
idf.py compile path
esptool/Web Serial USB flash
ESP-IDF OTA partition model
SiFli SCons project assembly
SiFli UART download scripts
RT-Thread app registration
HCPU/LCPU board layout
```

Common abstractions should be extracted only after the Huangshan workspace has a
working vertical slice. Early extraction risks damaging the current ESP32-S3
path and producing abstractions that fit neither board well.

## First Vertical Slice

The first implementation target is:

```text
Create Huangshan LVGL app
  -> generate src/gui_apps/<AppName>/main.c
  -> generate src/gui_apps/<AppName>/SConscript
  -> run scripts/build.sh
  -> show build log and errors
```

Optional but not required for the first slice:

```text
run scripts/flash.sh /dev/cu.usbserial-110
run scripts/monitor.sh /dev/cu.usbserial-110
feed serial logs back into AI repair
```

The first slice should use the verified watch launcher app model rather than a
standalone LVGL demo `main()` model. The generated app should follow the
existing pattern:

```text
src/gui_apps/<AppName>/main.c
src/gui_apps/<AppName>/SConscript
BUILTIN_APP_EXPORT(...)
GUI_APP_MSG_ONSTART / ONRESUME / ONPAUSE / ONSTOP
```

The existing `Codex_Test` app is the local golden template.

## Local Agent Write Surface

Status: superseded for browser UX. Huangshan code changes are made by a local
agent such as Codex or Claude Code through the repo/MCP workflow. The web UI
only previews, builds, flashes, and collects evidence.

Local agents may write:

```text
src/gui_apps/<AppName>/main.c
src/gui_apps/<AppName>/SConscript
optional src/gui_apps/<AppName>/*.h
optional src/gui_apps/<AppName>/*.c
```

Local agents must not write by default:

```text
sifli-sdk/
project/SConstruct
project/SConscript
project/Kconfig*
project/proj.conf
project/rtconfig.py
project/rtconfig_project.h
customer/boards/
customer/peripherals/
SDK driver files
CO5300 / FT6146 / board bring-up patches
flash-table or partition files
```

Any workflow that edits SDK, board config, resource tooling, flash layout, or
driver code must be a separate trusted maintenance workflow, not the default
application-generation path.

## Huangshan Capability Skills

First priority:

```text
lvgl_app
```

The `lvgl_app` skill should know:

- Resolution is 390x450.
- The working shell is the watch launcher.
- It should create one app module, not replace the whole firmware.
- App lifecycle is message-driven through the GUI app framework.
- Logging should use `rt_kprintf`.
- UI should avoid oversized desktop layouts and target watch-size ergonomics.

Second priority:

```text
sensor
ws2812
gpio_key
charger
uart
```

Later capabilities:

```text
audio
tf_card
motor
ble
low_power
usb_fs
```

Each capability must cite its local reference example path and expose a compact
driver contract before it is enabled for generation.

## Adapters

The Huangshan workspace needs separate adapters instead of reusing ESP-IDF
adapters.

### Project Adapter

Responsibilities:

- Create a new app module from a safe template.
- Normalize app names into safe directory names and app IDs.
- Enforce write-surface boundaries.
- Insert generated files into the existing Huangshan project layout.
- Keep generated app code separate from SDK and board-owned files.

### Build Adapter

Responsibilities:

- Run `./scripts/build.sh` from the Huangshan workspace.
- Support `SIFLI_SDK_PATH` override.
- Emit structured Build Evidence:
  command, status, raw log tail, error category, likely file, likely line.
- Preserve SiFli/SCons terminology in diagnostics.

### Flash Adapter

Initial responsibility:

- Wrap `./scripts/flash.sh /dev/cu.usbserial-110`.
- Report command, serial port, status, and log tail.

This is optional for the first vertical slice.

### Log Adapter

Initial responsibility:

- Wrap `./scripts/monitor.sh /dev/cu.usbserial-110`.
- Capture boot evidence such as display, touch, and app lifecycle logs.
- Detect app launch evidence:
  `GUI_APP_MSG_RUN_APP`, `do START`, `start`, `resume`.

This is optional for the first vertical slice.

## Data Flow

The first successful flow should be:

```text
User asks for a Huangshan app
  -> workspace selects huangshan_pi_sf32lb52 profile
  -> local agent edits app files only
  -> Project Adapter validates and stages files
  -> Build Adapter runs SCons
  -> Build Evidence is shown in the web UI
  -> local agent can repair only app files
```

Later flow:

```text
Build success
  -> Flash Adapter downloads through CH340 UART
  -> Log Adapter monitors at 1000000 baud
  -> Device Evidence is attached to the conversation
  -> local agent repairs app files
```

## Error Handling

Expected error categories:

```text
sdk-missing
sifli-export-failed
scons-build-failed
write-surface-violation
app-registration-invalid
lvgl-api-mismatch
resource-missing
serial-port-missing
flash-failed
monitor-timeout
board-bringup-patch-missing
```

The UI should distinguish framework errors from AI source errors. For example,
a missing `sifli-sdk/export.sh` is not a code-generation failure. A compile
error in `src/gui_apps/<AppName>/main.c` is repairable by AI.

## Testing Strategy

Add narrow tests before broad UI integration:

```text
test-huangshan-app-template
test-huangshan-write-surface
test-huangshan-build-adapter-log-parser
test-huangshan-capability-profile
```

The tests should cover:

- Safe app-name normalization.
- Rejection of writes outside `src/gui_apps/<AppName>/`.
- Correct `SConscript` generation.
- Correct app lifecycle skeleton generation.
- Build-log parsing for SCons errors.
- Board profile includes display, touch, memory, serial, and target-board facts.

Manual verification for the first full slice:

```text
./scripts/build.sh
./scripts/flash.sh /dev/cu.usbserial-110
./scripts/monitor.sh /dev/cu.usbserial-110
```

The minimum device evidence for a flashed app is:

```text
display on
touch screen found
GUI_APP_MSG_RUN_APP
app[<app_id>] do START
<app log> start
<app log> resume
```

## Non-Goals

First slice non-goals:

- Do not support all SiFli examples.
- Do not unify ESP-IDF and SiFli compile packages.
- Do not port ESP-IDF OTA concepts to Huangshan.
- Do not edit the SiFli SDK from the normal AI app workflow.
- Do not build a generic MCU abstraction before the second workspace works.
- Do not replace the watch launcher until a separate product decision is made.

## Open Decisions

The implementation plan must decide:

1. Whether the Huangshan workspace runs against the existing external local
   workspace or copies a minimal template into VibeBoard.
2. Whether the first UI is a separate route/page or a board-workspace selector
   inside the current app shell.
3. Whether `flash.sh` and `monitor.sh` are included in the first slice or kept
   for the second slice.
4. Whether local patched SiFli SDK state should be documented only, vendored as
   patches, or checked at runtime before build.

Recommended defaults:

1. Run against the external local workspace first.
2. Use a separate Huangshan workspace route/page inside VibeBoard.
3. Build first, flash/monitor second.
4. Add a runtime check for the CO5300 patch and document the required state.
