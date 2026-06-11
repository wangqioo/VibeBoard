import { NORDIC_BOARD_PROFILE, getNordicBoardProfile } from './boardProfile.js'

export function normalizeNordicAppName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'vibeboard_nordic_app'
}

export function createDefaultNordicConfig() {
  return {
    appName: 'vibeboard_nordic_app',
    displayName: 'XIAO nRF BLE GPIO Demo',
    description: 'BLE peripheral with GPIO LED heartbeat, UART console logs, and Zephyr-ready project files for Seeed XIAO nRF52840.',
    boardId: NORDIC_BOARD_PROFILE.id,
    boardTarget: NORDIC_BOARD_PROFILE.boardTarget,
    capabilities: ['ble_peripheral', 'gpio_led_button', 'uart_console'],
  }
}

export function createNordicAppFiles(config = {}) {
  const merged = { ...createDefaultNordicConfig(), ...config }
  const board = getNordicBoardProfile(merged.boardId || merged.boardTarget)
  const appName = normalizeNordicAppName(merged.appName || merged.displayName)
  const capabilities = new Set(Array.isArray(merged.capabilities) ? merged.capabilities : [])
  const files = {
    'CMakeLists.txt': createCMakeLists(appName),
    'prj.conf': createPrjConf(capabilities),
    'sysbuild.conf': createSysbuildConf(),
    'src/main.c': createMainC({ ...merged, appName, capabilities, board }),
    'README.md': createReadme({ ...merged, appName, boardTarget: board.boardTarget, boardName: board.name }),
  }
  if (board.boardTarget.startsWith('xiao_ble')) {
    const overlay = createXiaoBleMcubootOverlay()
    files['boards/xiao_ble.overlay'] = overlay
    files['sysbuild/mcuboot/prj.conf'] = createMcubootPrjConf()
    files['sysbuild/mcuboot/boards/xiao_ble.overlay'] = overlay
  }
  return files
}

function createCMakeLists(appName) {
  return `cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(${appName})

target_sources(app PRIVATE src/main.c)
`
}

function createPrjConf(capabilities) {
  const lines = [
    'CONFIG_GPIO=y',
    'CONFIG_SERIAL=y',
    'CONFIG_CONSOLE=y',
    'CONFIG_UART_CONSOLE=y',
    'CONFIG_LOG=y',
    'CONFIG_PRINTK=y',
    'CONFIG_NET_BUF=y',
    'CONFIG_FLASH=y',
    'CONFIG_BOOTLOADER_MCUBOOT=y',
    'CONFIG_MCUMGR=y',
    'CONFIG_MCUMGR_TRANSPORT_UART=y',
    'CONFIG_MCUMGR_GRP_IMG=y',
    'CONFIG_MCUMGR_GRP_OS=y',
    'CONFIG_IMG_MANAGER=y',
    'CONFIG_MCUBOOT_IMG_MANAGER=y',
    'CONFIG_FLASH_MAP=y',
    'CONFIG_STREAM_FLASH=y',
    'CONFIG_BASE64=y',
    'CONFIG_CRC=y',
    'CONFIG_ZCBOR=y',
    'CONFIG_BUILD_OUTPUT_UF2=y',
  ]
  if (capabilities.has('ble_peripheral')) {
    lines.push(
      'CONFIG_BT=y',
      'CONFIG_BT_PERIPHERAL=y',
      'CONFIG_BT_DEVICE_NAME="VibeBoard nRF"',
      'CONFIG_BT_DEVICE_APPEARANCE=833',
    )
  }
  if (capabilities.has('i2c_sensor')) {
    lines.push('CONFIG_I2C=y', 'CONFIG_SENSOR=y')
  }
  return `${[...new Set(lines)].join('\n')}\n`
}

function createSysbuildConf() {
  return `SB_CONFIG_BOOTLOADER_MCUBOOT=y
`
}

function createXiaoBleMcubootOverlay() {
  return `/ {
    chosen {
        zephyr,code-partition = &slot0_partition;
        zephyr,uart-mcumgr = &uart0;
    };
};

&flash0 {
    /delete-node/ partitions;

    partitions {
        compatible = "fixed-partitions";
        #address-cells = <1>;
        #size-cells = <1>;

        boot_partition: partition@0 {
            label = "mcuboot";
            reg = <0x00000000 0x0000c000>;
        };

        slot0_partition: partition@c000 {
            label = "image-0";
            reg = <0x0000c000 0x00076000>;
        };

        slot1_partition: partition@82000 {
            label = "image-1";
            reg = <0x00082000 0x00076000>;
        };

        storage_partition: partition@f8000 {
            label = "storage";
            reg = <0x000f8000 0x00008000>;
        };
    };
};
`
}

