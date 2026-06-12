import assert from 'node:assert/strict'

import {
  createDeviceEvidence,
  createDeliveryDeviceEvidence,
  createDeviceRepairContext,
  findDeviceSymptoms,
  parseDeviceLogLine,
} from '../src/domain/evidence/deviceEvidence.js'

const boot = parseDeviceLogLine('I (31) boot: ESP-IDF v5.4.1 2nd stage bootloader', 'serial')
assert.equal(boot.category, 'boot')
assert.equal(boot.kind, 'idf-boot')
assert.equal(boot.severity, 'info')
assert.equal(boot.source, 'serial')

const reset = parseDeviceLogLine('rst:0xc (SW_CPU_RESET),boot:0x8 (SPI_FAST_FLASH_BOOT)')
assert.equal(reset.category, 'reset')
assert.equal(reset.kind, 'software-reset')
assert.equal(reset.severity, 'warning')

const panic = parseDeviceLogLine('Guru Meditation Error: Core  1 panic\'ed (LoadProhibited). Exception was unhandled.')
assert.equal(panic.category, 'panic')
assert.equal(panic.kind, 'guru-meditation')
assert.equal(panic.repairable, true)

const backtrace = parseDeviceLogLine('Backtrace: 0x42008e0a:0x3fcebf00 0x4037ad95:0x3fcebf20')
assert.equal(backtrace.category, 'panic')
assert.equal(backtrace.kind, 'backtrace')
assert.equal(backtrace.repairable, true)

const watchdog = parseDeviceLogLine('E (5241) task_wdt: Task watchdog got triggered. The following tasks did not reset the watchdog in time:')
assert.equal(watchdog.category, 'watchdog')
assert.equal(watchdog.kind, 'task-watchdog')
assert.equal(watchdog.severity, 'error')

const wifiIp = parseDeviceLogLine('I (6123) wifi: got ip:192.168.1.42')
assert.equal(wifiIp.category, 'wifi')
assert.equal(wifiIp.kind, 'wifi-got-ip')
assert.equal(wifiIp.status, 'success')
assert.equal(wifiIp.details.ip, '192.168.1.42')

const wifiDisconnect = parseDeviceLogLine('W (8123) wifi: disconnected, reason=201')
assert.equal(wifiDisconnect.category, 'wifi')
assert.equal(wifiDisconnect.kind, 'wifi-disconnected')
assert.equal(wifiDisconnect.repairable, true)

const lvglError = parseDeviceLogLine('E (9271) lvgl: lv_display_flush_ready called before display init')
assert.equal(lvglError.category, 'display')
assert.equal(lvglError.kind, 'lvgl-error')
assert.equal(lvglError.repairable, true)

const otaSuccess = parseDeviceLogLine('I (12000) esp_https_ota: Firmware upgrade successful, rebooting...')
assert.equal(otaSuccess.category, 'ota')
assert.equal(otaSuccess.kind, 'ota-success')
assert.equal(otaSuccess.status, 'success')

const otaFailure = parseDeviceLogLine('E (12200) esp_https_ota: OTA failed: ESP_ERR_HTTPS_CONNECT')
assert.equal(otaFailure.category, 'ota')
assert.equal(otaFailure.kind, 'ota-failure')
assert.equal(otaFailure.repairable, true)

const bleSuccess = parseDeviceLogLine('I (13000) ble_ota: BLE OTA commit complete, notify_code 0x00')
assert.equal(bleSuccess.category, 'ble-ota')
assert.equal(bleSuccess.kind, 'ble-ota-success')
assert.equal(bleSuccess.status, 'success')

const bleFailure = parseDeviceLogLine('E (13100) ble_ota: esp_ota_write failed: ESP_ERR_INVALID_SIZE')
assert.equal(bleFailure.category, 'ble-ota')
assert.equal(bleFailure.kind, 'ble-ota-failure')
assert.equal(bleFailure.repairable, true)

const driverSuccess = parseDeviceLogLine('I (904) esp32_s3_szp: LCD init success')
assert.equal(driverSuccess.category, 'driver')
assert.equal(driverSuccess.kind, 'driver-init-success')
assert.equal(driverSuccess.status, 'success')

const driverFailure = parseDeviceLogLine('E (906) i2c: driver install failed with ESP_ERR_INVALID_ARG')
assert.equal(driverFailure.category, 'driver')
assert.equal(driverFailure.kind, 'driver-init-failure')
assert.equal(driverFailure.repairable, true)

const symptoms = findDeviceSymptoms([
  boot.raw,
  wifiIp.raw,
  wifiDisconnect.raw,
  panic.raw,
  backtrace.raw,
  lvglError.raw,
])
assert.equal(symptoms.length, 6)
assert.deepEqual(symptoms.map(item => item.kind), [
  'idf-boot',
  'wifi-got-ip',
  'wifi-disconnected',
  'guru-meditation',
  'backtrace',
  'lvgl-error',
])

