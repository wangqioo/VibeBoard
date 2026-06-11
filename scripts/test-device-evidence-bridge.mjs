import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const logPanel = await readFile(new URL('../src/components/LogPanel.jsx', import.meta.url), 'utf8')
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const chatPanel = await readFile(new URL('../src/components/ChatPanel.jsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(logPanel, /createDeviceEvidence/)
assert.match(logPanel, /onDeviceEvidence/)
assert.match(logPanel, /const deviceEvidence = createDeviceEvidence\(/)
assert.match(logPanel, /onAnalyze\(lines\.map\(l => l\.raw\)\.join\('\\n'\), deviceEvidence\)/)

assert.match(app, /createDeviceRepairContext/)
assert.match(app, /latestDeviceEvidence/)
assert.match(app, /setLatestDeviceEvidence/)
assert.match(app, /recentDeviceEvidence=\{latestDeviceEvidence\}/)
assert.match(app, /onDeviceEvidence=\{setLatestDeviceEvidence\}/)
assert.match(app, /createDeviceRepairContext\(\{/)

assert.match(chatPanel, /recentDeviceEvidence = null/)
assert.match(chatPanel, /recentDeviceEvidence: request\.recentDeviceEvidence \|\| recentDeviceEvidence/)
assert.match(chatPanel, /recentDeviceEvidence,\s*\n\s*source: 'generation-auto-compile'/)

assert.equal(
  packageJson.scripts['test:device-evidence-bridge'],
  'node scripts/test-device-evidence-bridge.mjs'
)

console.log('device evidence bridge tests passed')
