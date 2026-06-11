import assert from 'node:assert/strict'
import {
  createDefaultHuangshanBuilderConfig,
  createHuangshanAppFilesFromBuilder,
  normalizeHuangshanBuilderConfig,
} from '../src/domain/huangshan/appBuilder.js'

const defaults = createDefaultHuangshanBuilderConfig({
  displayName: 'Fitness Watch',
  description: 'Heart rate and steps dashboard.',
})

assert.equal(defaults.displayName, 'Fitness Watch')
assert.equal(defaults.components.some(component => component.type === 'metric'), true)
assert.equal(defaults.components.some(component => component.type === 'action'), true)
assert.equal(defaults.components.some(component => ['bluetooth', 'motor', 'status'].includes(component.capability)), false)
assert.equal(defaults.components.every(component => component.implementation === 'real'), true)

const normalized = normalizeHuangshanBuilderConfig({
  displayName: 'Fitness Watch',
  description: 'Heart rate and steps dashboard.',
  components: [
    { type: 'status', label: 'Ready', value: 'BLE linked' },
    { type: 'metric', label: 'Light', value: '12 lux', capability: 'ambient_light' },
    { type: 'metric', label: 'Motion', value: 'Stable', capability: 'imu' },
    { type: 'metric', label: 'Compass', value: 'Ready', capability: 'magnetometer' },
    { type: 'battery', label: 'Battery', value: '86%', capability: 'battery' },
    { type: 'metric', label: 'Analog', value: 'PA34', capability: 'adc_gpio' },
    { type: 'metric', label: 'Charger', value: 'AW32001', capability: 'charger' },
    { type: 'action', label: 'LED', value: 'LED hook', capability: 'led' },
    { type: 'unknown', label: 'Ignored', value: 'Nope' },
  ],
})

assert.equal(normalized.components.length, 8)
assert.deepEqual(normalized.components.map(component => component.id), [
  'status_0',
  'metric_1',
  'metric_2',
  'metric_3',
  'battery_4',
  'metric_5',
  'metric_6',
  'action_7',
])
assert.deepEqual(normalized.components.map(component => component.capability), [
  'status',
  'ambient_light',
  'imu',
  'magnetometer',
  'battery',
  'adc_gpio',
  'charger',
  'led',
])
assert.equal(normalized.components[4].enabled, true)
assert.equal(normalized.components[0].implementation, 'ui-only')
assert.equal(normalized.components[1].implementation, 'real')
assert.equal(normalized.components[6].implementation, 'real')

const files = createHuangshanAppFilesFromBuilder({
  ...normalized,
  components: normalized.components.filter(component => component.enabled !== false),
})
const main = files['src/gui_apps/Fitness_Watch/main.c']
const sconscript = files['src/gui_apps/Fitness_Watch/SConscript']
const projectConfig = files['project/proj.conf']

assert.match(sconscript, /customer\/peripherals\/sensor\/LTR303/)
assert.match(sconscript, /customer\/peripherals\/sensor\/LSM6DSL/)
assert.match(sconscript, /customer\/peripherals\/sensor\/MMC56x3/)
assert.match(sconscript, /rtos\/rtthread\/components\/drivers\/include/)
assert.match(projectConfig, /CONFIG_BSP_USING_I2C3=y/)
assert.match(projectConfig, /CONFIG_ASL_USING_LTR303=y/)
assert.match(projectConfig, /CONFIG_ACC_USING_LSM6DSL=y/)
assert.match(projectConfig, /CONFIG_MAG_USING_MMC56X3=y/)
assert.match(projectConfig, /CONFIG_BSP_USING_ADC1=y/)
assert.match(projectConfig, /CONFIG_BSP_USING_FULL_ASSERT=y/)
assert.match(projectConfig, /CONFIG_RGB_USING_SK6812MINI_HS_DEV_NAME=y/)

