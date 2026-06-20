# VibeBoard Digital Twin Architecture

## Goal

VibeBoard's digital twin should make generated firmware observable before a user
flashes hardware, without pretending that a sketch preview is a real board
simulation.

The product should converge on this loop:

```text
Local agent writes source through repo/MCP
  -> semantic preview appears immediately
  -> real LVGL runtime preview renders generated UI
  -> board peripheral mocks drive UI state
  -> ESP-IDF build verifies firmware
  -> real board logs calibrate the twin
```

## Fidelity Levels

### L1: Semantic UI Preview

Status: implemented as the current `uiManifest` path.

A local agent or manual edit updates application source plus a `uiManifest`.
The browser renders the manifest inside the device shell without compiling
firmware.

This level is useful for:

- layout review
- product-flow review
- quick button/list/slider/status feedback
- keeping the user moving while the real simulator builds

It is not proof that C/LVGL code compiles or behaves exactly like LVGL.

### Preview Feedback Repair Loop

Status: implemented for current-project preview feedback.

When the user has an editable project open, the local coding agent treats
feedback such as unclear sliders, blocked labels, small buttons, misplaced
widgets, or unresponsive taps as a repair request against the current project
instead of a browser-side generation request. The agent receives the current
application source files, latest Program Manifest, semantic/LVGL preview
context, active file, and recent digital twin logs through the repo or MCP.

The repair loop preserves the write boundary:

- Local agents patch Application Source under `main/`.
- VibeBoard keeps system-owned project files under product control.
- UI repairs should update `main/app_ui.c` / `main/app_ui.h` when LVGL code is
  involved.
- Visual repairs may also return an updated `uiManifest` so the semantic
  preview refreshes immediately while real LVGL preview or firmware validation
  remains the stronger evidence.

### L2: Real LVGL Runtime Preview

Target: next major step.

Compile a host/browser simulator from:

```text
LVGL
generated app_ui.c / app_ui.h
generated UI entry glue
vibeboard_sim_bsp.c / vibeboard_sim_bsp.h
vibeboard_sim_peripherals.c
```

The browser preview should display LVGL's actual framebuffer, not a React
approximation. Touch events from the device shell should feed LVGL input.

Primary backend options:

- Browser: LVGL + Emscripten -> WebAssembly/HTML.
- Local/server: LVGL + SDL -> framebuffer screenshot/stream.

Browser WASM is the preferred user experience because it stays inside the
VibeBoard page. SDL is useful for development and fallback verification.

### L3: SZPI Board Peripheral Mocks

The LVGL runtime needs board-level mocks for APIs used by official examples and
generated code:

| Area | Mock behavior |
| --- | --- |
| LCD/LVGL | 320x240 display, touch input, backlight percentage |
| PCA9557 | LCD CS, PA_EN, DVP_PWDN state |
| WiFi | scan list, connect/fail, IP, heartbeat/OTA state |
| Audio output | SPIFFS track list, play/pause, next/prev, volume, PA_EN |
| Audio input | recording level, WAV file result, feed buffer |
| Camera | virtual frame, test pattern, optional browser camera source |
| IMU | pitch/roll/accel sliders and scripted motion |
| SD/SPIFFS | virtual file tree, mount success/failure |
| BLE HID | connected/disconnected, sent key reports |
| Speech | wake word and command trigger events |
| GPIO | BOOT key press, interrupt count |

Mocks must emit logs in ESP-IDF style so the same repair loop can consume real
device logs and simulated logs.

### L4: Firmware-Level Emulation

Use ESP-IDF QEMU or another firmware emulator for selected flows where chip,
RTOS, panic, and UART behavior matter.

This is not the default preview path because it is slower and does not model the
SZPI board's full external hardware by default.

Good uses:

- task crashes
- boot/panic/log handling
- NVS/init flow
- framebuffer experiments with QEMU graphics

Poor uses:

- exact ES8311/ES7210 audio behavior
- exact QMI8658/GC0308 behavior
- fast per-generation UI iteration

### L5: Real Board Calibration

The real board remains the source of truth.

Every simulator result should be correctable by:

- cloud ESP-IDF build evidence
- USB/OTA flash result
- serial/WebSocket logs
- observed screen/device behavior

Digital twin state should become a repair input, not a replacement for final
hardware validation.

