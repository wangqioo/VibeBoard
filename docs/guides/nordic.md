# Nordic nRF Build And Browser DFU

This guide records the current Nordic nRF path. Server-side build for Seeed
XIAO nRF52840 is proven; the remaining proof is real-board UF2 first flashing
and browser Web Serial MCUmgr update.

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

The generated Nordic project defaults to the user's current board:

```text
xiao_ble
```

Supported board targets in the UI:

```text
xiao_ble
xiao_ble/nrf52840/sense
nrf52840dk/nrf52840
```

Generated files:

```text
CMakeLists.txt
prj.conf
sysbuild.conf
boards/xiao_ble.overlay
sysbuild/mcuboot/prj.conf
sysbuild/mcuboot/boards/xiao_ble.overlay
src/main.c
README.md
```

The template enables MCUboot, MCUmgr serial DFU, and UF2 output. Important app
config:

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
CONFIG_BUILD_OUTPUT_UF2=y
CONFIG_PRINTK=y
CONFIG_CONSOLE=y
CONFIG_SERIAL=y
CONFIG_UART_CONSOLE=y
CONFIG_USB_DEVICE_STACK_NEXT=y
CONFIG_CDC_ACM_SERIAL_INITIALIZE_AT_BOOT=y
```

The generated app calls:

```c
boot_write_img_confirmed();
```

This lets a test-booted image confirm itself after a successful boot.

The XIAO target also needs partition overlays because the default Zephyr board
DTS uses a UF2/SoftDevice-style `code_partition`, while MCUboot sysbuild needs
`slot0_partition` and `slot1_partition`. VibeBoard generates a USB CDC +
partition overlay for the app image and a partition-only overlay for the MCUboot
child image. The compiler service passes the child overlay explicitly with
`mcuboot_EXTRA_DTC_OVERLAY_FILE` and the app overlay explicitly with
`DTC_OVERLAY_FILE` so sysbuild does not silently fall back to the stock Seeed UF2
partitions.

The app overlay routes `zephyr,console`, `zephyr,shell-uart`, and
`zephyr,uart-mcumgr` to `board_cdc_acm_uart`. This keeps browser Web Serial DFU
on the same USB CDC channel used for logs.

The MCUboot child image intentionally keeps console/serial/printk disabled on
XIAO to avoid UART console link failures. The application image must not disable
`CONFIG_PRINTK`, `CONFIG_CONSOLE`, `CONFIG_SERIAL`, or `CONFIG_UART_CONSOLE`;
the AI validation rejects generated app `prj.conf` files that set those symbols
to `n`.

## Artifact Contract

Successful Nordic builds return several artifacts. For Seeed XIAO nRF52840
first-time flashing or recovery, use the application UF2:

```text
zephyr.uf2
```

If both application and MCUboot UF2 files exist, choose the application artifact,
not `build/mcuboot/zephyr/zephyr.uf2`. The UI selector is expected to prefer the
application UF2 automatically.

For browser MCUmgr updates after the board already runs VibeBoard firmware, use:

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

That artifact is useful for `west flash`, J-Link, or another trusted factory
flash path. It is not what the browser serial DFU uploads.

## Build Failure Display

The Nordic workspace keeps the full `west build` log, but the status area should
show a short parsed summary first.

Examples:

```text
src/main.c:27: 'BT_LE_ADV_CONN_NAME' undeclared
Kconfig 配置不满足：PRINTK was assigned the value 'y' but got the value 'n'
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
project files to the compiler service.

## Current Real-Board State

Observed on the Mac:

```text
/dev/cu.usbmodem112301
```

As of 2026-06-13, that serial device maps to an Espressif
`USB JTAG/serial debug unit`, not the XIAO nRF52840. No Nordic, Seeed, XIAO, or
UF2 bootloader device was visible in the USB device tree, and no UF2 volume was
mounted under `/Volumes`.

The current XIAO-ready artifacts have been copied to the local checkout:

```text
outputs/nordic/xiao-vibeboard-20260613-zephyr.uf2
outputs/nordic/xiao-vibeboard-20260613-zephyr.signed.bin
outputs/nordic/xiao-vibeboard-20260613-merged.hex
outputs/nordic/xiao-vibeboard-stock-uf2-smoke-20260613-zephyr.uf2
outputs/nordic/xiao-vibeboard-usb-console-smoke-20260613-zephyr.uf2
```

The MCUboot/sysbuild application UF2 starts at `0xc000`. Dragging that artifact
onto the stock `XIAO-SENSE` UF2 bootloader disk returned the board to the
bootloader, so it is not a valid factory first-flash path for a board that still
runs the Seeed UF2 bootloader.

