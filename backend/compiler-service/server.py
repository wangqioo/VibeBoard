"""
ESP32 Cloud Compiler Service
POST /compile - compile ESP-IDF project, streams build log via SSE
GET  /health  - health check
"""

import os, sys, uuid, shutil, subprocess, logging, json, base64, re, time, hashlib, zlib, struct
from io import BytesIO
from pathlib import Path, PurePosixPath
from flask import Flask, request, Response, jsonify, send_file

try:
    import fcntl
except ImportError:
    fcntl = None

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:
    Image = ImageDraw = ImageFont = None

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

TEMPLATE_DIR = Path(os.environ.get("TEMPLATE_DIR", "/compiler/template"))
EXAMPLES_DIR = Path(os.environ.get("EXAMPLES_DIR", "/compiler/examples"))
OTA_RECEIVER_DIR = Path(os.environ.get("OTA_RECEIVER_DIR", "/compiler/ota_receiver"))
BLE_OTA_RECEIVER_DIR = Path(os.environ.get("BLE_OTA_RECEIVER_DIR", "/compiler/ble_ota_receiver"))
BUILD_BASE   = Path(os.environ.get("BUILD_BASE", "/tmp/builds"))
REMOTE_OTA_DIR = Path(os.environ.get("REMOTE_OTA_DIR", "/tmp/vibeboard-remote-ota"))
IDF_PATH     = Path(os.environ.get("IDF_PATH", "/opt/esp/idf"))
BUILD_TIMEOUT_SECONDS = int(os.environ.get("BUILD_TIMEOUT_SECONDS", "300"))
DEFAULT_OTA_WIFI_SSID = os.environ.get("DEFAULT_OTA_WIFI_SSID", "1-306")
DEFAULT_OTA_WIFI_PASSWORD = os.environ.get("DEFAULT_OTA_WIFI_PASSWORD", "szyt1008")
LVGL_SOURCE_DIR = Path(os.environ.get("LVGL_SOURCE_DIR", "/compiler/lvgl-8.3"))
WSL_LVGL_SOURCE_DIR = os.environ.get("WSL_LVGL_SOURCE_DIR", "").strip()
LVGL_PREVIEW_RUNNER_DIR = Path(os.environ.get("LVGL_PREVIEW_RUNNER_DIR", "/compiler/preview_runner"))
LVGL_PREVIEW_MODE = os.environ.get("LVGL_PREVIEW_MODE", "auto").strip().lower()
LVGL_PREVIEW_TIMEOUT_SECONDS = int(os.environ.get("LVGL_PREVIEW_TIMEOUT_SECONDS", "30"))
PYTHON_BIN = os.environ.get("PYTHON", sys.executable or "python3")

BUILD_BASE.mkdir(parents=True, exist_ok=True)
REMOTE_OTA_DIR.mkdir(parents=True, exist_ok=True)
(REMOTE_OTA_DIR / "firmware").mkdir(exist_ok=True)
(REMOTE_OTA_DIR / "state").mkdir(exist_ok=True)

ALLOWED_SUFFIXES = {".c", ".cc", ".cpp", ".cxx", ".h", ".hpp", ".s", ".S"}
# Files the FRONTEND is allowed to submit. These are L4-L5 application sources
# only. Build-system files (CMakeLists.txt, sdkconfig, partitions.csv) are
# deliberately NOT here: they can carry build-time code execution (CMake
# execute_process, etc.), so their only trusted source is the server-side
# board template. See SYSTEM_MANAGED_FILES below.
ALLOWED_FILENAMES = set()
# L0-L3 system files owned by the board template. If the client submits any of
# these we ignore them (and log) rather than writing client-controlled build
# logic into the project. The template copied by setup_build_dir is the only
# source of truth for them.
SYSTEM_MANAGED_FILES = {"CMakeLists.txt", "sdkconfig.defaults", "sdkconfig", "partitions.csv", "idf_component.yml"}
# Application source must live under one of these roots. A bare top-level file
# (e.g. a client trying to drop a root CMakeLists.txt) is rejected.
ALLOWED_PROJECT_ROOTS = {"main", "components", "spiffs"}
TRUSTED_BASE_IDF_COMPONENTS = [
    'lvgl/lvgl: "~8.3.0"',
    'espressif/esp_lvgl_port: "~1.4.0"',
    'espressif/esp_lcd_touch_ft5x06: "~1.0.6"',
    'espressif/esp32-camera: "^2.0.10"',
]
TRUSTED_BASE_IDF_REQUIRES = [
    "esp32_s3_szp",
    "esp_event",
    "esp_http_server",
    "esp_netif",
    "esp_wifi",
    "nvs_flash",
]
TRUSTED_BASE_SDKCONFIG = [
    'CONFIG_IDF_TARGET="esp32s3"',
    "CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y",
    "CONFIG_SPIRAM=y",
    "CONFIG_SPIRAM_MODE_OCT=y",
    "CONFIG_SPIRAM_SPEED_80M=y",
    "CONFIG_ESP_DEFAULT_CPU_FREQ_MHZ_240=y",
    "CONFIG_PARTITION_TABLE_CUSTOM=y",
    "CONFIG_HTTPD_WS_SUPPORT=y",
    "CONFIG_HTTPD_MAX_REQ_HDR_LEN=4096",
    "CONFIG_HTTPD_MAX_URI_LEN=1024",
]
TRUSTED_BASE_PARTITIONS = [
    "# Name,   Type, SubType, Offset,  Size, Flags",
    "nvs,      data, nvs,     0x9000,  0x6000,",
    "phy_init, data, phy,     ,        0x1000,",
    "factory,  app,  factory, ,        7M,",
]
TRUSTED_SKILL_IDF_COMPONENTS = {
    "audio": [
        'chmorgan/esp-audio-player: "~1.0.7"',
        'chmorgan/esp-file-iterator: "1.0.0"',
        'espressif/esp_codec_dev: "~1.3.0"',
    ],
    "speech": [
        'chmorgan/esp-audio-player: "~1.0.7"',
        'chmorgan/esp-file-iterator: "1.0.0"',
        'espressif/esp_codec_dev: "~1.3.0"',
        'espressif/esp-sr: "~1.6.0"',
    ],
    "handheld": [
        'chmorgan/esp-audio-player: "~1.0.7"',
        'chmorgan/esp-file-iterator: "1.0.0"',
        'espressif/esp_codec_dev: "~1.3.0"',
        'espressif/esp-sr: "~1.6.0"',
    ],
}
TRUSTED_SKILL_CONFIG = {
    "lvgl": {
        "sdkconfig": [
            "CONFIG_LV_COLOR_16_SWAP=y",
            "CONFIG_LV_MEM_CUSTOM=y",
            "CONFIG_LV_FONT_MONTSERRAT_12=y",
            "CONFIG_LV_FONT_MONTSERRAT_16=y",
            "CONFIG_LV_FONT_MONTSERRAT_20=y",
            "CONFIG_LV_USE_DEMO_WIDGETS=y",
            "CONFIG_LV_USE_DEMO_KEYPAD_AND_ENCODER=y",
            "CONFIG_LV_USE_DEMO_BENCHMARK=y",
            "CONFIG_LV_USE_DEMO_STRESS=y",
            "CONFIG_LV_USE_DEMO_MUSIC=y",
        ],
        "requires": ["lvgl", "esp_lvgl_port", "esp_lcd_touch_ft5x06"],
    },
    "audio": {
        "sdkconfig": [
            "CONFIG_ESP32S3_INSTRUCTION_CACHE_32KB=y",
            "CONFIG_ESP32S3_DATA_CACHE_64KB=y",
            "CONFIG_ESP32S3_DATA_CACHE_LINE_64B=y",
            "CONFIG_LV_FONT_MONTSERRAT_24=y",
            "CONFIG_LV_FONT_MONTSERRAT_32=y",
            "CONFIG_SPIFFS_OBJ_NAME_LEN=128",
        ],
        "requires": ["lvgl", "esp_lvgl_port", "esp_lcd_touch_ft5x06", "esp-audio-player", "esp-file-iterator", "esp_codec_dev"],
        "partitions": [
            "# Name,   Type, SubType, Offset,  Size, Flags",
            "nvs,      data, nvs,     0x9000,  24k",
            "phy_init, data, phy,     0xf000,  4k",
            "factory,  app,  factory, ,        3M",
            "storage,  data, spiffs,  ,        3M,",
        ],
        "spiffs": True,
    },
    "ble": {
        "sdkconfig": [
            "CONFIG_ESP32S3_INSTRUCTION_CACHE_32KB=y",
            "CONFIG_ESP32S3_DATA_CACHE_64KB=y",
            "CONFIG_ESP32S3_DATA_CACHE_LINE_64B=y",
            "CONFIG_LV_COLOR_16_SWAP=y",
            "CONFIG_LV_MEM_CUSTOM=y",
            "CONFIG_LV_FONT_MONTSERRAT_20=y",
            "CONFIG_BT_ENABLED=y",
            "# CONFIG_BT_BLE_50_FEATURES_SUPPORTED is not set",
            "CONFIG_BT_BLE_42_FEATURES_SUPPORTED=y",
        ],
        "requires": ["lvgl", "esp_lvgl_port", "esp_lcd_touch_ft5x06"],
        "compileOptions": ["-Wno-unused-const-variable"],
    },
    "camera": {
        "requires": ["esp32-camera"],
        "partitions": [
            "# Name,   Type, SubType, Offset,  Size, Flags",
            "nvs,      data, nvs,     0x9000,  24k",
            "phy_init, data, phy,     0xf000,  4k",
            "factory,  app,  factory, ,        3M",
        ],
    },
    "speech": {
        "sdkconfig": [
            "CONFIG_SPIFFS_OBJ_NAME_LEN=128",
            "CONFIG_LV_USE_GIF=y",
        ],
        "requires": ["lvgl", "esp_lvgl_port", "esp_lcd_touch_ft5x06", "esp-audio-player", "esp-file-iterator", "esp_codec_dev", "esp-sr"],
        "partitions": [
            "# Name,   Type, SubType, Offset,  Size, Flags",
            "nvs,      data, nvs,     0x9000,  24k",
            "phy_init, data, phy,     0xf000,  4k",
            "factory,  app,  factory, ,        3M",
            "storage,  data, spiffs,  ,        3M",
            "model,    data, spiffs,  ,        5168K,",
        ],
        "spiffs": True,
    },
    "handheld": {
        "sdkconfig": [
            "CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL=2048",
            "CONFIG_SPIRAM_TRY_ALLOCATE_WIFI_LWIP=y",
            "CONFIG_BT_ENABLED=y",
            "# CONFIG_BT_BLE_50_FEATURES_SUPPORTED is not set",
            "CONFIG_BT_BLE_42_FEATURES_SUPPORTED=y",
            "CONFIG_FATFS_LFN_HEAP=y",
            "CONFIG_FATFS_CODEPAGE_936=y",
            "CONFIG_FATFS_API_ENCODING_UTF_8=y",
            "CONFIG_FATFS_VFS_FSTAT_BLKSIZE=4096",
            "CONFIG_SPIFFS_OBJ_NAME_LEN=128",
            "CONFIG_LV_USE_PNG=y",
            "CONFIG_LV_USE_GIF=y",
        ],
        "requires": ["esp32-camera", "lvgl", "esp_lvgl_port", "esp_lcd_touch_ft5x06", "esp-audio-player", "esp-file-iterator", "esp_codec_dev", "esp-sr"],
        "partitions": [
            "# Name,   Type, SubType, Offset,  Size, Flags",
            "nvs,      data, nvs,     0x9000,  24k",
            "phy_init, data, phy,     0xf000,  4k",
            "factory,  app,  factory, ,        8M",
            "storage,  data, spiffs,  ,        3M",
        ],
        "compileOptions": ["-Wno-unused-const-variable"],
        "spiffs": True,
    },
}
EXAMPLE_ID_RE = re.compile(r"^[0-9]{2}-[A-Za-z0-9_-]+$")
DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
TOKEN_RE = re.compile(r"^[A-Za-z0-9_.:-]{0,96}$")
PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,96}$")
PREVIEW_VIEWPORT_MIN = 120
PREVIEW_VIEWPORT_MAX = 1024
PREVIEW_DEFAULT_WIDTH = 320
PREVIEW_DEFAULT_HEIGHT = 240
PREVIEW_FORBIDDEN_INCLUDES = {
    "esp32_s3_szp.h",
    "esp_wifi.h",
    "esp_event.h",
    "esp_netif.h",
    "esp_http_server.h",
    "esp_ota_ops.h",
    "nvs_flash.h",
    "driver/gpio.h",
    "driver/i2c_master.h",
    "driver/spi_master.h",
    "driver/i2s_std.h",
    "driver/i2s_tdm.h",
    "esp_camera.h",
    "audio_player.h",
    "esp_codec_dev.h",
    "freertos/FreeRTOS.h",
    "freertos/task.h",
    "freertos/queue.h",
    "freertos/event_groups.h",
}
PREVIEW_FORBIDDEN_CALL_RE = re.compile(
    r"\b(bsp_[A-Za-z0-9_]*|pca9557_init|esp_[A-Za-z0-9_]*|nvs_flash_[A-Za-z0-9_]*|"
    r"xTaskCreate[A-Za-z0-9_]*|gpio_[A-Za-z0-9_]*|i2c_[A-Za-z0-9_]*|i2s_[A-Za-z0-9_]*)\s*\("
)
PREVIEW_RUNNER_ALLOWED_FILES = {"main/app_ui.c": "app_ui.c", "main/app_ui.h": "app_ui.h"}


