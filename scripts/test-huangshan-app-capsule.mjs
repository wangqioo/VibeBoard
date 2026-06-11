import assert from 'node:assert/strict'
import {
  HUANGSHAN_APP_CAPSULE_KIND,
  HUANGSHAN_APP_CAPSULE_SCHEMA_VERSION,
  HUANGSHAN_APP_ID_MAX_LENGTH,
  createHuangshanAppCapsule,
  normalizeHuangshanRuntimeAppId,
  validateHuangshanAppCapsule,
} from '../src/domain/huangshan/appCapsule.js'
import { createHuangshanAppFilesFromCapsule } from '../src/domain/huangshan/appBuilder.js'
import {
  collectHuangshanContractValues,
  getHuangshanCapabilityContract,
} from '../src/domain/huangshan/capabilityContracts.js'

assert.equal(normalizeHuangshanRuntimeAppId('Example Sensor Hub'), 'exam_sens_hub')
assert.equal(normalizeHuangshanRuntimeAppId('123 Demo'), 'app_123_demo')
assert.equal(normalizeHuangshanRuntimeAppId('Very Long Huangshan Sensor Dashboard').length <= HUANGSHAN_APP_ID_MAX_LENGTH, true)

assert.equal(getHuangshanCapabilityContract('ambient_light').projConf.includes('CONFIG_ASL_USING_LTR303=y'), true)
assert.equal(getHuangshanCapabilityContract('charger').label, 'AW32001 charger')
assert.equal(getHuangshanCapabilityContract('charger').exampleReferences.includes('I2C/charger/src/main.c'), true)
assert.equal(getHuangshanCapabilityContract('charger').projConf.includes('CONFIG_BSP_USING_I2C3=y'), true)
assert.equal(getHuangshanCapabilityContract('charger').projConf.includes('CONFIG_BSP_USING_FULL_ASSERT=y'), true)
assert.equal(getHuangshanCapabilityContract('charger').evidencePatterns.includes('AW32001 chip ID:'), true)
assert.equal(getHuangshanCapabilityContract('tf_card').exampleReferences.includes('example/rt_device/spi_tf/src/main.c'), true)
assert.equal(getHuangshanCapabilityContract('tf_card').projConf.includes('CONFIG_RT_USING_SPI_MSD=y'), true)
assert.equal(getHuangshanCapabilityContract('usb_fs').exampleReferences.includes('example/rt_device/usb/usb_vcom/src/main.c'), true)
assert.equal(getHuangshanCapabilityContract('usb_fs').projConf.includes('CONFIG_BSP_USING_USBD=y'), true)
assert.equal(getHuangshanCapabilityContract('audio_pdm').projConf.includes('CONFIG_BSP_USING_PDM1=y'), true)
assert.equal(getHuangshanCapabilityContract('audio_i2s').projConf.includes('CONFIG_BSP_USING_I2S=y'), true)
assert.equal(getHuangshanCapabilityContract('audio_audprc').projConf.includes('CONFIG_BSP_ENABLE_AUD_PRC=y'), true)
assert.equal(getHuangshanCapabilityContract('bluetooth').projConf.includes('CONFIG_BLUETOOTH=y'), true)
assert.equal(getHuangshanCapabilityContract('low_power').evidencePatterns.includes('Current HCPU freq:'), true)
assert.equal(getHuangshanCapabilityContract('motor').exampleReferences.includes('customer/peripherals/vibrator/vibrator.c'), true)
assert.equal(getHuangshanCapabilityContract('motor').includePaths.includes("os.path.join(rtconfig.SIFLI_SDK, 'customer/peripherals/vibrator')"), true)
assert.equal(getHuangshanCapabilityContract('motor').projConf.includes('VIBRATOR_ENABLED=y'), true)
assert.equal(getHuangshanCapabilityContract('motor').evidencePatterns.includes('vibrator_write return'), true)
assert.deepEqual(
  collectHuangshanContractValues(['ambient_light', 'imu', 'ambient_light'], 'projConf').filter(line => line === 'CONFIG_BSP_USING_I2C3=y'),
  ['CONFIG_BSP_USING_I2C3=y'],
)

