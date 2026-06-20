import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createDeliveryDeviceEvidence } from '../src/domain/evidence/deviceEvidence.js'

const compilePanel = await readFile(new URL('../src/components/CompilePanel.jsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(compilePanel, /createDeliveryDeviceEvidence/)
assert.match(compilePanel, /import \{ createDeliveryDeviceEvidence \} from '\.\.\/domain\/evidence\/deviceEvidence'/)
assert.match(compilePanel, /onDeviceEvidence/)
assert.match(compilePanel, /transport: 'wifi-ota'/)
assert.match(compilePanel, /transport: 'ble-ota'/)
assert.match(compilePanel, /transport: 'usb'/)
assert.match(compilePanel, /transport: 'remote-ota'/)
assert.match(compilePanel, /function recordDeviceEvidence\(evidence\)/)
assert.match(compilePanel, /setLatestDeviceEvidence\(evidence\)/)
assert.match(compilePanel, /onDeviceEvidence\?\.\(evidence\)/)
assert.match(compilePanel, /recordDeviceEvidence\(createDeliveryDeviceEvidence\(\{/)
assert.match(compilePanel, /firmwareSize: firmware\.size/)
assert.match(compilePanel, /deliveryResult: \{ \.\.\.job, firmwareSize: firmware\?\.size \|\| null \}/)
assert.match(compilePanel, /deliveryResult: \{ \.\.\.job, firmwareSize: firmware\.size \}/)
assert.doesNotMatch(compilePanel, /onDeviceEvidence\?\.\(\s*\{\s*source:/)
assert.doesNotMatch(compilePanel, /category: ['"]delivery['"]/)
assert.doesNotMatch(compilePanel, /repairableSymptoms:\s*\[/)

assert.match(app, /onDeviceEvidence=\{setLatestDeviceEvidence\}/)

assert.equal(
  packageJson.scripts['test:compile-panel-delivery-evidence'],
  'node scripts/test-compile-panel-delivery-evidence.mjs'
)

const compilePanelDeliveryCases = [
  {
    name: 'wifi ota success',
    input: {
      transport: 'wifi-ota',
      status: 'success',
      message: '固件推送成功，设备正在重启...',
      firmwareSize: 393216,
      progress: 100,
      deliveryResult: { ip: '192.168.1.42' },
      deviceInfo: { chip: 'esp32s3' },
    },
    expected: {
      source: 'wifi-ota',
      status: 'success',
      kind: 'delivery-success',
      repairable: 0,
      deliveryResult: {
        ip: '192.168.1.42',
        firmwareSize: 393216,
        progress: 100,
      },
    },
  },
  {
    name: 'wifi ota failure',
    input: {
      transport: 'wifi-ota',
      status: 'failure',
      message: 'connect ECONNREFUSED 192.168.1.42',
      firmwareSize: 393216,
      progress: 41,
      deliveryResult: { ip: '192.168.1.42' },
    },
    expected: {
      source: 'wifi-ota',
      status: 'failure',
      kind: 'delivery-failure',
      repairable: 1,
      deliveryResult: {
        ip: '192.168.1.42',
        firmwareSize: 393216,
        progress: 41,
      },
    },
  },
  {
    name: 'ble ota success',
    input: {
      transport: 'ble-ota',
      status: 'success',
      message: 'BLE 烧录成功，设备正在重启...',
      firmwareSize: 262144,
      progress: 100,
      deliveryResult: { deviceName: 'ESP32-Vibe-OTA' },
      deviceInfo: { name: 'ESP32-Vibe-OTA' },
    },
    expected: {
      source: 'ble-ota',
      status: 'success',
      kind: 'delivery-success',
      repairable: 0,
      deliveryResult: {
        deviceName: 'ESP32-Vibe-OTA',
        firmwareSize: 262144,
        progress: 100,
      },
    },
  },
  {
    name: 'ble ota failure',
    input: {
      transport: 'ble-ota',
      status: 'failure',
      message: 'esp_ota_write failed',
      firmwareSize: 262144,
      progress: 37,
      deliveryResult: { deviceName: 'ESP32-Vibe-OTA' },
      deviceInfo: { name: 'ESP32-Vibe-OTA' },
    },
    expected: {
      source: 'ble-ota',
      status: 'failure',
      kind: 'delivery-failure',
      repairable: 1,
      deliveryResult: {
        deviceName: 'ESP32-Vibe-OTA',
        firmwareSize: 262144,
        progress: 37,
      },
    },
  },
  {
    name: 'usb success',
    input: {
      transport: 'usb',
      status: 'success',
      message: 'USB 烧录完成，设备已复位',
      firmwareSize: 524288,
      progress: 100,
      deliveryResult: { automatic: false },
    },
    expected: {
      source: 'usb',
      status: 'success',
      kind: 'delivery-success',
      repairable: 0,
      deliveryResult: {
        automatic: false,
        firmwareSize: 524288,
        progress: 100,
      },
    },
  },
  {
    name: 'usb failure',
    input: {
      transport: 'usb',
      status: 'failure',
      message: 'WebSerial port closed',
      firmwareSize: 524288,
      progress: 3,
      deliveryResult: { automatic: true },
    },
    expected: {
      source: 'usb',
      status: 'failure',
      kind: 'delivery-failure',
      repairable: 1,
      deliveryResult: {
        automatic: true,
        firmwareSize: 524288,
        progress: 3,
      },
    },
  },
  {
    name: 'remote ota queued',
    input: {
      transport: 'remote-ota',
      status: 'queued',
      message: '远程 OTA 已下发，等待设备领取',
      firmwareSize: 655360,
      deliveryResult: { status: 'queued', jobId: 'job-1234', deviceId: 'szpi-s3' },
      deviceInfo: { deviceId: 'szpi-s3' },
    },
    expected: {
      source: 'remote-ota',
      status: 'queued',
      kind: 'delivery-queued',
      repairable: 0,
      symptomStatus: 'observed',
      deliveryResult: {
        status: 'queued',
        jobId: 'job-1234',
        deviceId: 'szpi-s3',
        firmwareSize: 655360,
      },
    },
  },
  {
    name: 'remote ota failure',
    input: {
      transport: 'remote-ota',
      status: 'failure',
      message: '远程设备当前不在线',
      firmwareSize: 655360,
      deliveryResult: { deviceId: 'szpi-s3' },
      deviceInfo: { deviceId: 'szpi-s3' },
    },
    expected: {
      source: 'remote-ota',
      status: 'failure',
      kind: 'delivery-failure',
      repairable: 1,
      deliveryResult: {
        deviceId: 'szpi-s3',
        firmwareSize: 655360,
      },
    },
  },
  {
    name: 'remote ota done',
    input: {
      transport: 'remote-ota',
      status: 'done',
      message: '远程 OTA 状态：done',
      firmwareSize: 655360,
      deliveryResult: { status: 'done', jobId: 'job-1234', deviceId: 'szpi-s3' },
      deviceInfo: { deviceId: 'szpi-s3' },
    },
    expected: {
      source: 'remote-ota',
      status: 'success',
      kind: 'delivery-success',
      repairable: 0,
      deliveryResult: {
        status: 'success',
        jobId: 'job-1234',
        deviceId: 'szpi-s3',
        firmwareSize: 655360,
      },
    },
  },
]

for (const item of compilePanelDeliveryCases) {
  const evidence = createDeliveryDeviceEvidence(item.input)
  assert.equal(evidence.source, item.expected.source, item.name)
  assert.equal(evidence.status, item.expected.status, item.name)
  assert.equal(evidence.symptoms[0].category, 'delivery', item.name)
  assert.equal(evidence.symptoms[0].kind, item.expected.kind, item.name)
  assert.equal(evidence.symptoms[0].status, item.expected.symptomStatus || item.expected.status, item.name)
  assert.equal(evidence.repairableSymptoms.length, item.expected.repairable, item.name)
  assert.equal(evidence.deliveryResult.transport, item.expected.source, item.name)
  for (const [key, value] of Object.entries(item.expected.deliveryResult)) {
    assert.equal(evidence.deliveryResult[key], value, `${item.name}: deliveryResult.${key}`)
  }
}

console.log('compile panel delivery evidence tests passed')