## Reference Stack

- LVGL Browser/Emscripten: compile LVGL UI to browser-capable WebAssembly/HTML.
  https://docs.lvgl.io/master/integration/pc/browser.html
- LVGL PC simulator: run real LVGL apps on PC without a development board.
  https://docs.lvgl.io/9.2/integration/ide/pc-simulator.html
- LVGL SDL driver: cross-platform display/input backend for PC simulation.
  https://docs.lvgl.io/master/integration/pc/sdl.html
- ESP-IDF QEMU: run/debug ESP-IDF applications in QEMU.
  https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-guides/tools/qemu.html

## Implementation Plan

### Phase 1: Make the current preview honest

- Keep `uiManifest` for instant feedback.
- Label it as a semantic preview in the UI.
- Never present it as proof that firmware works.

### Phase 2: Add simulator project generation

Status: domain package generator added in
`src/domain/digitalTwin/runtimePackage.js`.

Create a generated simulator workspace:

```text
sim/lvgl-runtime/
  CMakeLists.txt
  lv_conf.h
  src/main_sim.c
  src/vibeboard_sim_bsp.h
  src/vibeboard_sim_bsp.c
  src/vibeboard_sim_peripherals.h
  src/vibeboard_sim_peripherals.c
```

The generator should copy generated `main/app_ui.c`, `main/app_ui.h`, and any UI
assets into this workspace. `main_sim.c` initializes LVGL, the display/input
driver, the mock BSP, then calls the generated UI entrypoint.

### Phase 3: Define generated-code conventions

Generated UI code should expose a stable entrypoint:

```c
void app_ui_start(void);
```

`app_main()` should stay thin:

```c
void app_main(void)
{
    bsp_i2c_init();
    pca9557_init();
    bsp_lvgl_start();
    app_ui_start();
}
```

This lets the same `app_ui.c` run in firmware and in the simulator.

### Phase 4: Build real LVGL preview

Status: service boundary added in `backend/lvgl-sim-service/`. The service can
accept generated runtime packages, validate paths, and report whether
Emscripten is available. The home server currently runs the lightweight
deployable service image, so `/lvgl-sim-health` returns
`{"status":"ok","emcc":false}`. LVGL source integration and real WASM rendering
are still pending.

TODO:

1. Build a stable internal LVGL/Emscripten builder image instead of pulling the
   large upstream `emscripten/emsdk` image during every server deploy.
2. Wire generated `app_ui.c/h` and the `sim/lvgl-runtime/` harness into a real
   LVGL browser preview bundle.
3. Add simulated display/input/BSP adapters for the board APIs used by generated
   firmware code.
4. Return preview HTML/WASM artifact URLs, logs, and structured failure reasons
   from `/simulate-lvgl`.
5. Keep semantic preview as a fast fallback and clearly label it separately from
   real LVGL framebuffer rendering.

Preferred path:

```text
Emscripten build service
  input: generated source bundle
  output: preview HTML/WASM bundle
  browser embeds result in device screen iframe/canvas
```

Fallback path:

```text
SDL build service
  input: generated source bundle
  output: screenshot or streaming framebuffer
```

### Phase 5: Add peripheral bridge

Expose simulator events between JS and C:

```text
JS controls -> C mock peripheral state -> generated LVGL code
generated LVGL events -> C logs -> JS log panel
```

Example APIs:

```c
const char **sim_wifi_scan(size_t *count);
void sim_wifi_connect(const char *ssid, const char *password);
int sim_audio_get_volume(void);
void sim_audio_set_volume(int volume);
void sim_imu_set_pose(float pitch, float roll, float yaw);
```

### Phase 6: Compare simulated and real evidence

When a user runs the same program on real hardware, store:

- simulated interaction trace
- build evidence
- device logs
- flash/OTA result
- user-observed issue

Use the delta to improve prompts, mocks, and repair context.

## Non-Goals

- Do not build a full transistor/register-level ESP32-S3 simulator.
- Do not claim the semantic preview is real LVGL rendering.
- Do not block quick generation on QEMU/WASM build latency.
- Do not let AI write system-owned project files to make simulation easier.

## Current Constraint

The local environment does not currently expose `emcc`, so L2 browser WASM
requires installing or containerizing Emscripten before implementation.
