import assert from 'node:assert/strict'
import {
  HUANGSHAN_BOARD_ID,
  HUANGSHAN_BOARD_PROFILE,
  HUANGSHAN_SOURCE_PATHS,
  getHuangshanCapability,
  listHuangshanCapabilities,
  listHuangshanExampleRecipes,
} from '../src/domain/huangshan/boardProfile.js'

assert.equal(HUANGSHAN_BOARD_ID, 'huangshan_pi_sf32lb52')
assert.equal(HUANGSHAN_BOARD_PROFILE.id, 'huangshan_pi_sf32lb52')
assert.equal(HUANGSHAN_BOARD_PROFILE.targetBoard, 'sf32lb52-lchspi-ulp')
assert.equal(HUANGSHAN_BOARD_PROFILE.framework, 'SiFli SDK release/v2.4 + RT-Thread + SCons')
assert.equal(HUANGSHAN_BOARD_PROFILE.display.resolution.width, 390)
assert.equal(HUANGSHAN_BOARD_PROFILE.display.resolution.height, 450)
assert.equal(HUANGSHAN_BOARD_PROFILE.touch.controller, 'FT6146-M00')
assert.equal(HUANGSHAN_BOARD_PROFILE.debug.defaultSerialPort, '/dev/cu.usbserial-110')
assert.equal(HUANGSHAN_BOARD_PROFILE.debug.logBaud, 1000000)
assert.equal(HUANGSHAN_BOARD_PROFILE.bringUp.requiredCo5300Patch, true)
assert.deepEqual(HUANGSHAN_BOARD_PROFILE.bringUp.acceptedCo5300Ids, ['0x331100', '0x1fff', '0x3fff'])

const capabilities = listHuangshanCapabilities().map(item => item.id)
assert.deepEqual(capabilities.slice(0, 5), ['lvgl_app', 'sensor', 'ws2812', 'gpio_key', 'charger'])
assert.equal(getHuangshanCapability('lvgl_app').referencePaths[0], 'lvgl/watch')
assert.equal(getHuangshanCapability('charger').referencePaths.includes('I2C/charger'), true)
assert.equal(getHuangshanCapability('tf_card').referencePaths.includes('example/rt_device/spi_tf'), true)
assert.equal(getHuangshanCapability('usb_fs').referencePaths.includes('example/rt_device/usb/usb_vcom'), true)
assert.equal(getHuangshanCapability('bluetooth').referencePaths.includes('example/ble/peripheral'), true)
assert.equal(getHuangshanCapability('ble'), null)
assert.equal(getHuangshanCapability('motor').referencePaths.includes('customer/peripherals/vibrator/vibrator.c'), true)
assert.equal(getHuangshanCapability('audio'), null)
assert.equal(getHuangshanCapability('audio_pdm').referencePaths.includes('example/rt_device/pdm'), true)
assert.equal(getHuangshanCapability('audio_i2s').referencePaths.includes('example/rt_device/i2s'), true)
assert.equal(getHuangshanCapability('audio_audprc').referencePaths.includes('example/rt_device/audprc'), true)
assert.equal(getHuangshanCapability('missing'), null)

const recipes = listHuangshanExampleRecipes()
assert.equal(recipes.length >= 5, true)
assert.equal(recipes.find(recipe => recipe.id === 'gpio_key2_pa43_pin20').sourcePath, 'gpio/src/main.c')
assert.deepEqual(recipes.find(recipe => recipe.id === 'adc_vbat_pa34').capabilities, ['battery', 'adc_gpio'])
assert.equal(recipes.find(recipe => recipe.id === 'ws2812_pa32_rgbled').facts.includes('RGB LED device is rgbled'), true)
assert.equal(recipes.find(recipe => recipe.id === 'uart2_pa18_pa19').facts.includes('UART2 RX is PA18'), true)
assert.equal(recipes.find(recipe => recipe.id === 'i2c3_sensors').capabilities.includes('magnetometer'), true)
const chargerRecipe = recipes.find(recipe => recipe.id === 'charger_aw32001_i2c2')
assert.equal(Boolean(chargerRecipe), true)
assert.deepEqual(chargerRecipe.capabilities, ['charger'])
assert.equal(chargerRecipe.sourcePath, 'I2C/charger/src/main.c')
assert.equal(chargerRecipe.facts.includes('AW32001 I2C 7-bit address is 0x49'), true)
assert.equal(recipes.find(recipe => recipe.id === 'spi_tf_sd0').facts.includes('TF card block device is sd0'), true)
assert.equal(recipes.find(recipe => recipe.id === 'usb_vcom_cdc').facts.includes('USB CDC device is vcom'), true)
assert.equal(recipes.find(recipe => recipe.id === 'ble_peripheral_service').facts.includes('enables CONFIG_BLUETOOTH'), true)
assert.equal(recipes.find(recipe => recipe.id === 'audio_pdm_record').facts.includes('PDM device names include pdm1 and pdm2'), true)
assert.equal(recipes.find(recipe => recipe.id === 'pm_coremark_shutdown').facts.includes('shutdown command can RTC wake'), true)

assert.equal(
  HUANGSHAN_SOURCE_PATHS.workspace,
  process.env.HUANGSHAN_WORKSPACE || '/Users/wq/huangshan-pi-workspace/huangshan-pi-sf32-dev',
)
assert.equal(
  HUANGSHAN_SOURCE_PATHS.sdk,
  process.env.SIFLI_SDK_PATH || '/Users/wq/huangshan-pi-workspace/sifli-sdk',
)
assert.equal(
  HUANGSHAN_SOURCE_PATHS.examples,
  process.env.HUANGSHAN_EXAMPLES_PATH || '/Users/wq/huangshan-pi-workspace/lckfb-hspi-ulp_example',
)

console.log('huangshan capability profile tests passed')
