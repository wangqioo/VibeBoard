# Nordic nRF Build And Browser DFU

This guide records the current Nordic nRF path. It is not yet a fully proven
production flow; the next step is a real-board Web Serial DFU run.

## Current Architecture

The nRF path is split into two parts:

- The home server runs nRF Connect SDK / Zephyr builds.
- The browser performs local Web Serial DFU only after the board already runs
  MCUboot and MCUmgr serial firmware.

This is different from the ESP32 path. ESP32 browser flashing can talk to the
ROM bootloader directly. nRF browser DFU needs compatible firmware already on
the device.

## Home Server Service

Current deployment:

```text
host: 192.168.1.15
frontend route: http://127.0.0.1:4100/
nRF service route: http://127.0.0.1:4100/nordic/*
nRF service port: 8772
systemd user unit: vibeboard-nordic.service
repo path: /home/wq/workspace/VibeBoard
NCS_HOME: /home/wq/nordic-toolchain/ncs
ZEPHYR_SDK_INSTALL_DIR: /home/wq/nordic-toolchain/zephyr-sdk-0.17.4
build cache: /home/wq/vibeboard-nordic-build-cache
```

Health check:

```bash
ssh 192.168.1.15 'curl -s http://127.0.0.1:8772/nordic/health'
```

Expected status:

```text
"status":"ok"
```

Restart service:

```bash
ssh 192.168.1.15 'systemctl --user restart vibeboard-nordic.service'
```

Check status:

```bash
ssh 192.168.1.15 'systemctl --user status vibeboard-nordic.service --no-pager -l'
```

If `8772` is already occupied, check for an old deployment process:

```bash
ssh 192.168.1.15 'ps -ef | grep nordic-compiler-service | grep -v grep; ss -ltnp | grep 8772 || true'
```

The intended listener is:

```text
/home/wq/workspace/VibeBoard/backend/nordic-compiler-service/server.mjs
```

## Generated nRF Project

The generated Nordic project currently targets:

```text
nrf52840dk/nrf52840
```

Generated files:

```text
CMakeLists.txt
prj.conf
sysbuild.conf
src/main.c
README.md
```

The template enables MCUboot and MCUmgr serial DFU. Important config:

```text
SB_CONFIG_BOOTLOADER_MCUBOOT=y
CONFIG_BOOTLOADER_MCUBOOT=y
CONFIG_MCUMGR=y
CONFIG_MCUMGR_TRANSPORT_UART=y
CONFIG_MCUMGR_GRP_IMG=y
CONFIG_MCUMGR_GRP_OS=y
CONFIG_IMG_MANAGER=y
CONFIG_MCUBOOT_IMG_MANAGER=y
CONFIG_FLASH=y
CONFIG_FLASH_MAP=y
CONFIG_STREAM_FLASH=y
CONFIG_BASE64=y
CONFIG_CRC=y
CONFIG_ZCBOR=y
```

The generated app calls:

```c
boot_write_img_confirmed();
```

This lets a test-booted image confirm itself after a successful boot.

## Artifact Contract

Successful Nordic builds return artifacts. The browser DFU path should choose:

```text
zephyr.signed.bin
```

The compiler service marks it as:

```json
{
  "role": "dfu-image",
  "dfu": true
}
```

The initial wired/factory flashing artifact is:

```text
merged.hex
```

That artifact is useful for `west flash`, J-Link, or another trusted first-time
provisioning path. It is not what the browser serial DFU uploads.

## Build Failure Display

The Nordic workspace keeps the full `west build` log, but the status area should
show a short parsed summary first.

Examples:

```text
src/main.c:27: 'BT_LE_ADV_CONN_NAME' undeclared
Kconfig 配置不满足：MCUMGR_GRP_IMG was assigned the value
CMake 配置失败：/path/to/kconfig.cmake:409
```

The full log remains available through `展开完整日志`. This is intentional:
Zephyr/sysbuild logs are long, and the useful clue is usually the first compiler
error, Kconfig warning, or CMake error.

## Browser Entry

Web Serial requires a secure browser context. For LAN testing, use a local SSH
tunnel instead of opening the plain LAN HTTP URL directly:

```bash
ssh -N -L 4100:127.0.0.1:4100 192.168.1.15
```

Then open:

```text
http://localhost:4100/
```

Hard-refresh after every frontend deploy:

```text
Cmd + Shift + R
```

Without a hard refresh, the browser can keep an old JS bundle and submit stale
generated code to the compiler service.

## Current Real-Board State

Observed on the Mac:

```text
/dev/cu.usbmodem1101
```

Local tools currently missing from `PATH`:

```text
nrfjprog
JLinkExe
mcumgr
nrfutil
```

This means local command-line recovery/probing is limited until Nordic Command
Line Tools, SEGGER J-Link, or an MCUmgr client is installed or located.

## Verified So Far

- Server-side real `west build` succeeds for the default BLE/GPIO/UART Nordic
  template on the deployed NCS v3.3.1 / Zephyr 4.3.99 toolchain.
- The BLE template was fixed for Zephyr 4.3.99 by replacing the old
  `BT_LE_ADV_CONN_NAME` usage with the sample-compatible pattern:

```text
BT_LE_ADV_CONN_FAST_1
BT_DATA_NAME_COMPLETE
explicit advertising and scan-response arrays
```

- The deployed frontend bundle was rebuilt and confirmed to contain
  `BT_LE_ADV_CONN_FAST_1`, not `BT_LE_ADV_CONN_NAME`.
- The service returns a `zephyr.signed.bin` DFU artifact for successful builds.
- The artifact download route returns the expected signed image bytes.

## Not Yet Verified

- Browser Web Serial upload to the real board.
- MCUmgr response parsing against the real board.
- Image upload offset progression.
- Image test-state command.
- Reset command.
- New image boot and self-confirm.

## Next Real-Board Test

1. Confirm the local SSH tunnel is running:

```bash
lsof -iTCP:4100 -sTCP:LISTEN -n -P
```

2. Open:

```text
http://localhost:4100/
```

3. Hard-refresh the page.

4. Enter the Nordic workspace.

5. Run `服务器构建`.

6. Confirm the build output includes:

```text
zephyr.signed.bin · DFU
```

7. Click `串口烧录`.

8. In the browser serial chooser, select the port corresponding to:

```text
/dev/cu.usbmodem1101
```

9. Capture the full DFU log. Classify any failure as one of:

```text
browser cannot open serial
serial opens but no MCUmgr response
upload offset stalls
image state/test fails
reset fails
board reboots but old image stays active
board reboots and disappears from USB
```

10. If browser DFU fails and command-line probing is needed, install or locate:

```text
nrfjprog
JLinkExe
mcumgr
nrfutil
```

## Focused Tests

Run these after Nordic changes:

```bash
npm run test:nordic-app-template
npm run test:nordic-workspace-ui
npm run test:nordic-compiler-service
npm run test:nordic-compiler-service-config
npm run test:nordic-dfu-protocol
npm run test:nordic-dfu-ui
npm run build
```
