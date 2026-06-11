# VibeBoard Development Plan

This plan tracks the engineering path from the current ESP-IDF-first workspace
to a reliable hardware development loop. It should stay practical: every major
item needs a clear user value, a bounded implementation surface, and a way to
verify it.

## Product Goal

VibeBoard should let a user describe embedded behavior, generate board-aware
firmware, build it, flash it, observe the real device, and use that evidence to
repair the program.

The target loop is:

```text
request
  -> board intent and capability skills
  -> Program Manifest
  -> application source under main/
  -> system-owned ESP-IDF project assembly
  -> compiler service build
  -> USB / WiFi OTA / BLE OTA delivery
  -> build and device evidence
  -> controlled repair and rebuild
```

## Current Baseline

The current baseline, after the June 2026 updates, is:

- ESP32-S3 / ESP-IDF is the mature platform track.
- AI writes application source; VibeBoard owns system project files.
- The compiler service rejects or ignores client-controlled build files and now
  generates `main/CMakeLists.txt`, `main/idf_component.yml`,
  `sdkconfig.defaults`, and `partitions.csv` from trusted skill metadata.
- Official SZPI examples, OTA receiver firmware, BLE OTA receiver firmware, USB
  flashing, and WiFi/BLE OTA flows exist.
- Program Intent, Program Manifest, Build Evidence, Hardware Workflow, and
  Digital Twin domain modules exist, but the UI still has too much orchestration
  state.
- Huangshan Pi support has a first independent workspace slice under
  `src/domain/huangshan/`, `backend/huangshan-service/`, and
  `src/components/HuangshanWorkspace.*`.
- The browser preview is still primarily semantic; real LVGL runtime preview is
  incomplete.

## Development Principles

- Keep ESP32-S3 / ESP-IDF stable before expanding broadly.
- Preserve the write boundary: AI may patch application source, not
  system-owned build files or BSP files.
- Prefer small, test-backed changes around one workflow at a time.
- Treat real hardware logs and compiler output as first-class product data.
- Keep Huangshan independent until its build, flash, preview, and device
  evidence loops are proven.
- Move durable explanations into `docs/`; keep `README.md` short.

## Phase 1: Stabilize The ESP-IDF Core Loop

Goal: make the main SZPI ESP32-S3 flow dependable enough for repeated use.

### Work Items

1. Persist compiler build cache on the server.
   - Mount `/tmp/builds` from the `esp32-compiler` container to a host path.
   - Preserve AI project incremental builds, official example artifacts, OTA
     receiver artifacts, and BLE receiver artifacts across container rebuilds.
   - Mount `/tmp/vibeboard-remote-ota` to preserve remote OTA firmware and job
     state across container rebuilds.
   - Add deployment notes for cache location, cleanup, and backup policy.

2. Harden compiler service inputs and outputs.
   - Keep the system-file write boundary covered by tests.
   - Add regression tests for `__selectedSkills`, generated manifests,
     partition selection, and source cleanup.
   - Ensure build responses always include artifact metadata, log excerpts, and
     a stable error category.

3. Make build evidence useful in the UI.
   - Show failing file, line, error category, and likely capability skill.
   - Separate build transport failures from firmware compile failures.
   - Store the latest build evidence as repair-loop input.

4. Verify flash and OTA delivery paths.
   - Confirm full USB flash uses the flash manifest when available.
   - Confirm app-only flash still works for generated apps.
   - Confirm WiFi OTA and BLE OTA error states are visible and actionable.

### Acceptance

- `npm run test:compiler-security`
- `npm run test:compile-package`
- `npm run test:project-config`
- `npm run test:official-examples-backend`
- `npm run test:compiler-incremental-cache`
- A generated LVGL + WiFi app can build, flash, log boot status, and be rebuilt
  without losing compiler cache.

## Phase 2: Make Repair A Real Workflow

Goal: turn compile failures and runtime observations into controlled repair
requests instead of free-form chat.

### Work Items

