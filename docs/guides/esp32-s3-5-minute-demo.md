# ESP32-S3 5 Minute Demo

This demo proves the ESP32-S3 path without browser-side code generation. Use
Codex, Claude Code, or a local editor to change files; use VibeBoard to compile,
flash, observe, and export evidence.

## Prerequisites

- Chrome or Edge for Web Serial USB flashing.
- ESP32-S3 board connected over USB.
- Compiler service reachable from the VibeBoard page.
- Optional: ESP tool configured on the host for MCP/local flash flows.

## Steps

1. Open VibeBoard and select an ESP-IDF board.
2. Edit the project locally or in the Monaco editor.
3. Click **编译** and wait for a successful firmware artifact.
4. Flash with **USB 直刷**, WiFi OTA, BLE OTA, or remote OTA.
5. Open **设备证据** and capture logs after reboot.
6. In the compile dialog, click **导出证据报告**.

## Pass Criteria

- Build evidence shows `status: success`.
- Flash or OTA device evidence shows `status: success`.
- The exported report includes board id, selected skills, project file hashes,
  build evidence, device evidence, and firmware artifact metadata.

## Demo Talk Track

The important product claim is not that the browser generated code. The claim is
that local agents can change real firmware while the web product turns those
changes into a verifiable hardware run.
