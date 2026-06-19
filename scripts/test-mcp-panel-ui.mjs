import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(app, /import McpPanel from '\.\/components\/McpPanel'/)
assert.match(app, /<McpPanel\s*\/>/)
assert.doesNotMatch(app, /Local MCP server will expose compile, flash, preview, and evidence tools\./)

const panel = await readFile(new URL('../src/components/McpPanel.jsx', import.meta.url), 'utf8')
assert.match(panel, /listCapabilities/)
assert.match(panel, /npm run mcp:server/)
assert.match(panel, /vibeboard\.compile_project/)
assert.match(panel, /vibeboard\.render_lvgl_preview/)
assert.match(panel, /vibeboard\.flash_usb/)
assert.match(panel, /vibeboard\.flash_wifi_ota/)
assert.match(panel, /vibeboard\.flash_ble_ota/)
assert.match(panel, /vibeboard\.collect_device_evidence/)
assert.match(panel, /mcp-tool-row/)

const css = await readFile(new URL('../src/components/McpPanel.css', import.meta.url), 'utf8')
assert.match(css, /\.mcp-panel/)
assert.match(css, /\.mcp-tool-row/)
assert.match(css, /\.mcp-status/)

assert.equal(packageJson.scripts['test:mcp-panel-ui'], 'node scripts/test-mcp-panel-ui.mjs')

console.log('MCP panel UI tests passed.')