assert.match(main, /lv_label_set_text\(title, "Fitness Watch"\);/)
assert.match(main, /lv_label_set_text\(subtitle, "Heart rate and steps dashboard\."\);/)
assert.match(main, /create_info_chip\(g_state\.root, "Ready", "BLE linked"/)
assert.match(main, /create_info_chip\(g_state\.root, "Light", "12 lux"/)
assert.match(main, /create_info_chip\(g_state\.root, "Motion", "Stable"/)
assert.match(main, /create_info_chip\(g_state\.root, "Compass", "Ready"/)
assert.match(main, /create_info_chip\(g_state\.root, "Battery", "86%"/)
assert.match(main, /create_info_chip\(g_state\.root, "Charger", "AW32001"/)
assert.match(main, /lv_obj_t \*metric_1_value_label;/)
assert.match(main, /g_state\.metric_1_value_label = create_info_chip/)
assert.match(main, /lv_label_set_text_fmt\(g_state\.metric_1_value_label, "%d lx", light\.data\.light\)/)
assert.match(main, /lv_label_set_text_fmt\(g_state\.metric_2_value_label, "%d,%d,%d"/)
assert.match(main, /lv_label_set_text_fmt\(g_state\.metric_3_value_label, "%d,%d,%d"/)
assert.match(main, /lv_label_set_text_fmt\(g_state\.battery_4_value_label, "%u", vbat\)/)
assert.match(main, /lv_label_set_text_fmt\(g_state\.metric_6_value_label, "ID 0x%02X", chip_id\)/)
assert.match(main, /lv_obj_add_event_cb\(button, action_event_cb, LV_EVENT_CLICKED, \(void \*\)status_text\);/)
assert.match(main, /static void huangshan_capability_init\(void\)/)
assert.match(main, /rt_device_find\("li_ltr303"\)/)
assert.match(main, /rt_device_find\("acce_lsm"\)/)
assert.match(main, /rt_device_find\("mag_mmc56x3"\)/)
assert.match(main, /rt_device_find\("bat1"\)/)
assert.match(main, /struct rt_sensor_config sensor_cfg;/)
assert.match(main, /sensor_cfg\.intf\.dev_name = "i2c3"/)
assert.match(main, /rt_hw_ltr303_init\("ltr303", &sensor_cfg\)/)
assert.match(main, /rt_hw_mmc56x3_init\("mmc56x3", &sensor_cfg\)/)
assert.match(main, /rt_hw_lsm6dsl_init\("lsm6d", &sensor_cfg\)/)
assert.match(main, /HUANGSHAN_ADC_GPIO_CHANNEL 6/)
assert.match(main, /ADC read value: %u/)
assert.match(main, /HUANGSHAN_AW32001_ADDRESS 0x49/)
assert.match(main, /HUANGSHAN_CHARGER_I2C_BUS "i2c2"/)
assert.match(main, /rt_i2c_bus_device_find\(HUANGSHAN_CHARGER_I2C_BUS\)/)
assert.match(main, /AW32001 chip ID: 0x%02X/)
assert.match(main, /RGBLED_NAME "rgbled"/)
assert.match(main, /RGB LED example started!/)
assert.match(main, /-> green/)
assert.match(main, /lv_timer_create\(huangshan_capability_poll, 1000, RT_NULL\)/)
assert.match(main, /static int app_main\(intent_t i\)/)
assert.match(main, /gui_app_regist_msg_handler\(APP_ID, msg_handler\)/)
assert.match(main, /BUILTIN_APP_EXPORT\(LV_EXT_STR_ID\(lckfb\), LV_EXT_IMG_GET\(img_LiChuang\), APP_ID, app_main\);/)
assert.match(main, /#define APP_ID "fitness_watch"/)

const ioFiles = createHuangshanAppFilesFromBuilder({
  displayName: 'IO Console',
  description: 'GPIO, storage, USB, BLE, and UART2 example-backed controls.',
  components: [
    { type: 'status', label: 'Status', value: 'Ready' },
    { type: 'metric', label: 'TF', value: 'sd0', capability: 'tf_card' },
    { type: 'metric', label: 'USB', value: 'vcom', capability: 'usb_fs' },
    { type: 'metric', label: 'Power', value: 'HCPU', capability: 'low_power' },
    { type: 'action', label: 'BLE', value: 'BLE advertising', capability: 'bluetooth' },
    { type: 'action', label: 'Key', value: 'KEY2 pressed', capability: 'key' },
    { type: 'action', label: 'GPIO', value: 'GPIO pulse', capability: 'gpio_output' },
    { type: 'action', label: 'UART', value: 'UART heartbeat', capability: 'uart2' },
  ],
})
const ioMain = ioFiles['src/gui_apps/IO_Console/main.c']
const ioProjectConfig = ioFiles['project/proj.conf']
assert.match(ioMain, /KEY2 \/ PA43/)
assert.match(ioMain, /TF card block device is sd0/)
assert.match(ioMain, /USB CDC device is vcom/)
assert.match(ioMain, /Current HCPU freq: %d/)
assert.match(ioMain, /BLE advertising enabled/)
assert.match(ioMain, /HUANGSHAN_GPIO_OUTPUT_PIN 20/)
assert.match(ioMain, /UART2_NAME "uart2"/)
assert.match(ioMain, /HAL_PIN_Set\(PAD_PA18, USART2_RXD, PIN_PULLUP, 1\)/)
assert.match(ioMain, /HAL_PIN_Set\(PAD_PA19, USART2_TXD, PIN_PULLUP, 1\)/)
assert.match(ioMain, /GPIO%d pulse/)
assert.match(ioMain, /UART2 heartbeat sent/)
assert.match(ioProjectConfig, /CONFIG_BSP_USING_UART2=y/)
assert.match(ioProjectConfig, /CONFIG_RT_USING_SPI_MSD=y/)
assert.match(ioProjectConfig, /CONFIG_BSP_USING_USBD=y/)
assert.match(ioProjectConfig, /CONFIG_BLUETOOTH=y/)

const audioFiles = createHuangshanAppFilesFromBuilder({
  displayName: 'Audio Console',
  description: 'Audio example-backed probes.',
  components: [
    { type: 'metric', label: 'PDM', value: 'pdm1', capability: 'audio_pdm' },
    { type: 'metric', label: 'I2S', value: 'i2s2', capability: 'audio_i2s' },
    { type: 'metric', label: 'AUDPRC', value: 'audprc', capability: 'audio_audprc' },
  ],
})
const audioMain = audioFiles['src/gui_apps/Audio_Console/main.c']
const audioProjectConfig = audioFiles['project/proj.conf']
assert.match(audioMain, /PDM Record Example/)
assert.match(audioMain, /I2S Example/)
assert.match(audioMain, /Audprc Example/)
assert.match(audioMain, /rt_device_find\("pdm1"\)/)
assert.match(audioMain, /rt_device_find\("i2s2"\)/)
assert.match(audioMain, /rt_device_find\("audprc"\)/)
assert.match(audioProjectConfig, /CONFIG_BSP_USING_PDM1=y/)
assert.match(audioProjectConfig, /CONFIG_BSP_USING_I2S=y/)
assert.match(audioProjectConfig, /CONFIG_BSP_ENABLE_AUD_PRC=y/)

const motorFiles = createHuangshanAppFilesFromBuilder({
  displayName: 'Motor Console',
  description: 'Vibrator SDK-backed control.',
  components: [
    { type: 'action', label: 'Motor', value: 'Motor pulse', capability: 'motor' },
  ],
})
const motorMain = motorFiles['src/gui_apps/Motor_Console/main.c']
const motorSconscript = motorFiles['src/gui_apps/Motor_Console/SConscript']
const motorProjectConfig = motorFiles['project/proj.conf']
assert.match(motorMain, /#include "vibrator\.h"/)
assert.match(motorMain, /vibrator_open\(\)/)
assert.match(motorMain, /vibrator_write\(100, 100, 2\)/)
assert.match(motorMain, /vibrator_close\(\)/)
assert.match(motorMain, /vibrator_write return %d/)
assert.match(motorSconscript, /customer\/peripherals\/vibrator/)
assert.match(motorProjectConfig, /VIBRATOR_ENABLED=y/)

const longNameFiles = createHuangshanAppFilesFromBuilder({
  displayName: 'Very Long Huangshan Sensor Dashboard',
  description: 'APP_ID must stay inside the launcher id buffer.',
  components: [{ type: 'status', label: 'Status', value: 'Ready' }],
})
assert.match(
  longNameFiles['src/gui_apps/Very_Long_Huangshan_Sensor_Dashboard/main.c'],
  /#define APP_ID "[a-z0-9_]{1,15}"/,
)

const asciiFiles = createHuangshanAppFilesFromBuilder({
  displayName: '黄山派传感器',
  description: '环境光 状态',
  components: [{ type: 'metric', label: '环境光', value: '读取中', capability: 'ambient_light' }],
})
const asciiMain = asciiFiles['src/gui_apps/Board_Diagnostics/main.c']
assert.match(asciiMain, /lv_label_set_text\(title, "Board Diagnostics"\)/)
assert.match(asciiMain, /create_info_chip\(g_state\.root, "Light", "LTR303"/)
assert.doesNotMatch(asciiMain, /[\u4e00-\u9fff]/)

console.log('huangshan app builder tests passed')
