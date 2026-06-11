import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const chatPanel = await readFile(new URL('../src/components/ChatPanel.jsx', import.meta.url), 'utf8')
const chatCss = await readFile(new URL('../src/components/ChatPanel.css', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(app, /evaluateAcceptanceChecks/)
assert.match(app, /acceptanceState/)
assert.match(app, /acceptanceState=\{acceptanceState\}/)
assert.match(app, /buildEvidence:\s*latestCompileArtifact\?\./)
assert.match(app, /deviceEvidence:\s*latestDeviceEvidence/)

assert.match(chatPanel, /acceptanceState\s*=\s*null/)
assert.match(chatPanel, /function AcceptanceStrip/)
assert.match(chatPanel, /acceptance-strip/)
assert.match(chatPanel, /AcceptanceStrip acceptanceState=\{acceptanceState\}/)
assert.match(chatPanel, /passes|needs-observation|failed/)

assert.match(chatCss, /\.acceptance-strip/)
assert.match(chatCss, /\.acceptance-check\.passes/)
assert.match(chatCss, /\.acceptance-check\.needs-observation/)
assert.match(chatCss, /\.acceptance-check\.failed/)

assert.equal(
  packageJson.scripts['test:acceptance-ui-bridge'],
  'node scripts/test-acceptance-ui-bridge.mjs'
)

console.log('acceptance UI bridge tests passed')