1. Strengthen the AI repair loop.
   - Feed compiler errors, Program Manifest, selected skills, driver contracts,
     active source file, and recent logs into repair prompts.
   - Require repair output to stay inside application source paths.
   - Add a maximum generate -> build -> repair -> rebuild cycle count.

2. Promote Device Evidence.
   - Normalize serial logs, WebSocket logs, OTA results, BLE flash results,
     device info, resets, and crashes.
   - Parse boot, driver init, WiFi, LVGL, OTA, and panic patterns.
   - Keep device connection state stable across app views.

3. Add acceptance checks.
   - Let Program Manifest define expected logs or runtime signals.
   - Compare build and device evidence against those checks.
   - Show "passes", "needs observation", and "failed" states separately.

### Acceptance

- `npm run test:build-evidence`
- `npm run test:device-evidence`
- `npm run test:hardware-workflow`
- `npm run test:workflow-compiler-adapter`
- A broken generated app can be repaired at least once from structured compiler
  evidence without changing system-owned files.
- A runtime symptom from logs can be attached to the current project and used as
  repair context.

## Phase 3: Complete The Digital Twin Ladder

Goal: keep instant semantic preview, then add real LVGL preview as stronger
evidence.

### Work Items

1. Make preview fidelity explicit.
   - Label semantic preview as semantic, not firmware proof.
   - Show service reachability, semantic preview availability, and real LVGL
     preview availability as separate states.

2. Finish LVGL runtime package generation.
   - Generate a stable `sim/lvgl-runtime/` package from current app files.
   - Include generated UI source, LVGL config, board mocks, and entry glue.
   - Keep generated simulator files out of the AI write surface.

3. Build a real preview backend.
   - Stabilize the LVGL/Emscripten or SDL builder image.
   - Return framebuffer artifacts or a browser-renderable bundle.
   - Surface compiler/runtime errors as preview evidence.

4. Add peripheral mocks.
   - Start with display, touch, WiFi state, GPIO button, and basic logs.
   - Expand to audio, camera, IMU, SD/SPIFFS, BLE HID, and speech only after the
     UI and build loop are stable.

### Acceptance

- `npm run test:digital-twin-scene`
- `npm run test:digital-twin-interaction`
- `npm run test:lvgl-runtime-package`
- `npm run test:lvgl-sim-service`
- A generated LVGL project can produce semantic preview immediately and a real
  LVGL preview artifact when the service is available.

## Phase 4: Clarify Architecture And UI Ownership

Goal: reduce broad UI components and make workflows easier to test.

### Work Items

1. Split `README.md` into short entry plus guides.
   - `docs/guides/local-development.md`
   - `docs/guides/flashing.md`
   - `docs/guides/ota.md`
   - `docs/guides/compiler-service.md`

2. Extract workspace state from `src/App.jsx`.
   - Separate settings storage, board state, compile sessions, project files,
     and right-panel orchestration.
   - Keep components focused on rendering and user actions.

3. Split adapter code by role.
   - AI adapter
   - compiler adapter
   - flash/OTA/BLE adapters
   - pure domain assembly and validation modules

4. Make workflow state explicit.
   - Keep Program Intent, Program Manifest, Build Evidence, Device Evidence,
     and preview evidence as named state objects.
   - Avoid component-local hidden state for repair-critical data.

### Acceptance

- Existing test scripts still pass after each extraction.
- `src/App.jsx` no longer owns core workflow logic.
- New workflow behavior can be tested without rendering React.

## Phase 5: Prove Huangshan As A Second Platform Track

Goal: validate the multi-toolchain architecture without weakening the ESP-IDF
path.

### Work Items

1. Keep Huangshan isolated.
   - Do not fold it into the ESP-IDF board selector yet.
   - Keep SiFli/RT-Thread/SCons build logic inside Huangshan modules and
     service code.

2. Complete Huangshan build evidence.
   - Parse SCons output into stable categories.
   - Record artifacts, logs, board profile, and selected capability.

3. Complete Huangshan preview and device actions.
   - Keep semantic preview separate from real preview.
   - Add guarded device actions only after local build artifacts are reliable.

