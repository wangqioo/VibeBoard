# Huangshan Pi 5 Minute Demo

This demo proves Huangshan Pi as a real compile, flash, render, and readback
target through the local bridge.

## Prerequisites

- Huangshan Pi connected over USB.
- SiFli SDK workspace cloned locally.
- `sftool` available in `PATH`.
- Local bridge started from this repository.

## Start The Bridge

```bash
HUANGSHAN_SERVICE_PORT=8771 \
HUANGSHAN_WORKSPACE=/Users/wq/huangshan-pi-workspace/huangshan-pi-sf32-dev \
SIFLI_SDK_PATH=/Users/wq/huangshan-pi-workspace/sifli-sdk \
PATH="$HOME/.sifli/tools/sftool/0.1.16:$PATH" \
node backend/huangshan-service/server.mjs
```

## Steps

1. Open VibeBoard and switch to **Huangshan**.
2. Set Bridge to `http://127.0.0.1:8771`.
3. Click **刷新设备** and confirm SDK, `sftool`, and serial are ready.
4. Click **预览** to render the LVGL framebuffer path.
5. Click **编译** and wait for a successful artifact summary.
6. Click **烧录** to flash through the local bridge.
7. Click **读回校验** to compare flash contents against the built artifact hash.
8. Click **导出报告**.

## Pass Criteria

- Bridge status is `设备就绪`.
- Build evidence shows `status: success`.
- Flash Evidence shows `读回一致`.
- The exported report includes `main.bin`, address `0x12020000`, expected
  SHA-256, actual SHA-256, and `matched`.

## Demo Talk Track

Huangshan Pi is the strongest hardware proof point because the page does not
only say "flash succeeded"; it reads bytes back from the chip and verifies the
artifact hash.