function createMcubootPrjConf() {
  return `CONFIG_MAIN_STACK_SIZE=10240
CONFIG_FLASH=y
CONFIG_BOOT_MAX_IMG_SECTORS=256
CONFIG_MULTITHREADING=y
CONFIG_LOG=n
CONFIG_CONSOLE=n
CONFIG_CONSOLE_HANDLER=n
CONFIG_UART_CONSOLE=n
CONFIG_SERIAL=n
CONFIG_PRINTK=n
CONFIG_CBPRINTF_NANO=y
CONFIG_NCS_APPLICATION_BOOT_BANNER_STRING="MCUboot"
`
}

function createMainC({ displayName, description, capabilities, board }) {
  const hasBle = capabilities.has('ble_peripheral')
  const hasGpio = capabilities.has('gpio_led_button')
  const hasUart = capabilities.has('uart_console')
  return `#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/sys/printk.h>
#include <zephyr/dfu/mcuboot.h>
${hasBle ? '#include <zephyr/bluetooth/bluetooth.h>\n#include <zephyr/bluetooth/hci.h>' : ''}

#define APP_NAME "${escapeCString(displayName)}"
#define APP_DESCRIPTION "${escapeCString(description)}"

${hasGpio ? `#define LED0_NODE DT_ALIAS(led0)
#define SW0_NODE DT_ALIAS(sw0)

static const struct gpio_dt_spec led = GPIO_DT_SPEC_GET_OR(LED0_NODE, gpios, {0});
static const struct gpio_dt_spec button = GPIO_DT_SPEC_GET_OR(SW0_NODE, gpios, {0});
` : ''}
${hasBle ? `
static const struct bt_data ad[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, (BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR)),
};

static const struct bt_data sd[] = {
    BT_DATA(BT_DATA_NAME_COMPLETE, CONFIG_BT_DEVICE_NAME, sizeof(CONFIG_BT_DEVICE_NAME) - 1),
};

static void nordic_ble_ready(int err)
{
    if (err) {
        printk("Bluetooth init failed: %d\\n", err);
        return;
    }
    printk("Bluetooth ready: %s\\n", CONFIG_BT_DEVICE_NAME);
    err = bt_le_adv_start(BT_LE_ADV_CONN_FAST_1, ad, ARRAY_SIZE(ad), sd, ARRAY_SIZE(sd));
    if (err) {
        printk("Advertising failed: %d\\n", err);
        return;
    }
    printk("BLE advertising started\\n");
}
` : ''}

int main(void)
{
    int confirm_err = boot_write_img_confirmed();
    if (confirm_err) {
        printk("MCUboot image confirm skipped: %d\\n", confirm_err);
    }

    printk("%s\\n", APP_NAME);
    printk("%s\\n", APP_DESCRIPTION);
    printk("Board: ${board.boardTarget}\\n");

${hasGpio ? `    if (!gpio_is_ready_dt(&led)) {
        printk("LED GPIO is not ready\\n");
    } else {
        gpio_pin_configure_dt(&led, GPIO_OUTPUT_INACTIVE);
    }

    if (button.port && gpio_is_ready_dt(&button)) {
        gpio_pin_configure_dt(&button, GPIO_INPUT);
        printk("Button GPIO ready\\n");
    }
` : ''}
${hasBle ? `    int err = bt_enable(nordic_ble_ready);
    if (err) {
        printk("Bluetooth enable failed: %d\\n", err);
    }
` : ''}
${hasUart ? '    printk("UART console ready\\n");\n' : ''}
    while (1) {
${hasGpio ? `        if (led.port && gpio_is_ready_dt(&led)) {
            gpio_pin_toggle_dt(&led);
        }
        if (button.port && gpio_is_ready_dt(&button)) {
            printk("button=%d\\n", gpio_pin_get_dt(&button));
        }
` : '        printk("Nordic app heartbeat\\n");\n'}
        k_sleep(K_SECONDS(1));
    }
    return 0;
}
`
}

function createReadme({ displayName, description, boardTarget, boardName }) {
  return `# ${displayName}

${description}

Generated for ${boardName || NORDIC_BOARD_PROFILE.name} on ${NORDIC_BOARD_PROFILE.framework}.

Build:

\`\`\`sh
west build -b ${boardTarget || NORDIC_BOARD_PROFILE.boardTarget} .
\`\`\`

Flash:

\`\`\`sh
west flash
\`\`\`

Browser DFU:

- Run \`west flash\` once to provision MCUboot and the MCUmgr serial endpoint.
- After that first wired flash, build artifacts include \`zephyr.signed.bin\`.
- VibeBoard can use Web Serial DFU to upload \`zephyr.signed.bin\`, mark it for test boot, and reset the board.
- The generated app confirms itself on boot with \`boot_write_img_confirmed()\`, so the new image stays active after a successful start.
`
}

function escapeCString(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')
}