def now_ms():
    return int(time.time() * 1000)


def state_path(name: str) -> Path:
    return REMOTE_OTA_DIR / "state" / name


def read_json_file(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def write_json_file(path: Path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    tmp.replace(path)


def load_devices():
    return read_json_file(state_path("devices.json"), {})


def save_devices(devices):
    write_json_file(state_path("devices.json"), devices)


def load_jobs():
    return read_json_file(state_path("ota_jobs.json"), {})


def save_jobs(jobs):
    write_json_file(state_path("ota_jobs.json"), jobs)


def load_firmware_index():
    return read_json_file(state_path("firmware.json"), {})


def save_firmware_index(index):
    write_json_file(state_path("firmware.json"), index)


def public_base_url():
    configured = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    forwarded_proto = request.headers.get("X-Forwarded-Proto")
    forwarded_host = request.headers.get("X-Forwarded-Host")
    if forwarded_host:
        if forwarded_host.endswith(".trycloudflare.com"):
            forwarded_proto = "https"
        return f"{forwarded_proto or request.scheme}://{forwarded_host}".rstrip("/")
    return request.host_url.rstrip("/")


def valid_device_id(device_id: str):
    return isinstance(device_id, str) and DEVICE_ID_RE.match(device_id)


def valid_token(token: str):
    return isinstance(token, str) and TOKEN_RE.match(token)


def authorize_device(devices, device_id: str, token: str):
    if not valid_device_id(device_id) or not valid_token(token):
        return False
    existing = devices.get(device_id)
    return not existing or not existing.get("token") or existing.get("token") == token


def public_device(device):
    return {k: v for k, v in device.items() if k != "token"}


def secure_firmware_filename(filename: str):
    name = Path(str(filename or "firmware.bin")).name
    name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)
    return name if name.endswith(".bin") else f"{name}.bin"


def normalize_viewport(raw):
    viewport = raw if isinstance(raw, dict) else {}
    try:
        width = int(viewport.get("width", PREVIEW_DEFAULT_WIDTH))
        height = int(viewport.get("height", PREVIEW_DEFAULT_HEIGHT))
    except Exception:
        width, height = PREVIEW_DEFAULT_WIDTH, PREVIEW_DEFAULT_HEIGHT
    if width < PREVIEW_VIEWPORT_MIN or width > PREVIEW_VIEWPORT_MAX:
        width = PREVIEW_DEFAULT_WIDTH
    if height < PREVIEW_VIEWPORT_MIN or height > PREVIEW_VIEWPORT_MAX:
        height = PREVIEW_DEFAULT_HEIGHT
    return {"width": width, "height": height}


def preview_peripherals(selected_skills, manifest):
    selected = set(selected_skills or [])
    ids = []

    def add(item):
        if item not in ids:
            ids.append(item)

    if "lvgl" in selected:
        add("display")
    if "audio" in selected:
        add("microphone")
        add("speaker")
    if "speech" in selected:
        add("microphone")
    if "wifi" in selected:
        add("wifi")
    if "ble" in selected:
        add("ble")
    if "camera" in selected or "vision" in selected:
        add("camera")
    if "sdcard" in selected:
        add("sdcard")
    if "imu" in selected:
        add("imu")
    if "gpio" in selected:
        add("gpio")
    if "handheld" in selected:
        for item in ["display", "microphone", "speaker", "wifi", "ble", "camera", "sdcard", "imu"]:
            add(item)

    for item in ((manifest or {}).get("preview") or {}).get("peripherals") or []:
        if isinstance(item, dict) and item.get("id"):
            add(str(item["id"]))

    return [{"id": item, "state": preview_default_peripheral_state(item, manifest)} for item in ids]


def preview_default_peripheral_state(item, manifest):
    for configured in ((manifest or {}).get("preview") or {}).get("peripherals") or []:
        if isinstance(configured, dict) and configured.get("id") == item and configured.get("state"):
            return str(configured["state"])
    if item == "display":
        return "active"
    if item in {"wifi", "ble", "speaker"}:
        return "ready"
    return "idle"


def validate_lvgl_preview_contract(project_files):
    diagnostics = []
    app_ui_c = str((project_files or {}).get("main/app_ui.c", ""))
    app_ui_h = str((project_files or {}).get("main/app_ui.h", ""))
    if not app_ui_c or not app_ui_h:
        diagnostics.append({"message": "LVGL preview needs main/app_ui.c and main/app_ui.h."})
    if app_ui_c and not re.search(r"\bapp_ui_create\s*\(\s*lv_obj_t\s*\*\s*\w+\s*\)", app_ui_c):
        diagnostics.append({"path": "main/app_ui.c", "message": "main/app_ui.c must define void app_ui_create(lv_obj_t *root)."})
    if app_ui_h and not re.search(r"\bvoid\s+app_ui_create\s*\(\s*lv_obj_t\s*\*\s*\w+\s*\)\s*;", app_ui_h):
        diagnostics.append({"path": "main/app_ui.h", "message": "main/app_ui.h must declare void app_ui_create(lv_obj_t *root)."})

    for rel_path in ["main/app_ui.c", "main/app_ui.h"]:
        content = str((project_files or {}).get(rel_path, ""))
        if not content:
            continue
        for header in PREVIEW_FORBIDDEN_INCLUDES:
            if re.search(rf'#\s*include\s+[<"]{re.escape(header)}[>"]', content):
                diagnostics.append({"path": rel_path, "message": f"{rel_path} must stay portable LVGL-only and cannot include {header}."})
        if PREVIEW_FORBIDDEN_CALL_RE.search(content):
            diagnostics.append({"path": rel_path, "message": f"{rel_path} must not call hardware, ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs."})
    return diagnostics


def png_chunk(kind, data):
    payload = kind + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload) & 0xffffffff)


