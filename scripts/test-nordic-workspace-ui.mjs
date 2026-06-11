import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const source = readFileSync(new URL('../src/components/NordicWorkspace.jsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/components/NordicWorkspace.css', import.meta.url), 'utf8')

assert.match(app, /import NordicWorkspace/)
assert.match(app, /workspaceMode === 'nordic'/)
assert.match(app, /TOOLCHAINS\.NCS_ZEPHYR/)
assert.match(app, /<NordicWorkspace settings=\{settings\} onOpenSettings=\{\(\) => setShowSettings\(true\)\} \/>/)

assert.match(source, /createNordicAppFiles/)
assert.match(source, /compileNordicProject/)
assert.match(source, /checkNordicCompilerHealth/)
assert.match(source, /async function handleBuild\(\)/)
assert.match(source, /west build -b/)
assert.match(source, /服务器 west build/)
assert.match(source, /nordic-build-panel/)
assert.match(source, /nordic-build-log/)
assert.match(source, /artifact\.relativePath/)
assert.match(source, /真实 Zephyr 工程文件/)
assert.match(source, /prj\.conf 和 src\/main\.c/)
assert.match(source, /ble_peripheral/)
assert.match(source, /gpio_led_button/)

assert.match(styles, /\.nordic-workspace\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 260px\) minmax\(0, 55fr\) minmax\(0, 45fr\);/)
assert.match(styles, /\.nordic-sidebar\s*\{/)
assert.match(styles, /\.nordic-main\s*\{/)
assert.match(styles, /\.nordic-assistant\s*\{/)
assert.match(styles, /\.nordic-build-panel\s*\{/)
assert.match(styles, /\.nordic-build-log\s*\{/)
assert.match(styles, /\.nordic-editor-wrap\s*\{[\s\S]*grid-template-columns:\s*minmax\(180px, 240px\) minmax\(0, 1fr\);/)

console.log('nordic workspace UI tests passed')