const evidence = createDeviceEvidence({
  source: 'serial',
  status: 'failure',
  lines: [
    'I (31) boot: ESP-IDF v5.4.1 2nd stage bootloader',
    'I (6123) wifi: got ip:192.168.1.42',
    'Guru Meditation Error: Core  1 panic\'ed (LoadProhibited). Exception was unhandled.',
    'Backtrace: 0x42008e0a:0x3fcebf00 0x4037ad95:0x3fcebf20',
  ],
  deliveryResult: { transport: 'usb', ok: true },
  deviceInfo: { chip: 'esp32s3', port: '/dev/cu.usbmodem1101' },
  elapsedMs: 7330,
})
assert.equal(evidence.source, 'serial')
assert.equal(evidence.status, 'failure')
assert.equal(evidence.deviceInfo.chip, 'esp32s3')
assert.equal(evidence.deliveryResult.transport, 'usb')
assert.equal(evidence.elapsedMs, 7330)
assert.equal(evidence.symptoms.length, 4)
assert.deepEqual(evidence.repairableSymptoms.map(item => item.kind), ['guru-meditation', 'backtrace'])
assert.deepEqual(evidence.rawContextLines, evidence.lines)

const repairContext = createDeviceRepairContext({
  deviceEvidence: evidence,
  manifest: {
    board: 'szpi-esp32s3',
    skills: ['wifi', 'lvgl'],
    files: [{ path: 'main/main.c' }],
  },
  userSymptom: 'Device reboots after WiFi connects.',
})
assert.equal(repairContext.kind, 'device-evidence-repair-context')
assert.equal(repairContext.canClaimFirmwareCorrectness, false)
assert.match(repairContext.summary, /2 repairable device symptom/)
assert.deepEqual(repairContext.symptoms.map(item => item.kind), ['guru-meditation', 'backtrace'])
assert.deepEqual(repairContext.rawContextLines, evidence.lines)
assert.equal(repairContext.manifest.board, 'szpi-esp32s3')
assert.equal(repairContext.userSymptom, 'Device reboots after WiFi connects.')
assert.ok(repairContext.aiInstructions.every(line => !/firmware is correct/i.test(line)))

const usbDelivery = createDeliveryDeviceEvidence({
  transport: 'usb',
  status: 'success',
  message: 'USB 烧录完成，设备已复位',
  firmwareSize: 262144,
  progress: 100,
})
assert.equal(usbDelivery.source, 'usb')
assert.equal(usbDelivery.status, 'success')
assert.equal(usbDelivery.deliveryResult.transport, 'usb')
assert.equal(usbDelivery.deliveryResult.firmwareSize, 262144)
assert.equal(usbDelivery.symptoms[0].kind, 'delivery-success')
assert.equal(usbDelivery.repairableSymptoms.length, 0)

const wifiDelivery = createDeliveryDeviceEvidence({
  transport: 'wifi-ota',
  deliveryResult: {
    ok: true,
    ip: '192.168.1.42',
    size: 393216,
    progress: 100,
  },
})
assert.equal(wifiDelivery.source, 'wifi-ota')
assert.equal(wifiDelivery.status, 'success')
assert.equal(wifiDelivery.deliveryResult.transport, 'wifi-ota')
assert.equal(wifiDelivery.deliveryResult.ip, '192.168.1.42')
assert.equal(wifiDelivery.deliveryResult.firmwareSize, 393216)
assert.equal(wifiDelivery.deliveryResult.progress, 100)
assert.equal(wifiDelivery.symptoms[0].category, 'delivery')
assert.equal(wifiDelivery.symptoms[0].kind, 'delivery-success')
assert.equal(wifiDelivery.symptoms[0].details.transport, 'wifi-ota')
assert.equal(wifiDelivery.repairableSymptoms.length, 0)

const bleDeliveryFailure = createDeliveryDeviceEvidence({
  transport: 'ble-ota',
  deliveryResult: {
    error: '设备错误: esp_ota_write failed',
    deviceName: 'ESP32-Vibe-OTA',
    firmwareSize: 262144,
    progress: 37,
  },
})
assert.equal(bleDeliveryFailure.source, 'ble-ota')
assert.equal(bleDeliveryFailure.status, 'failure')
assert.equal(bleDeliveryFailure.deliveryResult.deviceName, 'ESP32-Vibe-OTA')
assert.equal(bleDeliveryFailure.deliveryResult.progress, 37)
assert.equal(bleDeliveryFailure.symptoms[0].kind, 'delivery-failure')
assert.equal(bleDeliveryFailure.repairableSymptoms[0].category, 'delivery')
assert.match(bleDeliveryFailure.repairableSymptoms[0].message, /esp_ota_write failed/)

const remoteQueued = createDeliveryDeviceEvidence({
  transport: 'remote-ota',
  deliveryResult: { status: 'queued', jobId: 'job-1234', deviceId: 'szpi-s3' },
})
assert.equal(remoteQueued.status, 'queued')
assert.equal(remoteQueued.deliveryResult.jobId, 'job-1234')
assert.equal(remoteQueued.deliveryResult.status, 'queued')
assert.equal(remoteQueued.symptoms[0].status, 'observed')

const remoteDone = createDeliveryDeviceEvidence({
  transport: 'remote-ota',
  deliveryResult: { status: 'flashed', jobId: 'job-1234', deviceId: 'szpi-s3' },
})
assert.equal(remoteDone.status, 'success')
assert.equal(remoteDone.deliveryResult.status, 'success')
assert.equal(remoteDone.symptoms[0].kind, 'delivery-success')

const usbQueued = createDeliveryDeviceEvidence({
  transport: 'usb',
  deliveryResult: { status: 'pushing', automatic: true, firmwareSize: 262144 },
})
assert.equal(usbQueued.status, 'queued')
assert.equal(usbQueued.deliveryResult.automatic, true)
assert.equal(usbQueued.symptoms[0].kind, 'delivery-queued')
assert.equal(usbQueued.symptoms[0].status, 'observed')

console.log('device evidence tests passed')