def make_png(width, height, pixels):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        start = y * width * 3
        raw.extend(pixels[start:start + width * 3])
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def fill_rect(pixels, width, height, x, y, w, h, color):
    r, g, b = color
    x0 = max(0, int(x))
    y0 = max(0, int(y))
    x1 = min(width, int(x + w))
    y1 = min(height, int(y + h))
    for yy in range(y0, y1):
        row = yy * width * 3
        for xx in range(x0, x1):
            idx = row + xx * 3
            pixels[idx:idx + 3] = bytes((r, g, b))


def draw_frame(pixels, width, height, x, y, w, h, color):
    fill_rect(pixels, width, height, x, y, w, 1, color)
    fill_rect(pixels, width, height, x, y + h - 1, w, 1, color)
    fill_rect(pixels, width, height, x, y, 1, h, color)
    fill_rect(pixels, width, height, x + w - 1, y, 1, h, color)


def c_string_literal_value(raw):
    try:
        return bytes(str(raw), "utf-8").decode("unicode_escape")
    except Exception:
        return str(raw)


def extract_lvgl_texts(source):
    texts = []
    for match in re.finditer(r'lv_(?:label|btnmatrix|textarea|dropdown)_set_text(?:_static)?\s*\([^,]+,\s*"((?:\\.|[^"\\])*)"', source):
        text = c_string_literal_value(match.group(1)).strip()
        if text and text not in texts:
            texts.append(text)
    for match in re.finditer(r'lv_label_set_text_fmt\s*\([^,]+,\s*"((?:\\.|[^"\\])*)"', source):
        text = c_string_literal_value(match.group(1)).strip()
        if text and text not in texts:
            texts.append(text)
    for match in re.finditer(r'"((?:\\.|[^"\\]){2,40})"', source):
        text = c_string_literal_value(match.group(1)).strip()
        if not text or text in texts:
            continue
        if re.search(r"[A-Za-z0-9\u4e00-\u9fff]", text) and not text.endswith((".h", ".c")):
            texts.append(text)
        if len(texts) >= 8:
            break
    return texts[:8]


def infer_preview_intent(source, selected_skills, manifest):
    text_source = source.lower()
    manifest_text = json.dumps(manifest or {}, ensure_ascii=False).lower()
    all_text = f"{text_source}\n{manifest_text}"
    selected = set(selected_skills or [])
    intent = {
        "audio": "audio" in selected or any(word in all_text for word in ["mic", "microphone", "record", "audio", "speaker", "录音", "麦克风", "音频", "音量"]),
        "wifi": "wifi" in selected or "wifi" in all_text or "wi-fi" in all_text,
        "camera": "camera" in selected or "camera" in all_text or "摄像" in all_text,
        "ble": "ble" in selected or "ble" in all_text,
        "slider": "lv_slider" in source or "lv_bar" in source or any(word in all_text for word in ["volume", "音量", "progress"]),
        "button": "lv_btn" in source or "button" in all_text or "按钮" in all_text,
        "switch": "lv_switch" in source,
        "list": "lv_list" in source or "lv_dropdown" in source or "lv_table" in source,
    }
    return intent


