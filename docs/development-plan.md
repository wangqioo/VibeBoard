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