A stock Zephyr UF2 smoke build for `xiao_ble/nrf52840/sense` starts at
`0x27000`. Dragging that UF2 onto `XIAO-SENSE` succeeded and the bootloader
volume disappeared, which proves the board accepts VibeBoard-built stock UF2
applications. That smoke app did not expose USB console logs.

The USB-console smoke UF2 was also copied to `XIAO-SENSE` successfully. The
bootloader volume disappeared afterward, but macOS did not enumerate a new
Seeed/XIAO/Nordic USB CDC serial device. The only visible `usbmodem` device was
the unrelated Espressif JTAG serial unit above, so heartbeat log capture is not
yet proven.

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

- Server-side real `west build` succeeds for Seeed XIAO nRF52840 / `xiao_ble`
  on the deployed NCS v3.3.1 / Zephyr 4.3.99 toolchain.
- The BLE template was fixed for Zephyr 4.3.99 by replacing the old
  `BT_LE_ADV_CONN_NAME` usage with the sample-compatible pattern:

```text
BT_LE_ADV_CONN_FAST_1
BT_DATA_NAME_COMPLETE
explicit advertising and scan-response arrays
```

- The deployed frontend bundle was rebuilt and confirmed to contain
  `BT_LE_ADV_CONN_FAST_1`, not `BT_LE_ADV_CONN_NAME`.
- The service returns application `zephyr.uf2`, application
  `zephyr.signed.bin`, `merged.hex`, and MCUboot artifacts for successful XIAO
  builds.
- A live service compile on 2026-06-13 returned application `zephyr.uf2`
  (`358912` bytes), application `zephyr.signed.bin` (`179967` bytes), and
  `merged.hex` for project `19cac6ac-1f00-4e00-ae7d-e5bd67760eae`.
- A manual real `west build` on 2026-06-13 with explicit `DTC_OVERLAY_FILE` and
  `mcuboot_EXTRA_DTC_OVERLAY_FILE` loaded both overlays, routed app
  `zephyr,console`, `zephyr,shell-uart`, and `zephyr,uart-mcumgr` to
  `board_cdc_acm_uart`, and produced application `zephyr.uf2` (`362496` bytes),
  application `zephyr.signed.bin` (`181856` bytes), and `merged.hex`
  (`617350` bytes).
- The UI prefers application `zephyr.uf2` for UF2 download and
  `zephyr.signed.bin` for browser MCUmgr DFU.
- The AI validation rejects app `prj.conf` files that disable `CONFIG_PRINTK`,
  `CONFIG_CONSOLE`, `CONFIG_SERIAL`, or `CONFIG_UART_CONSOLE`.
- The deployed frontend bundle was confirmed during the PRINTK/Kconfig fix as
  `index-tENREsbV.js`.

## Not Yet Verified

- Real-board UF2 first flashing by dragging application `zephyr.uf2` onto the
  XIAO bootloader drive.
- USB-console smoke UF2 log capture, after the XIAO enumerates a Nordic/Seeed
  USB CDC serial device.
- Browser Web Serial upload to the real board after UF2 provisioning.
- MCUmgr response parsing against the real board.
- Image upload offset progression.
- Image test-state command.
- Reset command.
- New image boot and self-confirm.
- A timeout like `等待 MCUmgr 响应超时` means the browser opened the serial port
  but the currently running firmware did not answer MCUmgr/SMP serial packets.
  For XIAO, first try UF2 first flashing with application `zephyr.uf2`; then use
  browser DFU for later `zephyr.signed.bin` updates.

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
zephyr.uf2
zephyr.signed.bin · DFU
```

7. For first flashing or recovery, double-reset the XIAO into UF2 mass-storage
   mode and drag the downloaded application `zephyr.uf2` onto the XIAO drive.

8. Confirm the board boots the VibeBoard-generated firmware. Capture serial logs
   if possible.

9. For follow-up updates, click `串口烧录`.

10. In the browser serial chooser, select the port corresponding to:

```text
/dev/cu.usbmodem1101
```

11. Capture the full DFU log. Classify any failure as one of:

```text
browser cannot open serial
serial opens but no MCUmgr response
upload offset stalls
image state/test fails
reset fails
board reboots but old image stays active
board reboots and disappears from USB
```

12. If browser DFU fails and command-line probing is needed, install or locate:

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
npm run test:nordic-build-log-summary
npm run test:nordic-workspace-ui
npm run test:nordic-compiler-service
npm run test:nordic-compiler-service-config
npm run test:nordic-dfu-protocol
npm run test:nordic-dfu-ui
npm run build
```
