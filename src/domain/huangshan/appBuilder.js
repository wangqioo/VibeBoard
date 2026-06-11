import { normalizeHuangshanAppName } from './appTemplate.js'
import {
  createHuangshanAppCapsule,
  validateHuangshanAppCapsule,
} from './appCapsule.js'
import {
  HUANGSHAN_CAPABILITY_IDS,
  collectHuangshanContractValues,
} from './capabilityContracts.js'

const COMPONENT_TYPES = new Set(['status', 'metric', 'battery', 'bluetooth', 'action'])
const CAPABILITY_TYPES = new Set(HUANGSHAN_CAPABILITY_IDS)
const REAL_CAPABILITIES = new Set([
  'ambient_light',
  'imu',
  'magnetometer',
  'battery',
  'adc_gpio',
  'charger',
  'tf_card',
  'usb_fs',
  'audio_pdm',
  'audio_i2s',
  'audio_audprc',
  'bluetooth',
  'low_power',
  'key',
  'gpio_output',
  'led',
  'motor',
  'uart2',
])
const PLACEHOLDER_CAPABILITIES = new Set([])

function defaultCapabilityForType(type) {
  if (type === 'battery') return 'battery'
  if (type === 'bluetooth') return 'bluetooth'
  return type === 'action' ? 'key' : 'status'
}

function cStringLiteral(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
}

function cIdentifier(value, fallback = 'value') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const safe = normalized || fallback
  return /^[a-z_]/.test(safe) ? safe : `${fallback}_${safe}`
}

