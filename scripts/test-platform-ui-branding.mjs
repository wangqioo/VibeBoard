import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const appSource = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const chatPanel = await readFile(new URL('../src/components/ChatPanel.jsx', import.meta.url), 'utf8')
const appCss = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
const indexCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')

assert.match(appSource, /VibeBoard Micro/)
assert.match(appSource, /AI Hardware Workbench/)
assert.match(appSource, /本地改码 \/ 编译 \/ 烧录 \/ 预览 \/ 设备证据/)
assert.match(appSource, /webCodeGenerationEnabled = ENABLE_LEGACY_WEB_AGENT && ENABLE_WEB_CODE_GENERATION/)
assert.match(appSource, /Legacy Agent/)
assert.doesNotMatch(appSource, /AI 工作流/)
assert.match(appSource, /设备证据/)
assert.match(appSource, /MCP/)
assert.doesNotMatch(appSource, /ESP32 Vibe Coder/)
assert.doesNotMatch(appSource, /🤖|📟|⚙/)

assert.match(chatPanel, /AI 硬件工作流/)
assert.match(chatPanel, /'生成并编译'/)
assert.match(chatPanel, /AI 只写\s*<code>main\/<\/code>\s*应用源码/)
assert.match(chatPanel, /系统配置由 VibeBoard 生成/)
assert.doesNotMatch(chatPanel, /<span>AI 代码助手<\/span>/)
assert.doesNotMatch(chatPanel, /:\s*'生成代码'/)

assert.match(indexCss, /--accent:\s*#38bdf8/)
assert.match(indexCss, /--accent-hover:\s*#7dd3fc/)
assert.match(indexCss, /--accent-muted:\s*rgba\(56,\s*189,\s*248,\s*\.15\)/)
assert.match(appCss, /\.product-subtitle/)
assert.match(appCss, /\.workflow-strip/)

console.log('platform ui branding checks passed')