def first_font(size):
    if ImageFont is None:
        return None
    candidates = [
        os.environ.get("PREVIEW_FONT", ""),
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        try:
            if Path(candidate).exists():
                return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    if hasattr(draw, "rounded_rectangle"):
        draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
    else:
        draw.rectangle(box, fill=fill, outline=outline, width=width)


def text_width(draw, text, font):
    try:
        box = draw.textbbox((0, 0), text, font=font)
        return box[2] - box[0]
    except Exception:
        return len(str(text)) * 7


def fit_text(draw, text, font, max_width):
    value = str(text or "")
    if text_width(draw, value, font) <= max_width:
        return value
    ellipsis = "..."
    while value and text_width(draw, value + ellipsis, font) > max_width:
        value = value[:-1]
    return value + ellipsis if value else ellipsis


def draw_text(draw, xy, text, font, fill, max_width=None):
    value = fit_text(draw, text, font, max_width) if max_width else str(text)
    draw.text(xy, value, font=font, fill=fill)


def peripheral_label(item_id):
    return {
        "display": "LCD",
        "microphone": "MIC",
        "speaker": "SPK",
        "wifi": "WiFi",
        "ble": "BLE",
        "camera": "CAM",
        "sdcard": "SD",
        "imu": "IMU",
        "gpio": "GPIO",
    }.get(item_id, str(item_id).upper())


def render_preview_png_pillow(project_files, selected_skills, manifest, viewport):
    width, height = viewport["width"], viewport["height"]
    source = "\n".join(str(project_files.get(path, "")) for path in ["main/app_ui.c", "main/app_ui.h", "main/main.c"])
    texts = extract_lvgl_texts(source)
    intent = infer_preview_intent(source, selected_skills, manifest)
    peripherals = preview_peripherals(selected_skills, manifest)

    image = Image.new("RGB", (width, height), (14, 18, 24))
    draw = ImageDraw.Draw(image)
    font_title = first_font(18)
    font_body = first_font(12)
    font_small = first_font(10)
    font_chip = first_font(9)

    bg = (18, 23, 31)
    panel = (28, 36, 47)
    panel2 = (35, 45, 58)
    border = (70, 86, 105)
    accent = (53, 211, 139)
    blue = (77, 156, 255)
    text = (232, 238, 244)
    muted = (145, 158, 174)
    warn = (247, 180, 72)

    draw.rectangle((0, 0, width, height), fill=bg)
    rounded_rect(draw, (5, 5, width - 6, height - 6), 5, fill=(22, 28, 36), outline=border)
    draw.rectangle((6, 6, width - 7, 36), fill=(27, 80, 111))

    title = texts[0] if texts else ((manifest or {}).get("programName") or "LVGL Preview")
    draw_text(draw, (16, 13), title, font_title, text, width - 96)
    draw_text(draw, (width - 68, 16), f"{width}x{height}", font_small, (186, 214, 226), 58)

    y = 48
    status_parts = []
    if intent["audio"]:
        status_parts.append("Mic idle")
        status_parts.append("SPK ready")
    if intent["wifi"]:
        status_parts.append("WiFi ready")
    if intent["camera"]:
        status_parts.append("CAM ready")
    if intent["ble"]:
        status_parts.append("BLE ready")
    if not status_parts:
        status_parts.append("UI ready")

    chip_x = 16
    for part in status_parts[:3]:
        chip_w = min(max(text_width(draw, part, font_small) + 16, 62), width - chip_x - 16)
        rounded_rect(draw, (chip_x, y, chip_x + chip_w, y + 20), 4, fill=(31, 48, 57), outline=(46, 79, 83))
        draw_text(draw, (chip_x + 8, y + 5), part, font_small, accent if "ready" in part.lower() else muted, chip_w - 16)
        chip_x += chip_w + 7
        if chip_x > width - 70:
            break

    y += 31
    card_h = 58 if intent["slider"] else 48
    rounded_rect(draw, (16, y, width - 16, y + card_h), 6, fill=panel, outline=(52, 63, 76))
    subtitle = texts[1] if len(texts) > 1 else ("Recording console" if intent["audio"] else "Main screen")
    draw_text(draw, (28, y + 11), subtitle, font_body, text, width - 56)
    detail = texts[2] if len(texts) > 2 else ("Waiting for input" if intent["audio"] else "Preview generated from app_ui_create")
    draw_text(draw, (28, y + 30), detail, font_small, muted, width - 56)

    if intent["slider"]:
        bar_y = y + card_h - 14
        draw.rectangle((28, bar_y, width - 62, bar_y + 6), fill=(66, 78, 93))
        draw.rectangle((28, bar_y, int(28 + (width - 90) * 0.62), bar_y + 6), fill=accent)
        draw.ellipse((int(28 + (width - 90) * 0.62) - 4, bar_y - 3, int(28 + (width - 90) * 0.62) + 5, bar_y + 9), fill=(235, 249, 243))

    y += card_h + 11
    if intent["list"]:
        for index, label in enumerate((texts[3:] or ["Input", "Network", "Output"])[:3]):
            row_y = y + index * 23
            rounded_rect(draw, (16, row_y, width - 16, row_y + 18), 3, fill=(30 + index * 7, 39 + index * 7, 50 + index * 7), outline=None)
            draw_text(draw, (28, row_y + 4), label, font_small, text if index == 0 else muted, width - 56)
        y += 73

    if intent["button"] or intent["audio"]:
        button_y = min(height - 58, max(y, 150))
        left_label = "Record" if intent["audio"] else (texts[3] if len(texts) > 3 else "Start")
        right_label = "Stop" if intent["audio"] else (texts[4] if len(texts) > 4 else "OK")
        rounded_rect(draw, (24, button_y, 132, button_y + 34), 6, fill=accent, outline=(95, 233, 171))
        draw_text(draw, (48, button_y + 9), left_label, font_body, (8, 27, 20), 68)
        rounded_rect(draw, (width - 132, button_y, width - 24, button_y + 34), 6, fill=blue, outline=(122, 184, 255))
        draw_text(draw, (width - 104, button_y + 9), right_label, font_body, (4, 18, 38), 72)

    if intent["switch"]:
        sx = width - 72
        sy = 82
        rounded_rect(draw, (sx, sy, sx + 44, sy + 22), 11, fill=(37, 148, 99), outline=(83, 222, 158))
        draw.ellipse((sx + 23, sy + 3, sx + 39, sy + 19), fill=(236, 255, 247))

    if peripherals:
        footer_h = 20
        draw.rectangle((6, height - footer_h - 6, width - 7, height - 7), fill=(17, 22, 28))
        px = 14
        for item in peripherals[:6]:
            label = peripheral_label(item["id"])
            active = item.get("state") in {"active", "ready"}
            color = accent if active else muted
            draw.rectangle((px, height - 20, px + 5, height - 15), fill=color)
            draw_text(draw, (px + 8, height - 23), label, font_chip, color, 38)
            px += 48
            if px > width - 45:
                break

    if not texts and not any(intent.values()):
        draw_text(draw, (28, 94), "No LVGL widgets detected", font_body, warn, width - 56)
        draw_text(draw, (28, 114), "Add labels, buttons, sliders, or bars in app_ui.c", font_small, muted, width - 56)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_preview_png_basic(project_files, selected_skills, manifest, viewport):
    width, height = viewport["width"], viewport["height"]
    pixels = bytearray([12, 16, 20] * width * height)
    fill_rect(pixels, width, height, 0, 0, width, height, (12, 16, 20))
    fill_rect(pixels, width, height, 6, 6, width - 12, height - 12, (25, 31, 38))
    draw_frame(pixels, width, height, 6, 6, width - 12, height - 12, (72, 91, 108))

    source = "\n".join(str(project_files.get(path, "")) for path in ["main/app_ui.c", "main/app_ui.h", "main/main.c"])
    has_label = "lv_label" in source
    has_button = "lv_btn" in source
    has_slider = "lv_slider" in source
    has_list = "lv_list" in source or "lv_dropdown" in source

    fill_rect(pixels, width, height, 18, 18, width - 36, 26, (34, 81, 112))
    fill_rect(pixels, width, height, 28, 55, width - 56, 32, (44, 54, 64) if has_label else (32, 39, 47))
    if has_label:
        fill_rect(pixels, width, height, 42, 66, width - 84, 5, (218, 231, 235))
    if has_button:
        fill_rect(pixels, width, height, 34, height - 62, 92, 34, (60, 214, 142))
        fill_rect(pixels, width, height, width - 126, height - 62, 92, 34, (80, 160, 255))
    if has_slider:
        fill_rect(pixels, width, height, 34, height - 86, width - 68, 8, (73, 84, 96))
        fill_rect(pixels, width, height, 34, height - 86, int((width - 68) * 0.58), 8, (60, 214, 142))
    if has_list:
        for i in range(3):
            fill_rect(pixels, width, height, 36, 98 + i * 24, width - 72, 16, (38 + i * 10, 47 + i * 8, 56 + i * 6))

    peripherals = preview_peripherals(selected_skills, manifest)
    for index, item in enumerate(peripherals[:8]):
        x = 16 + index * 36
        y = height - 18
        fill_rect(pixels, width, height, x, y, 18, 5, (60, 214, 142) if item["state"] in {"active", "ready"} else (110, 118, 128))

    return make_png(width, height, pixels)


def render_preview_png(project_files, selected_skills, manifest, viewport):
    if Image is not None and ImageDraw is not None:
        return render_preview_png_pillow(project_files, selected_skills, manifest, viewport)
    return render_preview_png_basic(project_files, selected_skills, manifest, viewport)


def preview_interaction_point(interactions):
    if not isinstance(interactions, list):
        return None
    for item in reversed(interactions):
        if not isinstance(item, dict):
            continue
        if item.get("type") not in {"tap", "click", "touch"}:
            continue
        try:
            return {"x": int(item.get("x")), "y": int(item.get("y"))}
        except Exception:
            return None
    return None


def rgba_to_png(rgba_path, viewport):
    width, height = viewport["width"], viewport["height"]
    raw = rgba_path.read_bytes()
    expected = width * height * 4
    if len(raw) != expected:
        raise RuntimeError(f"LVGL preview framebuffer has {len(raw)} bytes, expected {expected}.")
    if Image is None:
        pixels = bytearray()
        for index in range(0, len(raw), 4):
            pixels.extend(raw[index:index + 3])
        return make_png(width, height, pixels)
    image = Image.frombytes("RGBA", (width, height), raw)
    buffer = BytesIO()
    image.convert("RGB").save(buffer, format="PNG")
    return buffer.getvalue()


def copy_preview_runner_files(project_files, work_dir):
    for source_path, target_name in PREVIEW_RUNNER_ALLOWED_FILES.items():
        content = str((project_files or {}).get(source_path, ""))
        target = work_dir / target_name
        target.write_text(content, encoding="utf-8")


def windows_path_to_wsl(path):
    resolved = Path(path).resolve()
    drive = resolved.drive.rstrip(":").lower()
    parts = [part for part in resolved.parts[1:]]
    return f"/mnt/{drive}/" + "/".join(parts)


def can_use_wsl_preview():
    if os.name != "nt":
        return False
    if shutil.which("wsl.exe") is None:
        return False
    source = WSL_LVGL_SOURCE_DIR or windows_path_to_wsl(LVGL_SOURCE_DIR)
    try:
        proc = subprocess.run(
            ["wsl.exe", "-d", "Ubuntu", "--", "bash", "-lc", f"test -f '{source}/lvgl.h' && command -v gcc >/dev/null"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=8,
        )
        return proc.returncode == 0
    except Exception:
        return False


def run_wsl_lvgl_preview(project_files, viewport, interactions):
    if not can_use_wsl_preview():
        raise RuntimeError("WSL LVGL 8.3 preview is unavailable. Set WSL_LVGL_SOURCE_DIR to an LVGL 8.3 checkout and ensure gcc is installed in WSL Ubuntu.")

    work_dir = BUILD_BASE / f"lvgl-preview-{uuid.uuid4().hex[:10]}"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_rgba = work_dir / "preview.rgba"
    tap = preview_interaction_point(interactions)
    try:
        copy_preview_runner_files(project_files, work_dir)
        wsl_work = windows_path_to_wsl(work_dir)
        wsl_runner_dir = windows_path_to_wsl(LVGL_PREVIEW_RUNNER_DIR)
        wsl_lvgl = WSL_LVGL_SOURCE_DIR or windows_path_to_wsl(LVGL_SOURCE_DIR)
        tap_args = ""
        if tap:
            tap_args = f" '{tap['x']}' '{tap['y']}'"
        command = (
            "set -e; "
            f"python3 '{wsl_runner_dir}/build_runner.py' '{wsl_lvgl}' '{wsl_runner_dir}' '{wsl_work}' "
            f"'{viewport['width']}' '{viewport['height']}' '{wsl_work}/preview_runner'; "
            f"'{wsl_work}/preview_runner' '{wsl_work}/preview.rgba'{tap_args}"
        )
        proc = subprocess.run(
            ["wsl.exe", "-d", "Ubuntu", "--", "bash", "-lc", command],
            cwd=str(work_dir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=LVGL_PREVIEW_TIMEOUT_SECONDS * 2,
        )
        if proc.returncode != 0:
            raise RuntimeError("WSL LVGL preview failed:\n" + proc.stdout[-4000:])
        return rgba_to_png(output_rgba, viewport)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def run_real_lvgl_preview(project_files, viewport, interactions):
    if LVGL_PREVIEW_MODE in {"off", "intent", "fallback"}:
        raise RuntimeError("real LVGL preview is disabled by LVGL_PREVIEW_MODE.")
    if os.name == "nt":
        return run_wsl_lvgl_preview(project_files, viewport, interactions)
    if not (LVGL_SOURCE_DIR / "lvgl.h").exists():
        raise RuntimeError(f"LVGL 8.3 source is not available at {LVGL_SOURCE_DIR}.")
    if not (LVGL_PREVIEW_RUNNER_DIR / "build_runner.py").exists():
        raise RuntimeError(f"LVGL preview runner is not available at {LVGL_PREVIEW_RUNNER_DIR}.")

    work_dir = BUILD_BASE / f"lvgl-preview-{uuid.uuid4().hex[:10]}"
    work_dir.mkdir(parents=True, exist_ok=True)
    output_exe = work_dir / "preview_runner"
    output_rgba = work_dir / "preview.rgba"
    tap = preview_interaction_point(interactions)
    try:
        copy_preview_runner_files(project_files, work_dir)
        build_cmd = [
            PYTHON_BIN,
            str(LVGL_PREVIEW_RUNNER_DIR / "build_runner.py"),
            str(LVGL_SOURCE_DIR),
            str(LVGL_PREVIEW_RUNNER_DIR),
            str(work_dir),
            str(viewport["width"]),
            str(viewport["height"]),
            str(output_exe),
        ]
        build_proc = subprocess.run(
            build_cmd,
            cwd=str(work_dir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=LVGL_PREVIEW_TIMEOUT_SECONDS,
        )
        if build_proc.returncode != 0:
            raise RuntimeError("LVGL preview build failed:\n" + build_proc.stdout[-4000:])

        run_cmd = [str(output_exe), str(output_rgba)]
        if tap:
            run_cmd.extend([str(tap["x"]), str(tap["y"])])
        run_proc = subprocess.run(
            run_cmd,
            cwd=str(work_dir),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=LVGL_PREVIEW_TIMEOUT_SECONDS,
        )
        if run_proc.returncode != 0:
            raise RuntimeError("LVGL preview render failed:\n" + run_proc.stdout[-4000:])
        return rgba_to_png(output_rgba, viewport)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def render_lvgl_preview_with_fallback(project_files, selected_skills, manifest, viewport, interactions):
    diagnostics = []
    if LVGL_PREVIEW_MODE != "intent":
        try:
            png = run_real_lvgl_preview(project_files, viewport, interactions)
            diagnostics.append({
                "message": "Rendered by real LVGL 8.3 headless simulator. Tap/click interactions are replayed before screenshot capture.",
            })
            return png, "real-lvgl-8.3-headless", diagnostics
        except Exception as exc:
            diagnostics.append({
                "category": "preview-build-failed",
                "message": str(exc),
            })
            if LVGL_PREVIEW_MODE in {"real", "strict"}:
                raise

    png = render_preview_png(project_files, selected_skills, manifest, viewport)
    diagnostics.append({
        "message": "Real LVGL 8.3 simulator is unavailable; using intent preview fallback.",
    })
    return png, "intent-lvgl-preview", diagnostics


class SystemFileRejected(Exception):
    """Raised when the client submits a server-managed system file.

    This is not a hard error (we don't fail the build) — the caller catches it,
    logs a warning, and skips the file so the template's trusted copy wins.
    """
    def __init__(self, rel_path: str):
        self.rel_path = rel_path
        super().__init__(f"system-managed file ignored: {rel_path}")


def validate_project_path(build_dir: Path, rel_path: str) -> Path:
    if not isinstance(rel_path, str) or not rel_path.strip():
        raise ValueError("invalid project file path")

    normalized = rel_path.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe project file path: {rel_path}")

    name = path.name

    # Reject anything the board template owns. The client must never be able to
    # inject build-system logic (CMake/sdkconfig/partitions) — that is the RCE
    # surface. The template copied by setup_build_dir is the source of truth.
    if name in SYSTEM_MANAGED_FILES:
        raise SystemFileRejected(rel_path)

    if name not in ALLOWED_FILENAMES and path.suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"unsupported project file type: {rel_path}")

    # Application sources must live under an allowed project root. This stops a
    # client from dropping files at the project top level (where a stray
    # CMakeLists or include could alter the build).
    if len(path.parts) < 2 or path.parts[0] not in ALLOWED_PROJECT_ROOTS:
        raise ValueError(f"project file must live under {sorted(ALLOWED_PROJECT_ROOTS)}: {rel_path}")

    target = (build_dir / Path(*path.parts)).resolve()
    root = build_dir.resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"unsafe project file path: {rel_path}") from exc
    return target


def normalized_project_id(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if PROJECT_ID_RE.match(value) else None


def project_signature(code: str, project_files: dict) -> str:
    payload = {
        "code": code,
        "projectFiles": {
            str(key): str(project_files[key])
            for key in sorted(project_files.keys(), key=str)
        },
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def directory_signature(source: Path) -> str:
    digest = hashlib.sha256()
    files = sorted(
        (p for p in source.rglob("*") if p.is_file()),
        key=lambda p: str(p.relative_to(source)).replace("\\", "/"),
    )
    for path in files:
        rel = str(path.relative_to(source)).replace("\\", "/")
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def fixed_build_id(prefix: str, value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9_.:-]+", "-", value).strip("-")
    return f"{prefix}-{name}"[:120]


def trusted_idf_component_manifest(selected_skills):
    components = []

    def add(component):
        if component not in components:
            components.append(component)

    for component in TRUSTED_BASE_IDF_COMPONENTS:
        add(component)
    for skill in selected_skills or []:
        for component in TRUSTED_SKILL_IDF_COMPONENTS.get(str(skill), []):
            add(component)

    return (
        "# IDF Component Manager Manifest File\n"
        "dependencies:\n"
        + "\n".join(f"  {component}" for component in components)
        + '\n  idf:\n    version: ">=5.0"'
    )


def unique_lines(lines):
    result = []
    for line in lines or []:
        if line not in result:
            result.append(line)
    return result


def skill_config_values(selected_skills, key):
    values = []
    for skill in selected_skills or []:
        item = TRUSTED_SKILL_CONFIG.get(str(skill), {})
        values.extend(item.get(key, []))
    return values


def trusted_main_cmake(selected_skills):
    requires = unique_lines(TRUSTED_BASE_IDF_REQUIRES + skill_config_values(selected_skills, "requires"))
    compile_options = unique_lines(skill_config_values(selected_skills, "compileOptions"))
    needs_spiffs = any(TRUSTED_SKILL_CONFIG.get(str(skill), {}).get("spiffs") for skill in selected_skills or [])

    lines = [
        "# Generated by VibeBoard compiler service.",
        "# Client uploads application sources only; this build file is server-owned.",
        'file(GLOB_RECURSE APP_SOURCES',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.c"',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.cc"',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.cpp"',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.cxx"',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.s"',
        '    "${CMAKE_CURRENT_LIST_DIR}/*.S"',
        ")",
        "",
        "idf_component_register(",
        "    SRCS ${APP_SOURCES}",
        '    INCLUDE_DIRS "."',
        f"    REQUIRES {' '.join(requires)}",
        ")",
    ]
    if needs_spiffs:
        lines.extend(["", "spiffs_create_partition_image(storage ../spiffs FLASH_IN_PROJECT)"])
    if compile_options:
        lines.extend(["", f"target_compile_options(${{COMPONENT_LIB}} PRIVATE {' '.join(compile_options)})"])
    return "\n".join(lines) + "\n"


def trusted_sdkconfig_defaults(selected_skills):
    return "\n".join(unique_lines(TRUSTED_BASE_SDKCONFIG + skill_config_values(selected_skills, "sdkconfig"))) + "\n"


def partition_size_bytes(size):
    match = re.match(r"^\s*(\d+)\s*(k|m|kb|mb)?\s*$", str(size or "").lower())
    if not match:
        return 0
    value = int(match.group(1))
    unit = match.group(2) or ""
    if unit.startswith("m"):
        return value * 1024 * 1024
    if unit.startswith("k"):
        return value * 1024
    return value


def trusted_partitions_csv(selected_skills):
    by_name = {}
    for line in TRUSTED_BASE_PARTITIONS + skill_config_values(selected_skills, "partitions"):
        trimmed = str(line).strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        parts = [part.strip() for part in trimmed.split(",")]
        name = parts[0] if parts else ""
        if not name:
            continue
        current = by_name.get(name)
        size = parts[4] if len(parts) > 4 else ""
        current_size = current["parts"][4] if current and len(current["parts"]) > 4 else ""
        if not current or partition_size_bytes(size) > partition_size_bytes(current_size):
            by_name[name] = {"line": trimmed, "parts": parts}

    ordered = ["# Name,   Type, SubType, Offset,  Size, Flags"]
    for name in ["nvs", "phy_init", "factory", "storage", "model"]:
        if name in by_name:
            ordered.append(by_name[name]["line"])
    for name, item in by_name.items():
        if name not in {"nvs", "phy_init", "factory", "storage", "model"}:
            ordered.append(item["line"])
    return "\n".join(ordered) + "\n"


def normalize_selected_skills(value):
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and re.match(r"^[A-Za-z0-9_-]{1,64}$", item)]


def sync_project_files(build_dir: Path, code: str, project_files: dict):
    main_file = project_files.get("__mainFile", "main.c")
    selected_skills = normalize_selected_skills(project_files.get("__selectedSkills", []))
    expected = set()
    # The main entry file is special: it is named relative to main/ and is a
    # plain source filename, so validate it directly (path-traversal + suffix)
    # rather than through the application-root rule used for other files.
    main_name = PurePosixPath(str(main_file).replace("\\", "/"))
    if main_name.is_absolute() or ".." in main_name.parts or len(main_name.parts) != 1:
        raise ValueError(f"invalid main file: {main_file}")
    if main_name.suffix not in ALLOWED_SUFFIXES:
        raise ValueError(f"unsupported main file type: {main_file}")
    main_target = (build_dir / "main" / main_name.name).resolve()
    if not str(main_target).startswith(str((build_dir / "main").resolve())):
        raise ValueError(f"unsafe main file: {main_file}")
    main_target.parent.mkdir(parents=True, exist_ok=True)
    main_target.write_text(code)
    expected.add(main_target.resolve())

    for rel_path, content in project_files.items():
        if rel_path in {"__mainFile", "__selectedSkills"}:
            continue
        try:
            target = validate_project_path(build_dir, rel_path)
        except SystemFileRejected as rejected:
            # Client tried to supply a server-managed system file. Ignore it so
            # the board template's trusted copy is used instead of client input.
            log.warning(f"  ignored system-managed file from client: {rejected.rel_path}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        expected.add(target.resolve())
        log.info(f"  wrote: {rel_path}")

    generated_system_files = {
        "main/CMakeLists.txt": trusted_main_cmake(selected_skills),
        "main/idf_component.yml": trusted_idf_component_manifest(selected_skills),
        "sdkconfig.defaults": trusted_sdkconfig_defaults(selected_skills),
        "partitions.csv": trusted_partitions_csv(selected_skills),
    }
    for rel_path, content in generated_system_files.items():
        target = (build_dir / rel_path).resolve()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        expected.add(target)

    for root_name in ("main", "components", "spiffs"):
        root = build_dir / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_dir() or path.resolve() in expected:
                continue
            if root_name == "components" and str(path.resolve()).startswith(str((build_dir / "components" / "esp32_s3_szp").resolve())):
                continue
            if path.name == ".gitkeep":
                continue
            if path.suffix in ALLOWED_SUFFIXES or path.name in ALLOWED_FILENAMES:
                path.unlink(missing_ok=True)


def create_project(build_dir: Path, code: str, project_files: dict):
    shutil.copytree(TEMPLATE_DIR, build_dir)
    (build_dir / "spiffs").mkdir(exist_ok=True)
    sync_project_files(build_dir, code, project_files)


def prepare_cached_project(build_dir: Path, code: str, project_files: dict):
    signature = project_signature(code, project_files)
    template_signature = directory_signature(TEMPLATE_DIR)
    stamp = build_dir / ".vibeboard-project-signature"
    template_stamp = build_dir / ".vibeboard-template-signature"
    if not build_dir.exists():
        create_project(build_dir, code, project_files)
        stamp.write_text(signature)
        template_stamp.write_text(template_signature)
        return "cache-created"
    if not (build_dir / "CMakeLists.txt").exists():
        shutil.rmtree(build_dir, ignore_errors=True)
        create_project(build_dir, code, project_files)
        stamp.write_text(signature)
        template_stamp.write_text(template_signature)
        return "cache-recreated"
    previous = stamp.read_text(errors="ignore").strip() if stamp.exists() else ""
    previous_template = template_stamp.read_text(errors="ignore").strip() if template_stamp.exists() else ""
    if previous_template != template_signature:
        shutil.rmtree(build_dir, ignore_errors=True)
        create_project(build_dir, code, project_files)
        stamp.write_text(signature)
        template_stamp.write_text(template_signature)
        return "cache-recreated-template"
    if previous != signature:
        sync_project_files(build_dir, code, project_files)
        stamp.write_text(signature)
        template_stamp.write_text(template_signature)
        return "cache-updated"
    return "cache-hit"


def list_official_examples():
    if not EXAMPLES_DIR.exists():
        return []
    examples = []
    for entry in sorted(EXAMPLES_DIR.iterdir()):
        if not entry.is_dir() or not EXAMPLE_ID_RE.match(entry.name):
            continue
        if not (entry / "CMakeLists.txt").exists() or not (entry / "main").is_dir():
            continue
        file_count = sum(1 for p in entry.rglob("*") if p.is_file())
        examples.append({
            "id": entry.name,
            "fileCount": file_count,
            "hasSpiffs": (entry / "spiffs").is_dir(),
        })
    return examples


def official_example_path(example_id: str) -> Path:
    if not isinstance(example_id, str) or not EXAMPLE_ID_RE.match(example_id):
        raise ValueError("invalid official example id")
    source = (EXAMPLES_DIR / example_id).resolve()
    root = EXAMPLES_DIR.resolve()
    try:
        source.relative_to(root)
    except ValueError as exc:
        raise ValueError("unsafe official example id") from exc
    if not source.is_dir():
        raise ValueError(f"official example not found: {example_id}")
    if not (source / "CMakeLists.txt").exists():
        raise ValueError(f"official example is not an ESP-IDF project: {example_id}")
    return source


def create_official_example_project(build_dir: Path, example_id: str):
    source = official_example_path(example_id)
    shutil.copytree(source, build_dir)
    log.info(f"  official example copied unchanged: {example_id}")


def prepare_cached_official_example(build_dir: Path, example_id: str):
    source = official_example_path(example_id)
    signature = directory_signature(source)
    stamp = build_dir / ".vibeboard-example-signature"
    if not build_dir.exists():
        shutil.copytree(source, build_dir)
        stamp.write_text(signature)
        return "cache-created"
    if not (build_dir / "CMakeLists.txt").exists():
        shutil.rmtree(build_dir, ignore_errors=True)
        shutil.copytree(source, build_dir)
        stamp.write_text(signature)
        return "cache-recreated"
    previous = stamp.read_text(errors="ignore").strip() if stamp.exists() else ""
    if previous != signature:
        shutil.rmtree(build_dir, ignore_errors=True)
        shutil.copytree(source, build_dir)
        stamp.write_text(signature)
        return "cache-updated"
    return "cache-hit"


def c_string(value: str) -> str:
    return json.dumps(str(value or ""))[1:-1]


def create_ota_receiver_project(build_dir: Path, wifi_ssid: str, wifi_password: str, device_id: str, device_token: str, server_url: str, version: str | None = None):
    if not OTA_RECEIVER_DIR.exists():
        raise ValueError("OTA receiver template not installed")
    wifi_ssid = str(wifi_ssid or DEFAULT_OTA_WIFI_SSID)
    wifi_password = str(wifi_password if wifi_password is not None else DEFAULT_OTA_WIFI_PASSWORD)
    device_id = str(device_id or "szpi-s3-ota-receiver")
    device_token = str(device_token or "vibeboard-ota-receiver")
    if not isinstance(wifi_ssid, str) or not wifi_ssid.strip():
        raise ValueError("WiFi SSID is required")
    if len(wifi_ssid.encode("utf-8")) > 32:
        raise ValueError("WiFi SSID is too long")
    if len(str(wifi_password).encode("utf-8")) > 64:
        raise ValueError("WiFi password is too long")
    if device_id and not valid_device_id(device_id):
        raise ValueError("invalid device id")
    if device_token and not valid_token(device_token):
        raise ValueError("invalid device token")
    server_url = str(server_url or "").strip().rstrip("/")
    if server_url and not (server_url.startswith("http://") or server_url.startswith("https://")):
        raise ValueError("server URL must start with http:// or https://")

    shutil.copytree(OTA_RECEIVER_DIR, build_dir)
    config = build_dir / "main" / "vibeboard_wifi_config.h"
    version = version or f"vibeboard-ota-receiver-{uuid.uuid4().hex[:8]}"
    resolved_device_id = device_id
    resolved_device_token = device_token
    config.write_text(
        "#pragma once\n\n"
        f"#define VIBEBOARD_WIFI_SSID \"{c_string(wifi_ssid.strip())}\"\n"
        f"#define VIBEBOARD_WIFI_PASSWORD \"{c_string(wifi_password)}\"\n"
        f"#define VIBEBOARD_FIRMWARE_VERSION \"{version}\"\n"
        f"#define VIBEBOARD_DEVICE_ID \"{c_string(resolved_device_id)}\"\n"
        f"#define VIBEBOARD_DEVICE_TOKEN \"{c_string(resolved_device_token)}\"\n"
        f"#define VIBEBOARD_SERVER_URL \"{c_string(server_url)}\"\n"
    )
    log.info("  OTA receiver project created")
    return {
        "deviceId": resolved_device_id,
        "deviceToken": resolved_device_token,
        "serverUrl": server_url,
        "version": version,
    }


def ota_receiver_signature(wifi_ssid: str, wifi_password: str, device_id: str, device_token: str, server_url: str):
    payload = {
        "template": directory_signature(OTA_RECEIVER_DIR),
        "wifiSsid": str(wifi_ssid or DEFAULT_OTA_WIFI_SSID).strip(),
        "wifiPassword": str(wifi_password if wifi_password is not None else DEFAULT_OTA_WIFI_PASSWORD),
        "deviceId": str(device_id or "szpi-s3-ota-receiver"),
        "deviceToken": str(device_token or "vibeboard-ota-receiver"),
        "serverUrl": str(server_url or "").strip().rstrip("/"),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest(), payload


def prepare_cached_ota_receiver(build_dir: Path, wifi_ssid: str, wifi_password: str, device_id: str, device_token: str, server_url: str):
    signature, payload = ota_receiver_signature(wifi_ssid, wifi_password, device_id, device_token, server_url)
    version = f"vibeboard-ota-receiver-{signature[:8]}"
    stamp = build_dir / ".vibeboard-ota-receiver-signature"

    def recreate(status: str):
        shutil.rmtree(build_dir, ignore_errors=True)
        agent = create_ota_receiver_project(
            build_dir,
            payload["wifiSsid"],
            payload["wifiPassword"],
            payload["deviceId"],
            payload["deviceToken"],
            payload["serverUrl"],
            version=version,
        )
        stamp.write_text(signature)
        return status, agent

    if not build_dir.exists():
        return recreate("cache-created")
    if not (build_dir / "CMakeLists.txt").exists():
        return recreate("cache-recreated")
    previous = stamp.read_text(errors="ignore").strip() if stamp.exists() else ""
    if previous != signature:
        return recreate("cache-updated")
    return "cache-hit", {
        "deviceId": payload["deviceId"],
        "deviceToken": payload["deviceToken"],
        "serverUrl": payload["serverUrl"],
        "version": version,
    }


def ble_ota_receiver_signature():
    payload = {
        "template": directory_signature(BLE_OTA_RECEIVER_DIR),
        "deviceName": "ESP32-Vibe-OTA",
        "protocol": "vibeboard-ble-ota-v1",
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest(), payload


def prepare_cached_ble_ota_receiver(build_dir: Path):
    if not BLE_OTA_RECEIVER_DIR.exists():
        raise ValueError("BLE OTA receiver template not installed")

    signature, payload = ble_ota_receiver_signature()
    stamp = build_dir / ".vibeboard-ble-ota-receiver-signature"

    def recreate(status: str):
        shutil.rmtree(build_dir, ignore_errors=True)
        shutil.copytree(BLE_OTA_RECEIVER_DIR, build_dir)
        stamp.write_text(signature)
        return status, payload

    if not build_dir.exists():
        return recreate("cache-created")
    if not (build_dir / "CMakeLists.txt").exists():
        return recreate("cache-recreated")
    previous = stamp.read_text(errors="ignore").strip() if stamp.exists() else ""
    if previous != signature:
        return recreate("cache-updated")
    return "cache-hit", payload


def project_name(build_dir: Path) -> str:
    cmake = build_dir / "CMakeLists.txt"
    if not cmake.exists():
        return ""
    text = cmake.read_text(errors="ignore")
    match = re.search(r"project\s*\(\s*([A-Za-z0-9_.-]+)", text)
    return match.group(1) if match else ""


def find_app_binary(build_dir: Path) -> Path | None:
    build_output = build_dir / "build"
    name = project_name(build_dir)
    if name:
        candidate = build_output / f"{name}.bin"
        if candidate.exists():
            return candidate
    candidates = [
        p for p in build_output.glob("*.bin")
        if "bootloader" not in p.name.lower()
        and "partition" not in p.name.lower()
        and "ota_data" not in p.name.lower()
        and "ota-data" not in p.name.lower()
        and "storage" not in p.name.lower()
    ]
    return candidates[0] if candidates else None


def flash_artifact(build_dir: Path, name: str, offset: int, path: Path):
    if not path.exists():
        return None
    rel_path = path.relative_to(build_dir)
    return {
        "name": name,
        "offset": offset,
        "path": str(rel_path),
        "size": path.stat().st_size,
        "bin": base64.b64encode(path.read_bytes()).decode(),
    }


def find_flash_artifacts(build_dir: Path, app_bin: Path):
    build_output = build_dir / "build"
    artifacts = [
        flash_artifact(build_dir, "bootloader", 0x0, build_output / "bootloader" / "bootloader.bin"),
        flash_artifact(build_dir, "partition-table", 0x8000, build_output / "partition_table" / "partition-table.bin"),
        flash_artifact(build_dir, "ota-data", 0xD000, build_output / "ota_data_initial.bin"),
        flash_artifact(build_dir, "app", 0x10000, app_bin),
    ]
    return [artifact for artifact in artifacts if artifact]


def run_idf_build(job_id: str, build_dir: Path, cleanup: bool = True):
    env = os.environ.copy()
    env["IDF_PATH"] = str(IDF_PATH)
    cmd = [str(IDF_PATH / "tools" / "idf.py"),
           "-C", str(build_dir),
           "-B", str(build_dir / "build"),
           "build"]

    log.info(f"[{job_id}] Build started")
    yield sse({"log": f"[{job_id}] Build started..."})

    try:
        proc = subprocess.Popen(
            cmd, cwd=str(build_dir), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1
        )
        full_output = []
        for line in proc.stdout:
            line = line.rstrip()
            full_output.append(line)
            yield sse({"log": line})
        proc.wait(timeout=BUILD_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        yield sse({"done": True, "error": f"Build timeout ({BUILD_TIMEOUT_SECONDS}s)"})
        if cleanup:
            shutil.rmtree(build_dir, ignore_errors=True)
        return
    except Exception as e:
        yield sse({"done": True, "error": str(e)})
        if cleanup:
            shutil.rmtree(build_dir, ignore_errors=True)
        return

    if proc.returncode != 0:
        errors = [l for l in full_output if "error:" in l.lower() or "fatal error" in l.lower()]
        summary = "\n".join(errors[-20:]) if errors else "\n".join(full_output[-30:])
        log.warning(f"[{job_id}] Build FAILED")
        yield sse({"done": True, "error": summary})
        if cleanup:
            shutil.rmtree(build_dir, ignore_errors=True)
        return

    bin_path = find_app_binary(build_dir)
    if not bin_path:
        yield sse({"done": True, "error": "binary not found after build"})
        if cleanup:
            shutil.rmtree(build_dir, ignore_errors=True)
        return

    size = bin_path.stat().st_size
    log.info(f"[{job_id}] OK -> {bin_path.name} ({size} bytes)")
    yield sse({"log": f"Build succeeded -- {bin_path.name} ({size // 1024} KB)"})

    bin_b64 = base64.b64encode(bin_path.read_bytes()).decode()
    flash_files = find_flash_artifacts(build_dir, bin_path)
    yield sse({
        "done": True,
        "bin": bin_b64,
        "size": size,
        "filename": bin_path.name,
        "flashFiles": flash_files,
        "buildId": job_id,
        "command": " ".join(cmd),
    })
    if cleanup:
        shutil.rmtree(build_dir, ignore_errors=True)


def cached_build_payload(job_id: str, build_dir: Path):
    bin_path = find_app_binary(build_dir)
    if not bin_path:
        return None
    size = bin_path.stat().st_size
    bin_b64 = base64.b64encode(bin_path.read_bytes()).decode()
    return {
        "done": True,
        "bin": bin_b64,
        "size": size,
        "filename": bin_path.name,
        "flashFiles": find_flash_artifacts(build_dir, bin_path),
        "buildId": job_id,
        "command": "cached build artifact",
    }


def with_extra_done_metadata(events, metadata: dict):
    for event in events:
        if event.startswith("data: "):
            try:
                payload = json.loads(event[6:].strip())
                if payload.get("done") and not payload.get("error"):
                    payload.update(metadata)
                    yield sse(payload)
                    continue
            except Exception:
                pass
        yield event


def with_build_dir_lock(job_id: str, build_dir: Path, events_factory):
    lock_path = BUILD_BASE / f".{build_dir.name}.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as lock_file:
        waiting = False
        while True:
            try:
                if fcntl is not None:
                    fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if not waiting:
                    yield sse({"log": f"[{job_id}] Waiting for an existing cached build to finish..."})
                    waiting = True
                time.sleep(1)
        try:
            yield from events_factory()
        finally:
            if fcntl is not None:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def sse(obj):
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.route("/health")
def health():
    return jsonify({"status": "ok", "idf": str(IDF_PATH)})


@app.route("/preview/lvgl/status")
def preview_lvgl_status():
    native_lvgl = (LVGL_SOURCE_DIR / "lvgl.h").exists()
    native_runner = (LVGL_PREVIEW_RUNNER_DIR / "build_runner.py").exists()
    native_gcc = shutil.which(os.environ.get("CC", "gcc")) is not None
    wsl_available = os.name == "nt" and shutil.which("wsl.exe") is not None
    wsl_source = WSL_LVGL_SOURCE_DIR or (windows_path_to_wsl(LVGL_SOURCE_DIR) if os.name == "nt" else "")
    wsl_ready = can_use_wsl_preview() if wsl_available else False
    return jsonify({
        "mode": LVGL_PREVIEW_MODE,
        "realPreviewReady": (native_lvgl and native_runner and native_gcc) or wsl_ready,
        "native": {
            "lvglSourceDir": str(LVGL_SOURCE_DIR),
            "lvglSourceFound": native_lvgl,
            "runnerDir": str(LVGL_PREVIEW_RUNNER_DIR),
            "runnerFound": native_runner,
            "gccFound": native_gcc,
        },
        "wsl": {
            "available": wsl_available,
            "sourceDir": wsl_source,
            "ready": wsl_ready,
        },
        "renderers": ["real-lvgl-8.3-headless", "intent-lvgl-preview"],
    })


@app.route("/examples")
def examples():
    return jsonify({"examples": list_official_examples()})


@app.route("/preview/lvgl", methods=["POST"])
def preview_lvgl():
    data = request.get_json(force=True)
    project_files = data.get("projectFiles", {})
    if not isinstance(project_files, dict):
        return jsonify({
            "status": "failure",
            "category": "preview-contract-missing",
            "summary": "projectFiles must be an object.",
            "diagnostics": [{"message": "projectFiles must be an object."}],
            "peripherals": [],
        }), 400

    selected_skills = data.get("selectedSkills") or []
    manifest = data.get("manifest") or {}
    viewport = normalize_viewport((data.get("viewport") or ((manifest.get("preview") or {}).get("viewport"))))
    interactions = data.get("interactions") or []
    peripherals = preview_peripherals(selected_skills, manifest)
    diagnostics = validate_lvgl_preview_contract(project_files)
    if diagnostics:
        return jsonify({
            "status": "failure",
            "category": "preview-contract-missing",
            "summary": "LVGL preview contract is missing or not portable.",
            "diagnostics": diagnostics,
            "peripherals": peripherals,
        }), 400

    try:
        png, renderer, render_diagnostics = render_lvgl_preview_with_fallback(
            project_files,
            selected_skills,
            manifest,
            viewport,
            interactions,
        )
    except Exception as exc:
        return jsonify({
            "status": "failure",
            "category": "preview-build-failed",
            "summary": str(exc),
            "diagnostics": [{"message": str(exc)}],
            "peripherals": peripherals,
        }), 500

    return jsonify({
        "status": "success",
        "category": None,
        "screenshotPng": base64.b64encode(png).decode(),
        "diagnostics": [{
            "message": "Preview contract passed. Review the first-screen layout before compiling or OTA flashing.",
        }, *render_diagnostics],
        "peripherals": peripherals,
        "summary": "LVGL preview rendered successfully.",
        "viewport": viewport,
        "renderer": renderer,
        "interactions": interactions,
    })


@app.route("/api/devices/heartbeat", methods=["POST"])
def device_heartbeat():
    data = request.get_json(force=True)
    device_id = str(data.get("deviceId", "")).strip()
    token = str(data.get("token", "")).strip()
    if not valid_device_id(device_id) or not valid_token(token):
        return jsonify({"error": "invalid device identity"}), 400

    devices = load_devices()
    if not authorize_device(devices, device_id, token):
        return jsonify({"error": "invalid device token"}), 403

    previous = devices.get(device_id, {})
    device = {
        **previous,
        "deviceId": device_id,
        "token": token,
        "boardId": data.get("boardId") or previous.get("boardId") or "szpi_esp32s3",
        "version": data.get("version") or previous.get("version") or "",
        "ip": data.get("ip") or previous.get("ip") or "",
        "rssi": data.get("rssi", previous.get("rssi", 0)),
        "lastSeenAt": now_ms(),
    }
    devices[device_id] = device
    save_devices(devices)

    jobs = load_jobs()
    pending = next(
        (job for job in jobs.values()
         if job.get("deviceId") == device_id and job.get("status") in {"queued", "claimed", "downloading"}),
        None,
    )
    return jsonify({
        "ok": True,
        "device": public_device(device),
        "pendingJobId": pending.get("jobId") if pending else None,
    })


@app.route("/api/devices")
def list_devices():
    devices = load_devices()
    return jsonify({"devices": [public_device(device) for device in devices.values()]})


@app.route("/api/firmware", methods=["POST"])
def upload_firmware():
    if "file" not in request.files:
        return jsonify({"error": "missing firmware file"}), 400
    file = request.files["file"]
    data = file.read()
    if not data:
        return jsonify({"error": "empty firmware"}), 400
    if len(data) > 8 * 1024 * 1024:
        return jsonify({"error": "firmware too large"}), 400

    firmware_id = uuid.uuid4().hex
    filename = secure_firmware_filename(file.filename or "firmware.bin")
    stored_name = f"{firmware_id}.bin"
    path = REMOTE_OTA_DIR / "firmware" / stored_name
    path.write_bytes(data)

    index = load_firmware_index()
    meta = {
        "firmwareId": firmware_id,
        "filename": filename,
        "size": len(data),
        "createdAt": now_ms(),
        "url": f"{public_base_url()}/api/firmware/{firmware_id}/download",
    }
    index[firmware_id] = meta
    save_firmware_index(index)
    return jsonify({"firmware": meta})


@app.route("/api/firmware")
def list_firmware():
    index = load_firmware_index()
    return jsonify({"firmware": sorted(index.values(), key=lambda item: item.get("createdAt", 0), reverse=True)})


@app.route("/api/firmware/<firmware_id>/download")
def download_firmware(firmware_id):
    index = load_firmware_index()
    meta = index.get(firmware_id)
    path = REMOTE_OTA_DIR / "firmware" / f"{firmware_id}.bin"
    if not meta or not path.exists():
        return jsonify({"error": "firmware not found"}), 404
    return send_file(path, mimetype="application/octet-stream", as_attachment=False, download_name=meta.get("filename", "firmware.bin"))


@app.route("/api/ota-jobs", methods=["POST"])
def create_ota_job():
    data = request.get_json(force=True)
    device_id = str(data.get("deviceId", "")).strip()
    firmware_id = str(data.get("firmwareId", "")).strip()
    if not valid_device_id(device_id):
        return jsonify({"error": "invalid device id"}), 400

    devices = load_devices()
    if device_id not in devices:
        return jsonify({"error": "device not found"}), 404

    firmware_index = load_firmware_index()
    firmware = firmware_index.get(firmware_id)
    if not firmware:
        return jsonify({"error": "firmware not found"}), 404

    jobs = load_jobs()
    job_id = uuid.uuid4().hex
    job = {
        "jobId": job_id,
        "deviceId": device_id,
        "firmwareId": firmware_id,
        "firmwareUrl": firmware.get("url") or f"{public_base_url()}/api/firmware/{firmware_id}/download",
        "firmwareSize": firmware.get("size", 0),
        "filename": firmware.get("filename", "firmware.bin"),
        "status": "queued",
        "createdAt": now_ms(),
        "updatedAt": now_ms(),
        "claimedAt": None,
        "finishedAt": None,
        "error": "",
    }
    jobs[job_id] = job
    save_jobs(jobs)
    return jsonify({"job": job})


@app.route("/api/ota-jobs")
def list_ota_jobs():
    jobs = load_jobs()
    return jsonify({"jobs": sorted(jobs.values(), key=lambda item: item.get("createdAt", 0), reverse=True)})


@app.route("/api/ota-jobs/<job_id>")
def get_ota_job(job_id):
    jobs = load_jobs()
    job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "job not found"}), 404
    return jsonify({"job": job})


@app.route("/api/devices/<device_id>/ota-job")
def claim_device_ota_job(device_id):
    token = request.headers.get("X-Device-Token", request.args.get("token", ""))
    devices = load_devices()
    if not authorize_device(devices, device_id, token):
        return jsonify({"error": "invalid device token"}), 403

    jobs = load_jobs()
    job = next(
        (candidate for candidate in sorted(jobs.values(), key=lambda item: item.get("createdAt", 0))
         if candidate.get("deviceId") == device_id and candidate.get("status") in {"queued", "claimed", "downloading"}),
        None,
    )
    if not job:
        return jsonify({"job": None})

    if job.get("status") == "queued":
        job["status"] = "claimed"
        job["claimedAt"] = now_ms()
        job["updatedAt"] = now_ms()
        jobs[job["jobId"]] = job
        save_jobs(jobs)
    return jsonify({"job": job})


@app.route("/api/ota-jobs/<job_id>/status", methods=["POST"])
def update_ota_job_status(job_id):
    data = request.get_json(force=True)
    device_id = str(data.get("deviceId", "")).strip()
    token = str(data.get("token", "")).strip()
    status = str(data.get("status", "")).strip()
    if status not in {"queued", "claimed", "downloading", "flashed", "rebooting", "done", "failed"}:
        return jsonify({"error": "invalid job status"}), 400

    devices = load_devices()
    if not authorize_device(devices, device_id, token):
        return jsonify({"error": "invalid device token"}), 403

    jobs = load_jobs()
    job = jobs.get(job_id)
    if not job or job.get("deviceId") != device_id:
        return jsonify({"error": "job not found"}), 404

    job["status"] = status
    job["updatedAt"] = now_ms()
    if status in {"done", "failed"}:
        job["finishedAt"] = now_ms()
    if data.get("error"):
        job["error"] = str(data.get("error"))[:500]
    jobs[job_id] = job
    save_jobs(jobs)
    return jsonify({"job": job})


@app.route("/compile", methods=["POST"])
def compile_code():
    data = request.get_json(force=True)
    code = data.get("code", "").strip()
    project_files = dict(data.get("projectFiles", {}))
    project_id = normalized_project_id(data.get("projectId"))

    if not code:
        return jsonify({"error": "no code provided"}), 400

    job_id = uuid.uuid4().hex[:8]
    build_dir = BUILD_BASE / (f"project-{project_id}" if project_id else job_id)

    def generate():
        try:
            cache_status = prepare_cached_project(build_dir, code, project_files) if project_id else None
            if cache_status:
                yield sse({"log": f"Incremental build cache: {cache_status}"})
            else:
                create_project(build_dir, code, project_files)
        except Exception as e:
            yield sse({"done": True, "error": str(e)})
            return
        yield from run_idf_build(job_id, build_dir, cleanup=not project_id)

    return Response(generate(), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/compile-example", methods=["POST"])
def compile_example():
    data = request.get_json(force=True)
    example_id = data.get("exampleId", "")

    job_id = uuid.uuid4().hex[:8]
    build_dir = BUILD_BASE / fixed_build_id("example", str(example_id))

    def generate():
        try:
            cache_status = prepare_cached_official_example(build_dir, example_id)
            yield sse({"log": f"Official example cache: {cache_status}"})
        except Exception as e:
            yield sse({"done": True, "error": str(e)})
            return
        if cache_status == "cache-hit":
            cached = cached_build_payload(job_id, build_dir)
            if cached:
                yield sse({"log": "Official example cached artifact reused"})
                yield sse(cached)
                return
        yield from run_idf_build(job_id, build_dir, cleanup=False)

    return Response(generate(), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/compile-ota-receiver", methods=["POST"])
def compile_ota_receiver():
    data = request.get_json(force=True)
    wifi_ssid = data.get("wifiSsid", "")
    wifi_password = data.get("wifiPassword", "")
    device_id = data.get("deviceId", "")
    device_token = data.get("deviceToken", "")
    server_url = data.get("serverUrl", "")

    job_id = uuid.uuid4().hex[:8]
    signature, _ = ota_receiver_signature(wifi_ssid, wifi_password, device_id, device_token, server_url)
    build_dir = BUILD_BASE / f"ota-receiver-{signature[:16]}"

    def generate():
        def locked_generate():
            try:
                cache_status, agent = prepare_cached_ota_receiver(build_dir, wifi_ssid, wifi_password, device_id, device_token, server_url)
                yield sse({"log": f"OTA receiver cache: {cache_status}"})
            except Exception as e:
                yield sse({"done": True, "error": str(e)})
                return
            if cache_status == "cache-hit":
                cached = cached_build_payload(job_id, build_dir)
                if cached:
                    yield sse({"log": "OTA receiver cached artifact reused"})
                    cached.update({"agent": agent})
                    yield sse(cached)
                    return
            yield from with_extra_done_metadata(run_idf_build(job_id, build_dir, cleanup=False), {"agent": agent})

        yield from with_build_dir_lock(job_id, build_dir, locked_generate)

    return Response(generate(), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/compile-ble-ota-receiver", methods=["POST"])
def compile_ble_ota_receiver():
    job_id = uuid.uuid4().hex[:8]
    signature, _ = ble_ota_receiver_signature()
    build_dir = BUILD_BASE / f"ble-ota-receiver-{signature[:16]}"

    def generate():
        def locked_generate():
            try:
                cache_status, info = prepare_cached_ble_ota_receiver(build_dir)
                yield sse({"log": f"BLE OTA receiver cache: {cache_status}"})
            except Exception as e:
                yield sse({"done": True, "error": str(e)})
                return
            if cache_status == "cache-hit":
                cached = cached_build_payload(job_id, build_dir)
                if cached:
                    yield sse({"log": "BLE OTA receiver cached artifact reused"})
                    cached.update({"agent": info})
                    yield sse(cached)
                    return
            yield from with_extra_done_metadata(run_idf_build(job_id, build_dir, cleanup=False), {"agent": info})

        yield from with_build_dir_lock(job_id, build_dir, locked_generate)

    return Response(generate(), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8760, debug=False)