4. Decide platform abstraction boundaries.
   - Compare ESP-IDF and Huangshan flows after both have build evidence.
   - Promote only shared concepts into platform-level abstractions.

### Acceptance

- `npm run test:huangshan-profile`
- `npm run test:huangshan-app-template`
- `npm run test:huangshan-app-builder`
- `npm run test:huangshan-ai-builder`
- `npm run test:huangshan-build-evidence`
- `npm run test:huangshan-build-artifacts`
- `npm run test:huangshan-workspace-files`
- `npm run test:huangshan-device-actions`
- `npm run test:huangshan-semantic-preview`
- `npm run test:huangshan-real-preview`
- `npm run test:huangshan-workspace-ui`

## Phase 6: Harden Deployment Operations

Goal: make the deployed system recoverable and inspectable.

### Work Items

1. Script deployment steps.
   - Frontend build and deploy.
   - Compiler service deploy.
   - LVGL preview service deploy.
   - Huangshan service deploy if it moves beyond local development.

2. Add health checks.
   - Frontend static serving.
   - Compiler service readiness.
   - Build cache path writable.
   - Preview service readiness.
   - OTA firmware/artifact availability.

3. Add rollback notes.
   - How to revert frontend only.
   - How to revert compiler service only.
   - How to keep cache, firmware state, and OTA state outside disposable
     containers.

### Acceptance

- A fresh server can be brought up from documented commands.
- Container recreation does not erase compiler cache or OTA state.
- Health check failures identify the failing service, not just "site down".

## Nordic nRF Track Status - 2026-06-11

Goal: add a Nordic nRF path that keeps heavy NCS/Zephyr builds on the home
server and uses the browser only for local serial DFU when the board is already
running MCUboot + MCUmgr.

### Completed

- Added a Nordic workspace path. It now defaults to Seeed XIAO nRF52840 /
  `xiao_ble` and also keeps selectable support for XIAO Sense
  `xiao_ble/nrf52840/sense` and Nordic nRF52840 DK `nrf52840dk/nrf52840`.
- Replaced the earlier fake Nordic "AI code" path. The Nordic assistant now calls
  the configured AI API and validates the returned Zephyr project files before
  writing them into the editor.
- Added a standalone nRF compiler service under
  `backend/nordic-compiler-service/server.mjs`.
- Deployed the nRF compiler service on the home server:
  - host: `192.168.1.15`
  - user systemd unit: `vibeboard-nordic.service`
  - port: `8772`
  - nginx route: `http://127.0.0.1:4100/nordic/*`
  - NCS: `/home/wq/nordic-toolchain/ncs`
  - Zephyr SDK: `/home/wq/nordic-toolchain/zephyr-sdk-0.17.4`
- Added Nordic generated project files:
  - `CMakeLists.txt`
  - `prj.conf`
  - `sysbuild.conf`
  - `boards/xiao_ble.overlay`
  - `sysbuild/mcuboot/prj.conf`
  - `sysbuild/mcuboot/boards/xiao_ble.overlay`
  - `src/main.c`
  - `README.md`
- Added MCUboot and MCUmgr serial DFU configuration to generated nRF projects:
  - `SB_CONFIG_BOOTLOADER_MCUBOOT=y`
  - `CONFIG_BOOTLOADER_MCUBOOT=y`
  - `CONFIG_MCUMGR=y`
  - `CONFIG_MCUMGR_TRANSPORT_UART=y`
  - `CONFIG_MCUMGR_GRP_IMG=y`
  - `CONFIG_MCUMGR_GRP_OS=y`
  - `CONFIG_IMG_MANAGER=y`
  - `CONFIG_MCUBOOT_IMG_MANAGER=y`
  - `CONFIG_FLASH=y`
  - `CONFIG_FLASH_MAP=y`
  - `CONFIG_STREAM_FLASH=y`
  - `CONFIG_BASE64=y`
  - `CONFIG_CRC=y`
  - `CONFIG_ZCBOR=y`
