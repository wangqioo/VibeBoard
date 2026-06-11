import assert from 'node:assert/strict'
import { createNordicAppFiles, normalizeNordicAppName } from '../src/domain/nordic/appTemplate.js'
import { NORDIC_BOARD_PROFILE, listNordicCapabilities, listNordicBoards } from '../src/domain/nordic/boardProfile.js'

assert.equal(NORDIC_BOARD_PROFILE.boardTarget, 'xiao_ble')
assert.ok(listNordicBoards().some(board => board.boardTarget === 'xiao_ble'))
assert.ok(listNordicBoards().some(board => board.boardTarget === 'xiao_ble/nrf52840/sense'))
assert.ok(listNordicBoards().some(board => board.boardTarget === 'nrf52840dk/nrf52840'))
assert.ok(listNordicCapabilities().some(cap => cap.id === 'ble_peripheral'))

assert.equal(normalizeNordicAppName('BLE GPIO Demo!'), 'ble_gpio_demo')

const files = createNordicAppFiles({
  displayName: 'BLE GPIO Demo',
  description: 'Use BLE, LED and UART logs',
  capabilities: ['ble_peripheral', 'gpio_led_button', 'uart_console'],
})

assert.ok(files['CMakeLists.txt'].includes('find_package(Zephyr REQUIRED'))
assert.ok(files['CMakeLists.txt'].includes('target_sources(app PRIVATE src/main.c)'))
assert.ok(files['prj.conf'].includes('CONFIG_BT=y'))
assert.ok(files['prj.conf'].includes('CONFIG_GPIO=y'))
assert.ok(files['prj.conf'].includes('CONFIG_UART_CONSOLE=y'))
assert.ok(files['prj.conf'].includes('CONFIG_NET_BUF=y'))
assert.ok(files['prj.conf'].includes('CONFIG_FLASH=y'))
assert.ok(files['prj.conf'].includes('CONFIG_BOOTLOADER_MCUBOOT=y'))
assert.ok(files['prj.conf'].includes('CONFIG_MCUMGR=y'))
assert.ok(files['prj.conf'].includes('CONFIG_MCUMGR_TRANSPORT_UART=y'))
assert.ok(files['prj.conf'].includes('CONFIG_MCUMGR_GRP_IMG=y'))
assert.ok(files['prj.conf'].includes('CONFIG_MCUMGR_GRP_OS=y'))
assert.ok(files['prj.conf'].includes('CONFIG_IMG_MANAGER=y'))
assert.ok(files['prj.conf'].includes('CONFIG_MCUBOOT_IMG_MANAGER=y'))
assert.ok(files['prj.conf'].includes('CONFIG_FLASH_MAP=y'))
assert.ok(files['prj.conf'].includes('CONFIG_STREAM_FLASH=y'))
assert.ok(files['prj.conf'].includes('CONFIG_BASE64=y'))
assert.ok(files['prj.conf'].includes('CONFIG_CRC=y'))
assert.ok(files['prj.conf'].includes('CONFIG_ZCBOR=y'))
assert.ok(files['prj.conf'].includes('CONFIG_BUILD_OUTPUT_UF2=y'))
assert.ok(files['sysbuild.conf'].includes('SB_CONFIG_BOOTLOADER_MCUBOOT=y'))
assert.ok(files['boards/xiao_ble.overlay'].includes('slot0_partition'))
assert.ok(files['boards/xiao_ble.overlay'].includes('slot1_partition'))
assert.ok(files['boards/xiao_ble.overlay'].includes('boot_partition'))
assert.equal(files['sysbuild/mcuboot/boards/xiao_ble.overlay'], files['boards/xiao_ble.overlay'])
assert.ok(files['sysbuild/mcuboot/prj.conf'].includes('CONFIG_FLASH=y'))
assert.ok(files['sysbuild/mcuboot/prj.conf'].includes('CONFIG_BOOT_MAX_IMG_SECTORS=256'))
assert.ok(files['sysbuild/mcuboot/prj.conf'].includes('CONFIG_CONSOLE=n'))
assert.ok(files['sysbuild/mcuboot/prj.conf'].includes('CONFIG_SERIAL=n'))
assert.ok(files['src/main.c'].includes('#include <zephyr/bluetooth/bluetooth.h>'))
assert.ok(files['src/main.c'].includes('#include <zephyr/dfu/mcuboot.h>'))
assert.ok(files['src/main.c'].includes('boot_write_img_confirmed()'))
assert.ok(files['src/main.c'].includes('BT_DATA_NAME_COMPLETE'))
assert.ok(files['src/main.c'].includes('GPIO_DT_SPEC_GET_OR(LED0_NODE'))
assert.ok(files['src/main.c'].includes('bt_le_adv_start'))
assert.ok(files['src/main.c'].includes('BT_LE_ADV_CONN_FAST_1'))
assert.ok(!files['src/main.c'].includes('BT_LE_ADV_CONN_NAME'))
assert.ok(files['README.md'].includes('west build -b xiao_ble .'))
assert.ok(files['README.md'].includes('zephyr.signed.bin'))
assert.ok(files['README.md'].includes('Web Serial DFU'))

console.log('nordic app template tests passed')