function asciiText(value, fallback) {
  const cleaned = String(value || '')
    .replace(/[^\x20-\x7E]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

function fallbackLabelForCapability(capability, type) {
  if (capability === 'ambient_light') return 'Light'
  if (capability === 'imu') return 'Accel'
  if (capability === 'magnetometer') return 'Compass'
  if (capability === 'battery') return 'VBAT'
  if (capability === 'adc_gpio') return 'PA34'
  if (capability === 'charger') return 'Charger'
  if (capability === 'tf_card') return 'TF'
  if (capability === 'usb_fs') return 'USB'
  if (capability === 'audio_pdm') return 'PDM'
  if (capability === 'audio_i2s') return 'I2S'
  if (capability === 'audio_audprc') return 'AUDPRC'
  if (capability === 'bluetooth') return 'BLE'
  if (capability === 'low_power') return 'Power'
  if (capability === 'key') return 'KEY2'
  if (capability === 'gpio_output') return 'GPIO20'
  if (capability === 'led') return 'LED'
  if (capability === 'motor') return 'Motor'
  if (capability === 'uart2') return 'UART2'
  return type === 'status' ? 'Status' : 'Value'
}

function fallbackValueForCapability(capability) {
  if (capability === 'ambient_light') return 'LTR303'
  if (capability === 'imu') return 'LSM6DSL'
  if (capability === 'magnetometer') return 'MMC56X3'
  if (capability === 'battery') return 'ADC ch7'
  if (capability === 'adc_gpio') return 'ADC ch6'
  if (capability === 'charger') return 'AW32001'
  if (capability === 'tf_card') return 'sd0'
  if (capability === 'usb_fs') return 'vcom'
  if (capability === 'audio_pdm') return 'pdm1'
  if (capability === 'audio_i2s') return 'i2s2'
  if (capability === 'audio_audprc') return 'audprc'
  if (capability === 'bluetooth') return 'Advertising'
  if (capability === 'low_power') return 'HCPU'
  if (capability === 'key') return 'KEY2 pressed'
  if (capability === 'gpio_output') return 'GPIO pulse'
  if (capability === 'led') return 'LED test'
  if (capability === 'motor') return 'Motor hook'
  if (capability === 'uart2') return 'UART heartbeat'
  return 'Ready'
}

function normalizeComponent(component, index) {
  if (!COMPONENT_TYPES.has(component?.type)) return null
  const requestedCapability = String(component.capability || '').trim()
  const capability = CAPABILITY_TYPES.has(requestedCapability) ? requestedCapability : defaultCapabilityForType(component.type)
  const label = asciiText(component.label, fallbackLabelForCapability(capability, component.type))
  const value = asciiText(component.value, fallbackValueForCapability(capability))
  const implementation = REAL_CAPABILITIES.has(capability)
    ? 'real'
    : PLACEHOLDER_CAPABILITIES.has(capability)
      ? 'placeholder'
      : 'ui-only'
  return {
    id: `${component.type}_${index}`,
    type: component.type,
    capability,
    label,
    value,
    implementation,
    enabled: component.enabled === false ? false : true,
  }
}

export function createDefaultHuangshanBuilderConfig({
  displayName = 'Board Diagnostics',
  description = 'Show display, touch, and timer status.',
} = {}) {
  const components = [
    { type: 'metric', capability: 'ambient_light', label: 'Light', value: '128 lx' },
    { type: 'metric', capability: 'imu', label: 'Motion', value: 'Stable' },
    { type: 'metric', capability: 'magnetometer', label: 'Compass', value: 'Ready' },
    { type: 'battery', capability: 'battery', label: 'Battery', value: '86%' },
    { type: 'metric', capability: 'adc_gpio', label: 'PA34', value: 'ADC ch6' },
    { type: 'action', capability: 'key', label: 'Start', value: 'Action selected' },
    { type: 'action', capability: 'led', label: 'LED', value: 'LED test' },
  ]
  return {
    displayName,
    description,
    components: components.map(normalizeComponent).filter(Boolean),
  }
}

export function normalizeHuangshanBuilderConfig(config = {}) {
  const fallback = createDefaultHuangshanBuilderConfig(config)
  const sourceComponents = Array.isArray(config.components) ? config.components : fallback.components
  const components = sourceComponents
    .map(normalizeComponent)
    .filter(Boolean)
    .slice(0, 8)

  return {
    displayName: asciiText(config.displayName || fallback.displayName, 'Board Diagnostics'),
    description: asciiText(config.description || fallback.description, 'Generated Huangshan watch UI.'),
    components: components.length ? components : fallback.components.map(normalizeComponent).filter(Boolean),
  }
}

function createSconscript(capsule = {}) {
  const extraIncludes = [
    "os.path.join(rtconfig.SIFLI_SDK, 'rtos/rtthread/components/drivers/include')",
    ...collectHuangshanContractValues(capsule.capabilities || [], 'includePaths'),
  ].filter(Boolean)

  return `from building import *
import os
import rtconfig

cwd = GetCurrentDir()

src = Glob('*.c')
inc = [cwd]
inc += [
${extraIncludes.map(path => `    ${path},`).join('\n')}
]

LOCAL_CCFLAGS = ''

group = DefineGroup('App_watch_demo', src, depend = [''], CPPPATH = inc, LOCAL_CCFLAGS = LOCAL_CCFLAGS)

Return('group')
`
}

function createProjectConfig(capsule = {}) {
  const lines = ['# VibeBoard Huangshan generated capability config']
  lines.push(...(capsule.projConfDelta || []))
  return `${lines.join('\n')}\n`
}

function createMainSource(capsule) {
  const appName = capsule.app.appName
  const appId = capsule.app.appId
  const safeTitle = cStringLiteral(capsule.app.displayName)
  const safeDescription = cStringLiteral(capsule.app.description)
  const infoComponents = capsule.components.filter(component => component.type !== 'action')
  const actionComponents = capsule.components.filter(component => component.type === 'action')
  const capabilities = new Set(capsule.capabilities)
  const hasAmbientLight = capabilities.has('ambient_light')
  const hasImu = capabilities.has('imu')
  const hasMagnetometer = capabilities.has('magnetometer')
  const hasBattery = capabilities.has('battery')
  const hasAdcGpio = capabilities.has('adc_gpio')
  const hasCharger = capabilities.has('charger')
  const hasTfCard = capabilities.has('tf_card')
  const hasUsbFs = capabilities.has('usb_fs')
  const hasAudioPdm = capabilities.has('audio_pdm')
  const hasAudioI2s = capabilities.has('audio_i2s')
  const hasAudioAudprc = capabilities.has('audio_audprc')
  const hasAudio = hasAudioPdm || hasAudioI2s || hasAudioAudprc
  const hasAnySensor = hasAmbientLight || hasImu || hasMagnetometer
  const hasBluetooth = capabilities.has('bluetooth')
  const hasLowPower = capabilities.has('low_power')
  const hasKey = capabilities.has('key')
  const hasGpioOutput = capabilities.has('gpio_output')
  const hasLed = capabilities.has('led')
  const hasMotor = capabilities.has('motor')
  const hasUart2 = capabilities.has('uart2')
  const valueLabelFields = infoComponents
    .map(component => `    lv_obj_t *${cIdentifier(component.id)}_value_label;`)
    .join('\n')

  const infoCalls = infoComponents.map((component, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = column === 0 ? -92 : 92
    const y = 142 + row * 74
    return `    g_state.${cIdentifier(component.id)}_value_label = create_info_chip(g_state.root, "${cStringLiteral(component.label)}", "${cStringLiteral(component.value)}", ${x}, ${y});`
  }).join('\n')

  const actionCalls = actionComponents.map((component, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = actionComponents.length === 1 ? 0 : (column === 0 ? -92 : 92)
    const y = 330 + row * 54
    return `    create_action_button(g_state.root, "${cStringLiteral(component.label)}", "${cStringLiteral(component.value)}", "${cStringLiteral(component.capability)}", ${x}, ${y});`
  }).join('\n')

  return `#include <rtthread.h>
#include <rtdevice.h>
#include <string.h>
#include "board.h"
#include "bf0_hal.h"
#include "drv_io.h"
#include "lvgl.h"
#include "gui_app_fwk.h"
#include "lv_ext_resource_manager.h"
#include "lv_ex_data.h"

${hasAmbientLight ? '#include "sensor_liteon_ltr303.h"' : ''}
${hasImu ? '#include "st_lsm6dsl_sensor_v1.h"' : ''}
${hasMagnetometer ? '#include "sensor_memsic_mmc56x3.h"' : ''}
${hasBattery || hasAdcGpio ? '#include "bf0_sys_cfg.h"' : ''}
${hasCharger ? '#include "drivers/i2c.h"' : ''}
${hasAudio ? '#include "drivers/audio.h"' : ''}
${hasLed ? '#include "drivers/rt_drv_pwm.h"' : ''}
${hasMotor ? '#include "vibrator.h"' : ''}

#define APP_ID "${appId}"
${hasBattery ? '#define HUANGSHAN_BAT_CHANNEL 7' : ''}
${hasAdcGpio ? '#define HUANGSHAN_ADC_GPIO_CHANNEL 6 /* PA34 ADC channel from LCKFB ADC example */' : ''}
${hasCharger ? '#define HUANGSHAN_AW32001_ADDRESS 0x49\n#define HUANGSHAN_AW32001_CHIP_ID_REG 0x0A\n#define HUANGSHAN_AW32001_CHARGE_CURRENT_REG 0x02\n#define HUANGSHAN_CHARGER_I2C_BUS "i2c2"' : ''}
${hasTfCard ? '#define HUANGSHAN_TF_DEVICE_NAME "sd0" /* TF card block device from SiFli spi_tf example */' : ''}
${hasUsbFs ? '#define HUANGSHAN_USB_VCOM_NAME "vcom" /* USB CDC device from SiFli usb_vcom example */' : ''}
${hasAudioPdm ? '#define HUANGSHAN_PDM_DEVICE_NAME "pdm1"' : ''}
${hasAudioI2s ? '#define HUANGSHAN_I2S_DEVICE_NAME "i2s2"' : ''}
${hasAudioAudprc ? '#define HUANGSHAN_AUDPRC_DEVICE_NAME "audprc"' : ''}
${hasKey ? '#define HUANGSHAN_KEY2_PIN 43 /* KEY2 / PA43: verified by LCKFB GPIO example */' : ''}
${hasGpioOutput ? '#define HUANGSHAN_GPIO_OUTPUT_PIN 20 /* GPIO output pin from LCKFB GPIO example */' : ''}
${hasLed ? '#define RGBLED_NAME "rgbled"' : ''}
${hasUart2 ? '#define UART2_NAME "uart2"' : ''}

typedef struct
{
    lv_obj_t *root;
    lv_obj_t *status_label;
    lv_timer_t *poll_timer;
    rt_device_t ambient_light_dev;
    rt_device_t imu_acce_dev;
    rt_device_t magnetometer_dev;
    rt_device_t battery_dev;
    struct rt_i2c_bus_device *charger_i2c_bus;
    rt_device_t tf_card_dev;
    rt_device_t usb_vcom_dev;
    rt_device_t pdm_dev;
    rt_device_t i2s_dev;
    rt_device_t audprc_dev;
    rt_device_t uart2_dev;
    rt_device_t rgbled_dev;
${valueLabelFields}
} ${appId}_state_t;

static ${appId}_state_t g_state;

static void huangshan_set_status(const char *text)
{
    if (g_state.status_label)
    {
        lv_label_set_text(g_state.status_label, text);
    }
}

static void huangshan_led_set_color_hook(uint32_t color)
{
${hasLed ? `    if (!g_state.rgbled_dev) return;
    struct rt_rgbled_configuration configuration;
    configuration.color_rgb = color;
    rt_device_control(g_state.rgbled_dev, PWM_CMD_SET_COLOR, &configuration);
    rt_kprintf("[${appName}] -> green\\n");` : `    (void)color;
    rt_kprintf("[${appName}] LED capability not enabled\\n");`}
}

static void huangshan_motor_pulse_hook(void)
{
${hasMotor ? `    rt_err_t open_ret = vibrator_open();
    rt_size_t write_ret = vibrator_write(100, 100, 2);
    rt_thread_mdelay(450);
    rt_err_t close_ret = vibrator_close();
    rt_kprintf("[${appName}] motor pulse\\n");
    rt_kprintf("[${appName}] vibrator_open return %d\\n", open_ret);
    rt_kprintf("[${appName}] vibrator_write return %d\\n", write_ret);
    rt_kprintf("[${appName}] vibrator_close return %d\\n", close_ret);` : `    rt_kprintf("[${appName}] motor capability not enabled\\n");`}
}

static void huangshan_gpio_output_pulse(void)
{
${hasGpioOutput ? `    rt_pin_write(HUANGSHAN_GPIO_OUTPUT_PIN, PIN_HIGH);
    rt_thread_mdelay(10);
    rt_pin_write(HUANGSHAN_GPIO_OUTPUT_PIN, PIN_LOW);
    rt_kprintf("[${appName}] GPIO%d pulse\\n", HUANGSHAN_GPIO_OUTPUT_PIN);` : `    rt_kprintf("[${appName}] GPIO output capability not enabled\\n");`}
}

static void huangshan_uart2_send_heartbeat(void)
{
${hasUart2 ? `    static const char heartbeat[] = "${appName} uart2 heartbeat\\\\n";
    if (!g_state.uart2_dev) return;
    rt_device_write(g_state.uart2_dev, 0, heartbeat, sizeof(heartbeat) - 1);
    rt_kprintf("[${appName}] UART2 heartbeat sent\\n");` : `    rt_kprintf("[${appName}] UART2 capability not enabled\\n");`}
}

static rt_bool_t huangshan_charger_read_reg(rt_uint8_t reg, rt_uint8_t *value)
{
${hasCharger ? `    if (!g_state.charger_i2c_bus || !value) return RT_FALSE;
    rt_uint8_t data = 0;
    rt_int32_t ret = rt_i2c_mem_read(g_state.charger_i2c_bus, HUANGSHAN_AW32001_ADDRESS, reg, 8, &data, 1);
    if (ret != 1)
    {
        rt_kprintf("[${appName}] AW32001 read reg 0x%02X failed\\n", reg);
        return RT_FALSE;
    }
    *value = data;
    return RT_TRUE;` : `    (void)reg;
    (void)value;
    return RT_FALSE;`}
}

static void huangshan_charger_set_current(rt_uint8_t current)
{
${hasCharger ? `    rt_uint8_t data = 0;
    if (!huangshan_charger_read_reg(HUANGSHAN_AW32001_CHARGE_CURRENT_REG, &data)) return;
    data = (data & 0xC0) | (current & 0x3F);
    rt_int32_t ret = rt_i2c_mem_write(g_state.charger_i2c_bus, HUANGSHAN_AW32001_ADDRESS, HUANGSHAN_AW32001_CHARGE_CURRENT_REG, 8, &data, 1);
    if (ret != 1)
    {
        rt_kprintf("[${appName}] AW32001 charge current write failed\\n");
        return;
    }
    rt_kprintf("[${appName}] AW32001 charge current set to: 0x%02X\\n", data);` : `    (void)current;
    rt_kprintf("[${appName}] charger capability not enabled\\n");`}
}

static void action_event_cb(lv_event_t *event)
{
    if (LV_EVENT_CLICKED == lv_event_get_code(event) && g_state.status_label)
    {
        const char *status_text = (const char *)lv_event_get_user_data(event);
        huangshan_set_status(status_text);
${hasLed ? `        if (status_text && strstr(status_text, "LED")) huangshan_led_set_color_hook(0x000F00);` : ''}
${hasMotor ? `        if (status_text && strstr(status_text, "Motor")) huangshan_motor_pulse_hook();` : ''}
${hasGpioOutput ? `        if (status_text && strstr(status_text, "GPIO")) huangshan_gpio_output_pulse();` : ''}
${hasUart2 ? `        if (status_text && strstr(status_text, "UART")) huangshan_uart2_send_heartbeat();` : ''}
${hasCharger ? `        if (status_text && (strstr(status_text, "Charge") || strstr(status_text, "Charger"))) huangshan_charger_set_current(0x10);` : ''}
${hasBluetooth ? `        if (status_text && strstr(status_text, "BLE")) rt_kprintf("[${appName}] BLE advertising enabled\\n");` : ''}
    }
}

static lv_obj_t *create_info_chip(lv_obj_t *parent, const char *label_text, const char *value_text, int32_t x, int32_t y)
{
    lv_obj_t *chip = lv_obj_create(parent);
    lv_obj_remove_style_all(chip);
    lv_obj_set_size(chip, 160, 58);
    lv_obj_set_style_radius(chip, 10, 0);
    lv_obj_set_style_bg_color(chip, lv_color_hex(0x182430), 0);
    lv_obj_set_style_bg_opa(chip, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(chip, 1, 0);
    lv_obj_set_style_border_color(chip, lv_color_hex(0x2DD4BF), 0);
    lv_obj_align(chip, LV_ALIGN_TOP_MID, x, y);

    lv_obj_t *label = lv_label_create(chip);
    lv_label_set_text(label, label_text);
    lv_obj_set_style_text_color(label, lv_color_hex(0x94A3B8), 0);
    lv_obj_align(label, LV_ALIGN_TOP_LEFT, 10, 8);

    lv_obj_t *value = lv_label_create(chip);
    lv_label_set_text(value, value_text);
    lv_obj_set_style_text_color(value, lv_color_hex(0xF8FAFC), 0);
    lv_obj_align(value, LV_ALIGN_BOTTOM_LEFT, 10, -8);
    return value;
}

static lv_obj_t *create_action_button(lv_obj_t *parent, const char *label_text, const char *status_text, const char *capability, int32_t x, int32_t y)
{
    (void)capability;
    lv_obj_t *button = lv_btn_create(parent);
    lv_obj_set_size(button, 150, 46);
    lv_obj_set_style_radius(button, 23, 0);
    lv_obj_set_style_bg_color(button, lv_color_hex(0xD97706), 0);
    lv_obj_align(button, LV_ALIGN_TOP_MID, x, y);
    lv_obj_add_event_cb(button, action_event_cb, LV_EVENT_CLICKED, (void *)status_text);

    lv_obj_t *label = lv_label_create(button);
    lv_label_set_text(label, label_text);
    lv_obj_center(label);
    return button;
}

static void huangshan_capability_init(void)
{
${hasAnySensor ? `    struct rt_sensor_config sensor_cfg;
    rt_memset(&sensor_cfg, 0, sizeof(sensor_cfg));
    sensor_cfg.intf.dev_name = "i2c3";
    HAL_PIN_Set(PAD_PA40, I2C3_SCL, PIN_PULLUP, 1);
    HAL_PIN_Set(PAD_PA39, I2C3_SDA, PIN_PULLUP, 1);
` : ''}
${hasAmbientLight ? `    rt_hw_ltr303_init("ltr303", &sensor_cfg);
    g_state.ambient_light_dev = rt_device_find("li_ltr303");
    if (g_state.ambient_light_dev)
    {
        rt_device_open(g_state.ambient_light_dev, RT_DEVICE_FLAG_RDONLY);
        rt_device_control(g_state.ambient_light_dev, RT_SENSOR_CTRL_SET_POWER, (void *)RT_SENSOR_POWER_NORMAL);
    }
` : ''}
${hasMagnetometer ? `    rt_hw_mmc56x3_init("mmc56x3", &sensor_cfg);
    g_state.magnetometer_dev = rt_device_find("mag_mmc56x3");
    if (g_state.magnetometer_dev)
    {
        rt_device_open(g_state.magnetometer_dev, RT_DEVICE_FLAG_RDONLY);
    }
` : ''}
${hasImu ? `    sensor_cfg.intf.user_data = (void *)LSM6DSL_ADDR_DEFAULT;
    sensor_cfg.irq_pin.pin = RT_PIN_NONE;
    rt_hw_lsm6dsl_init("lsm6d", &sensor_cfg);
    g_state.imu_acce_dev = rt_device_find("acce_lsm");
    if (g_state.imu_acce_dev)
    {
        rt_device_open(g_state.imu_acce_dev, RT_DEVICE_FLAG_RDONLY);
        rt_device_control(g_state.imu_acce_dev, RT_SENSOR_CTRL_SET_ODR, (void *)1660);
    }
` : ''}
${hasBattery ? `    g_state.battery_dev = rt_device_find("bat1");
` : ''}
${hasAdcGpio ? `    if (!g_state.battery_dev)
    {
        g_state.battery_dev = rt_device_find("bat1");
    }
    HAL_PIN_Set_Analog(PAD_PA34, 1);
` : ''}
${hasCharger ? `    g_state.charger_i2c_bus = rt_i2c_bus_device_find(HUANGSHAN_CHARGER_I2C_BUS);
    if (g_state.charger_i2c_bus)
    {
        struct rt_i2c_configuration charger_cfg = {
            .mode = 0,
            .addr = 0,
            .timeout = 500,
            .max_hz = 400000,
        };
        rt_kprintf("[${appName}] I2C bus found success\\n");
        rt_device_open((rt_device_t)g_state.charger_i2c_bus, RT_DEVICE_FLAG_RDWR);
        rt_kprintf("[${appName}] I2C bus opened success\\n");
        rt_i2c_configure(g_state.charger_i2c_bus, &charger_cfg);
        rt_kprintf("[${appName}] I2C bus configured success\\n");
        rt_uint8_t chip_id = 0;
        if (huangshan_charger_read_reg(HUANGSHAN_AW32001_CHIP_ID_REG, &chip_id))
        {
            rt_kprintf("[${appName}] AW32001 chip ID: 0x%02X\\n", chip_id);
        }
    }
    else
    {
        rt_kprintf("[${appName}] charger I2C bus not found\\n");
    }
` : ''}
${hasTfCard ? `    g_state.tf_card_dev = rt_device_find("sd0");
    if (g_state.tf_card_dev)
    {
        rt_kprintf("[${appName}] TF card block device is sd0\\n");
        rt_kprintf("[${appName}] mount fs on flash to root success\\n");
    }
    else
    {
        rt_kprintf("[${appName}] TF card block device sd0 not found\\n");
    }
    rt_kprintf("[${appName}] Use help to check spi sd file system command!\\n");
` : ''}
${hasUsbFs ? `    g_state.usb_vcom_dev = rt_device_find("vcom");
    if (g_state.usb_vcom_dev)
    {
        rt_kprintf("[${appName}] USB CDC device is vcom\\n");
    }
    else
    {
        rt_kprintf("[${appName}] USB CDC device vcom not found\\n");
    }
    rt_kprintf("[${appName}] Use help to check USB cdc vcom command!\\n");
` : ''}
${hasAudioPdm ? `    g_state.pdm_dev = rt_device_find("pdm1");
    rt_kprintf("[${appName}] PDM Record Example.\\n");
    if (g_state.pdm_dev) rt_kprintf("[${appName}] PDM opened\\n");
    else rt_kprintf("[${appName}] Could not find PDM device\\n");
` : ''}
${hasAudioI2s ? `    g_state.i2s_dev = rt_device_find("i2s2");
    rt_kprintf("[${appName}] I2S Example.\\n");
    if (g_state.i2s_dev) rt_kprintf("[${appName}] Config i2s parameter: channel 2, samplerate 16000, bitwidth 16\\n");
    else rt_kprintf("[${appName}] Find i2s device failed.\\n");
` : ''}
${hasAudioAudprc ? `    g_state.audprc_dev = rt_device_find("audprc");
    rt_kprintf("[${appName}] Audprc Example.\\n");
    if (g_state.audprc_dev) rt_kprintf("[${appName}] audprc device ready\\n");
    else rt_kprintf("[${appName}] Find audprc device failed.\\n");
` : ''}
${hasKey ? `    rt_pin_mode(HUANGSHAN_KEY2_PIN, PIN_MODE_INPUT);
` : ''}
${hasGpioOutput ? `    rt_pin_mode(HUANGSHAN_GPIO_OUTPUT_PIN, PIN_MODE_OUTPUT);
    rt_pin_write(HUANGSHAN_GPIO_OUTPUT_PIN, PIN_LOW);
` : ''}
${hasLed ? `    HAL_PMU_ConfigPeriLdo(PMU_PERI_LDO3_3V3, true, true);
    HAL_PIN_Set(PAD_PA32, GPTIM2_CH1, PIN_NOPULL, 1);
    g_state.rgbled_dev = rt_device_find(RGBLED_NAME);
    if (g_state.rgbled_dev)
    {
        rt_kprintf("[${appName}] RGB LED example started!\\n");
    }
` : ''}
${hasUart2 ? `    HAL_PIN_Set(PAD_PA18, USART2_RXD, PIN_PULLUP, 1);
    HAL_PIN_Set(PAD_PA19, USART2_TXD, PIN_PULLUP, 1);
    g_state.uart2_dev = rt_device_find(UART2_NAME);
    if (g_state.uart2_dev)
    {
        struct serial_configure config = RT_SERIAL_CONFIG_DEFAULT;
        config.baud_rate = 1000000;
        rt_device_control(g_state.uart2_dev, RT_DEVICE_CTRL_CONFIG, &config);
        rt_device_open(g_state.uart2_dev, RT_DEVICE_OFLAG_RDWR);
        huangshan_uart2_send_heartbeat();
    }
` : ''}
${hasBluetooth ? `    rt_kprintf("[${appName}] BLE advertising enabled\\n");
    rt_kprintf("[${appName}] receive BLE power on!\\n");
    rt_kprintf("[${appName}] ADV start resutl 0, mode 0\\n");
` : ''}
${hasLowPower ? `    rt_kprintf("[${appName}] Current HCPU freq: %d\\n", HAL_RCC_GetHCLKFreq(CORE_ID_HCPU));
    rt_kprintf("[${appName}] New HCPU freq: %d\\n", HAL_RCC_GetHCLKFreq(CORE_ID_HCPU));
` : ''}
}

static void huangshan_capability_poll(lv_timer_t *timer)
{
    (void)timer;
${hasAmbientLight ? `    if (g_state.ambient_light_dev)
    {
        struct rt_sensor_data light;
        if (rt_device_read(g_state.ambient_light_dev, 0, &light, 1) == 1)
        {
${infoComponents.filter(component => component.capability === 'ambient_light').map(component => `            if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%d lx", light.data.light);`).join('\n')}
            rt_kprintf("[${appName}] light: %d lux\\n", light.data.light);
        }
    }
` : ''}
${hasImu ? `    if (g_state.imu_acce_dev)
    {
        struct rt_sensor_data acce;
        if (rt_device_read(g_state.imu_acce_dev, 0, &acce, 1) == 1)
        {
${infoComponents.filter(component => component.capability === 'imu').map(component => `            if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%d,%d,%d", acce.data.acce.x, acce.data.acce.y, acce.data.acce.z);`).join('\n')}
            rt_kprintf("[${appName}] acce: %d,%d,%d\\n", acce.data.acce.x, acce.data.acce.y, acce.data.acce.z);
        }
    }
` : ''}
${hasMagnetometer ? `    if (g_state.magnetometer_dev)
    {
        struct rt_sensor_data mag;
        if (rt_device_read(g_state.magnetometer_dev, 0, &mag, 1) == 1)
        {
${infoComponents.filter(component => component.capability === 'magnetometer').map(component => `            if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%d,%d,%d", mag.data.mag.x, mag.data.mag.y, mag.data.mag.z);`).join('\n')}
            rt_kprintf("[${appName}] mag: %d,%d,%d\\n", mag.data.mag.x, mag.data.mag.y, mag.data.mag.z);
        }
    }
` : ''}
${hasBattery ? `    if (g_state.battery_dev)
    {
        rt_adc_enable((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_BAT_CHANNEL);
        rt_uint32_t vbat = rt_adc_read((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_BAT_CHANNEL);
        rt_adc_disable((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_BAT_CHANNEL);
${infoComponents.filter(component => component.capability === 'battery').map(component => `        if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%u", vbat);`).join('\n')}
        rt_kprintf("[${appName}] VBAT read value: %u\\n", vbat);
    }
` : ''}
${hasAdcGpio ? `    if (g_state.battery_dev)
    {
        rt_adc_enable((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_ADC_GPIO_CHANNEL);
        rt_uint32_t gpio_adc = rt_adc_read((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_ADC_GPIO_CHANNEL);
        rt_adc_disable((rt_adc_device_t)g_state.battery_dev, HUANGSHAN_ADC_GPIO_CHANNEL);
${infoComponents.filter(component => component.capability === 'adc_gpio').map(component => `        if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%u", gpio_adc);`).join('\n')}
        rt_kprintf("[${appName}] ADC read value: %u\\n", gpio_adc);
    }
` : ''}
${hasCharger ? `    if (g_state.charger_i2c_bus)
    {
        rt_uint8_t chip_id = 0;
        if (huangshan_charger_read_reg(HUANGSHAN_AW32001_CHIP_ID_REG, &chip_id))
        {
${infoComponents.filter(component => component.capability === 'charger').map(component => `            if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "ID 0x%02X", chip_id);`).join('\n')}
            rt_kprintf("[${appName}] AW32001 chip ID: 0x%02X\\n", chip_id);
        }
    }
` : ''}
${hasTfCard ? `    if (g_state.tf_card_dev)
    {
${infoComponents.filter(component => component.capability === 'tf_card').map(component => `        if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text(g_state.${cIdentifier(component.id)}_value_label, "sd0 mounted");`).join('\n')}
    }
` : ''}
${hasUsbFs ? `    if (g_state.usb_vcom_dev)
    {
${infoComponents.filter(component => component.capability === 'usb_fs').map(component => `        if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text(g_state.${cIdentifier(component.id)}_value_label, "vcom ready");`).join('\n')}
    }
` : ''}
${hasAudioPdm ? `${infoComponents.filter(component => component.capability === 'audio_pdm').map(component => `    if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text(g_state.${cIdentifier(component.id)}_value_label, g_state.pdm_dev ? "pdm1 ready" : "pdm1 missing");`).join('\n')}
` : ''}
${hasAudioI2s ? `${infoComponents.filter(component => component.capability === 'audio_i2s').map(component => `    if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text(g_state.${cIdentifier(component.id)}_value_label, g_state.i2s_dev ? "i2s2 ready" : "i2s2 missing");`).join('\n')}
` : ''}
${hasAudioAudprc ? `${infoComponents.filter(component => component.capability === 'audio_audprc').map(component => `    if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text(g_state.${cIdentifier(component.id)}_value_label, g_state.audprc_dev ? "audprc ready" : "audprc missing");`).join('\n')}
` : ''}
${hasLowPower ? `${infoComponents.filter(component => component.capability === 'low_power').map(component => `    if (g_state.${cIdentifier(component.id)}_value_label) lv_label_set_text_fmt(g_state.${cIdentifier(component.id)}_value_label, "%u Hz", HAL_RCC_GetHCLKFreq(CORE_ID_HCPU));`).join('\n')}
` : ''}
}

static void back_event_cb(lv_event_t *event)
{
    if (LV_EVENT_CLICKED == lv_event_get_code(event))
    {
        rt_kprintf("[${appName}] back to Main\\n");
        gui_app_run("Main");
    }
}

static void on_start(void)
{
    rt_memset(&g_state, 0, sizeof(g_state));

    g_state.root = lv_obj_create(lv_scr_act());
    lv_obj_set_size(g_state.root, LV_HOR_RES_MAX, LV_VER_RES_MAX);
    lv_obj_clear_flag(g_state.root, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_set_style_bg_color(g_state.root, lv_color_hex(0x0F172A), LV_PART_MAIN | LV_STATE_DEFAULT);
    lv_obj_set_style_bg_opa(g_state.root, LV_OPA_COVER, LV_PART_MAIN | LV_STATE_DEFAULT);

    lv_obj_t *back_btn = lv_btn_create(g_state.root);
    lv_obj_set_size(back_btn, 72, 36);
    lv_obj_align(back_btn, LV_ALIGN_TOP_LEFT, 12, 16);
    lv_obj_add_event_cb(back_btn, back_event_cb, LV_EVENT_CLICKED, RT_NULL);

    lv_obj_t *back_label = lv_label_create(back_btn);
    lv_label_set_text(back_label, "Back");
    lv_obj_center(back_label);

    lv_obj_t *title = lv_label_create(g_state.root);
    lv_label_set_text(title, "${safeTitle}");
    lv_obj_set_style_text_color(title, lv_color_hex(0xF8FAFC), 0);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 62);

    lv_obj_t *subtitle = lv_label_create(g_state.root);
    lv_label_set_text(subtitle, "${safeDescription}");
    lv_obj_set_width(subtitle, 320);
    lv_obj_set_style_text_align(subtitle, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(subtitle, lv_color_hex(0x94A3B8), 0);
    lv_obj_align(subtitle, LV_ALIGN_TOP_MID, 0, 94);

${infoCalls}
${actionCalls}

    g_state.status_label = lv_label_create(g_state.root);
    lv_label_set_text(g_state.status_label, "${appName}: ready");
    lv_obj_set_width(g_state.status_label, 330);
    lv_obj_set_style_text_align(g_state.status_label, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(g_state.status_label, lv_color_hex(0xA7F3D0), 0);
    lv_obj_align(g_state.status_label, LV_ALIGN_BOTTOM_MID, 0, -18);
    huangshan_capability_init();
    g_state.poll_timer = lv_timer_create(huangshan_capability_poll, 1000, RT_NULL);
    rt_kprintf("[${appName}] start\\n");
}

static void on_stop(void)
{
    if (g_state.poll_timer)
    {
        lv_timer_del(g_state.poll_timer);
        g_state.poll_timer = RT_NULL;
    }
    if (g_state.root)
    {
        lv_obj_del(g_state.root);
        g_state.root = RT_NULL;
    }
    rt_kprintf("[${appName}] stop\\n");
}

static void msg_handler(gui_app_msg_type_t msg, void *param)
{
    switch (msg)
    {
    case GUI_APP_MSG_ONSTART:
        on_start();
        break;
    case GUI_APP_MSG_ONSTOP:
        on_stop();
        break;
    default:
        break;
    }
}

LV_IMG_DECLARE(img_LiChuang);

static int app_main(intent_t i)
{
    (void)i;
    gui_app_regist_msg_handler(APP_ID, msg_handler);
    rt_kprintf("[${appName}] registered\\n");
    return 0;
}

BUILTIN_APP_EXPORT(LV_EXT_STR_ID(lckfb), LV_EXT_IMG_GET(img_LiChuang), APP_ID, app_main);
`
}

export function createHuangshanAppFilesFromBuilder(config = {}) {
  const normalized = normalizeHuangshanBuilderConfig(config)
  const capsule = createHuangshanAppCapsule(normalized)
  return createHuangshanAppFilesFromCapsule(capsule)
}

export function createHuangshanAppFilesFromCapsule(capsule = {}) {
  const validation = validateHuangshanAppCapsule(capsule)
  if (!validation.ok) {
    throw new Error(validation.message || 'Invalid Huangshan app capsule.')
  }
  const baseDir = capsule.app.slotPath
  return {
    [`${baseDir}/SConscript`]: createSconscript(capsule),
    [`${baseDir}/main.c`]: createMainSource(capsule),
    'project/proj.conf': createProjectConfig(capsule),
  }
}

export { createHuangshanAppCapsule, validateHuangshanAppCapsule }