- Added server artifact discovery and download for Nordic build outputs.
  `zephyr.signed.bin` is marked as the DFU image.
- Added UF2 artifact support. The UI now exposes a separate UF2 download path
  for XIAO first-time flashing or recovery, and prefers the application
  `zephyr.uf2` over the MCUboot `zephyr.uf2` when both artifacts exist.
- Added browser-side Nordic Web Serial DFU modules:
  - `src/utils/nordicDfuProtocol.js`
  - `src/utils/nordicDfu.js`
- Added Nordic workspace UI state for:
  - server build
  - DFU artifact selection
  - Web Serial DFU progress
  - DFU log output
- Added Nordic build failure summarization so the UI shows the first useful
  compiler/Kconfig/CMake error and keeps the full `west build` log behind
  `展开完整日志`.
- Added tests:
  - `npm run test:nordic-app-template`
  - `npm run test:nordic-compiler-service`
  - `npm run test:nordic-compiler-service-config`
  - `npm run test:nordic-workspace-ui`
  - `npm run test:nordic-build-log-summary`
  - `npm run test:nordic-dfu-protocol`
  - `npm run test:nordic-dfu-ui`

### Verified

- Home-server nRF service health returns `ok`.
- Real server-side `west build` succeeds for the generated default BLE/GPIO/UART
  Nordic project.
- The build produces `zephyr.signed.bin` with artifact metadata like:

```text
name: zephyr.signed.bin
role: dfu-image
dfu: true
```

- The artifact download route returns the signed image with the expected byte
  count.
- Frontend static deployment on `esp32-vibe-coder` was updated after the BLE
  template fix. The deployed JS bundle no longer contains the old
  `BT_LE_ADV_CONN_NAME` macro and does contain `BT_LE_ADV_CONN_FAST_1`.
- On 2026-06-12, real server-side `west build` for `xiao_ble` succeeded after
  adding XIAO-specific MCUboot partition overlays for both the app image and the
  MCUboot sysbuild image.
- That successful XIAO build produced:
  - application `zephyr.uf2`
  - application `zephyr.signed.bin`
  - `merged.hex`
  - MCUboot build artifacts
- The deployed frontend was updated through the `esp32-vibe-coder` nginx
  container and verified from the server side:
  - latest confirmed bundle during the PRINTK/Kconfig fix:
    `index-tENREsbV.js`
  - `http://127.0.0.1:4100/nordic/health` returned `status: ok`
- GitHub commits currently carrying the Nordic work:
  - `480f9a9 Make Nordic workspace target XIAO and real AI generation`
  - `df8e91b Add Nordic UF2 download path alongside MCUmgr`
  - `66eefe5 Fix XIAO Nordic MCUboot partition build`
  - `84bff75 Prefer application UF2 for Nordic downloads`
  - `79589b7 Guard Nordic AI against PRINTK Kconfig conflicts`

### Important Findings

- nRF browser flashing is not the same as ESP32 Web Serial flashing.
  The browser can do serial DFU only after the board already has compatible
  MCUboot + MCUmgr firmware.
- First-time provisioning still needs a non-browser path such as `west flash`,
  J-Link, or another trusted factory flash step.
- Web Serial requires a secure browser context. For LAN testing, use an SSH
  tunnel and open:

```sh
ssh -N -L 4100:127.0.0.1:4100 192.168.1.15
```

```text
http://localhost:4100/
```

- The first generated BLE template used `BT_LE_ADV_CONN_NAME`, which fails on
  the deployed NCS v3.3.1 / Zephyr 4.3.99 toolchain. It was replaced with the
  Zephyr sample-compatible pattern:
  - `BT_LE_ADV_CONN_FAST_1`
  - `BT_DATA_NAME_COMPLETE`
  - explicit advertising and scan-response arrays.
