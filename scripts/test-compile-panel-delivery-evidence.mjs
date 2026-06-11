import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const compilePanel = await readFile(new URL('../src/components/CompilePanel.jsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(compilePanel, /createDeliveryDeviceEvidence/)
assert.match(compilePanel, /onDeviceEvidence/)
assert.match(compilePanel, /transport: 'wifi-ota'/)
assert.match(compilePanel, /transport: 'ble-ota'/)
assert.match(compilePanel, /transport: 'usb'/)
assert.match(compilePanel, /transport: 'remote-ota'/)
assert.match(compilePanel, /onDeviceEvidence\?\.\(createDeliveryDeviceEvidence\(\{/)
assert.match(compilePanel, /firmwareSize: firmware\.size/)
assert.match(compilePanel, /deliveryResult: job/)

assert.match(app, /onDeviceEvidence=\{setLatestDeviceEvidence\}/)

assert.equal(
  packageJson.scripts['test:compile-panel-delivery-evidence'],
  'node scripts/test-compile-panel-delivery-evidence.mjs'
)

console.log('compile panel delivery evidence tests passed')