const capsule = createHuangshanAppCapsule({
  displayName: 'Example Sensor Hub',
  description: 'LCKFB examples.',
  components: [
    { id: 'metric_1', type: 'metric', capability: 'ambient_light', label: 'Light', value: 'LTR303', enabled: true },
    { id: 'metric_2', type: 'metric', capability: 'imu', label: 'Motion', value: 'LSM6DSL', enabled: true },
    { id: 'metric_3', type: 'metric', capability: 'magnetometer', label: 'Compass', value: 'MMC56X3', enabled: true },
    { id: 'action_4', type: 'action', capability: 'led', label: 'LED', value: 'LED hook', enabled: true },
    { id: 'metric_5', type: 'metric', capability: 'charger', label: 'Charger', value: 'AW32001', enabled: true },
    { id: 'metric_6', type: 'metric', capability: 'tf_card', label: 'TF', value: 'sd0', enabled: true },
    { id: 'metric_7', type: 'metric', capability: 'usb_fs', label: 'USB', value: 'vcom', enabled: true },
  ],
})

assert.equal(capsule.schemaVersion, HUANGSHAN_APP_CAPSULE_SCHEMA_VERSION)
assert.equal(capsule.kind, HUANGSHAN_APP_CAPSULE_KIND)
assert.equal(capsule.app.appName, 'Example_Sensor_Hub')
assert.equal(capsule.app.appId, 'exam_sens_hub')
assert.equal(capsule.app.slotPath, 'src/gui_apps/Example_Sensor_Hub')
assert.equal(capsule.board.targetBoard, 'sf32lb52-lchspi-ulp')
assert.deepEqual(capsule.capabilities, ['ambient_light', 'imu', 'magnetometer', 'led', 'charger', 'tf_card', 'usb_fs'])
assert.equal(capsule.projConfDelta.includes('CONFIG_ASL_USING_LTR303=y'), true)
assert.equal(capsule.projConfDelta.includes('CONFIG_RGB_USING_SK6812MINI_HS_DEV_NAME=y'), true)
assert.equal(capsule.exampleReferences.includes('RT-Device/sensor'), true)
assert.equal(capsule.exampleReferences.includes('ws2812/src/main.c'), true)
assert.equal(capsule.exampleReferences.includes('I2C/charger/src/main.c'), true)
assert.equal(capsule.exampleReferences.includes('example/rt_device/spi_tf/src/main.c'), true)
assert.equal(capsule.exampleReferences.includes('example/rt_device/usb/usb_vcom/src/main.c'), true)
assert.equal(capsule.acceptanceEvidence.includes('serial log contains light:'), true)
assert.equal(capsule.acceptanceEvidence.includes('serial log contains AW32001 chip ID:'), true)
assert.equal(capsule.acceptanceEvidence.includes('serial log contains mount fs on flash'), true)
assert.equal(capsule.acceptanceEvidence.includes('serial log contains USB cdc vcom'), true)

const validation = validateHuangshanAppCapsule(capsule)
assert.equal(validation.ok, true)

const bad = validateHuangshanAppCapsule({
  ...capsule,
  app: { ...capsule.app, appId: 'too_long_huangshan_app_id' },
})
assert.equal(bad.ok, false)
assert.match(bad.message, /APP_ID/)

const files = createHuangshanAppFilesFromCapsule(capsule)
assert.ok(files['src/gui_apps/Example_Sensor_Hub/main.c'])
assert.match(files['src/gui_apps/Example_Sensor_Hub/main.c'], /#define APP_ID "exam_sens_hub"/)
assert.match(files['src/gui_apps/Example_Sensor_Hub/main.c'], /HUANGSHAN_AW32001_ADDRESS 0x49/)
assert.match(files['project/proj.conf'], /CONFIG_MAG_USING_MMC56X3=y/)

console.log('huangshan app capsule tests passed')