- Seeed XIAO nRF52840's default Zephyr board DTS uses a UF2/SoftDevice-style
  partition map with `code_partition`, not MCUboot `slot0_partition` /
  `slot1_partition`. MCUboot sysbuild needs those slot labels, so VibeBoard now
  generates a XIAO-specific MCUboot partition overlay in both:
  - `boards/xiao_ble.overlay`
  - `sysbuild/mcuboot/boards/xiao_ble.overlay`
- If `sysbuild/mcuboot/boards/xiao_ble.overlay` exists, Zephyr also expects a
  `sysbuild/mcuboot/prj.conf`. VibeBoard now generates a minimal MCUboot config
  there.
- MCUboot's child image should keep console/serial output disabled on XIAO to
  avoid a UART console link failure, but the application image must keep
  `CONFIG_PRINTK`, `CONFIG_CONSOLE`, `CONFIG_SERIAL`, and `CONFIG_UART_CONSOLE`
  enabled. The AI validation now rejects application `prj.conf` files that set
  those symbols to `n`.
- Kconfig warning summaries now keep the complete assigned/got message instead
  of truncating after `was assigned the value`.

### Known Gaps

- Full real-board browser DFU has not been completed yet.
- Real-board UF2 first flashing has not been completed yet in this session.
- The connected board appeared locally as `/dev/cu.usbmodem1101`, but the
  Web Serial upload result was not captured before pausing.
- The Mac does not currently have `nrfjprog`, `JLinkExe`, `mcumgr`, or
  `nrfutil` on `PATH`, so local command-line recovery/probing is limited.
- Browser cache can keep an old static JS bundle. After frontend deployment,
  use a hard refresh before retrying:

```text
Cmd + Shift + R
```

### Next Session Checklist

1. Confirm the SSH tunnel is active and the browser is using
   `http://localhost:4100/`.
2. Hard-refresh the browser page.
3. Confirm the Nordic page builds a project and shows a `zephyr.signed.bin`
   DFU artifact and an application `zephyr.uf2` artifact.
4. First-time or recovery path: double-reset the Seeed XIAO nRF52840 into UF2
   mass-storage mode, download the application `zephyr.uf2`, and drag it to the
   XIAO drive.
5. Confirm the board boots the VibeBoard-generated firmware. Capture serial
   logs if possible.
6. Follow-up update path: click `串口烧录` and choose the board serial port,
   expected on this Mac as
   `/dev/cu.usbmodem1101`.
7. Capture the exact Web Serial DFU log:
   - port open
   - artifact download
   - upload offset/progress
   - image test state
   - reset command
8. If DFU fails, classify the failure:
   - browser cannot open serial
   - serial opens but no MCUmgr response
   - upload offset stalls
   - image state/test fails
   - reset fails
   - board reboots but does not run the new image
9. If recovery is needed, install or locate local tools for the Mac:
   - Nordic Command Line Tools / `nrfjprog`
   - SEGGER J-Link / `JLinkExe`
   - `mcumgr` or `nrfutil`
10. After real-board DFU succeeds, add a short guide under `docs/guides/` for
   Nordic provisioning and browser DFU.

## Near-Term Execution Queue

These are the recommended next commits, in order:

1. Run the current focused test suite and record the first failing area.
2. Add/repair compiler cache persistence in deployment config.
3. Improve build evidence UI and repair-loop input wiring.
4. Add Device Evidence parsing for boot, WiFi, OTA, LVGL, and panic logs.
5. Make digital twin preview states explicit in the UI.
6. Extract the first slice of workflow state out of `src/App.jsx`.
7. Split README into linked guides after the behavior is stable.

## Explicitly Excluded For Now

- Do not redesign official-example OTA behavior right now. Most official
  examples do not include OTA services. After flashing one, the board may need
  USB flashing again before the next OTA workflow.
- Do not add broad Arduino, PlatformIO, STM32Cube, or generic board support
  until ESP-IDF and Huangshan have proven build, flash, preview, and evidence
  loops.
- Do not let AI modify `CMakeLists.txt`, `sdkconfig.defaults`,
  `idf_component.yml`, `partitions.csv`, BSP files, or compiler templates.
- Do not treat semantic preview as firmware correctness evidence.
