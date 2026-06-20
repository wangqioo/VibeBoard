import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const flags = readFileSync(new URL('../src/config/productFlags.js', import.meta.url), 'utf8')
const huangshan = readFileSync(new URL('../src/components/HuangshanWorkspace.jsx', import.meta.url), 'utf8')
const nordic = readFileSync(new URL('../src/components/NordicWorkspace.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(flags, /ENABLE_WEB_CODE_GENERATION\s*=\s*false/)
assert.match(app, /ENABLE_WEB_CODE_GENERATION/)
assert.match(app, /webCodeGenerationEnabled = ENABLE_LEGACY_WEB_AGENT && ENABLE_WEB_CODE_GENERATION/)
assert.doesNotMatch(app, /Legacy Agent/)
assert.doesNotMatch(app, />\s*配置 AI\s*</)
assert.doesNotMatch(app, />\s*AI 修复编译错误\s*</)

for (const [name, source] of [['HuangshanWorkspace', huangshan], ['NordicWorkspace', nordic]]) {
  assert.doesNotMatch(source, /generateHuangshanBuilderConfig|generateNordicProjectWithAi/, `${name} must not import browser AI generation adapters`)
  assert.doesNotMatch(source, /handleGenerateWithAi|applyPrompt/, `${name} must not keep browser AI generation handlers`)
  assert.doesNotMatch(source, /AI 代码助手|AI 工程助手|AI 设置|AI 生成工程|AI 生成中|AI 生成失败|按方案生成代码/, `${name} must not expose web AI generation UI`)
}

assert.match(huangshan, /本地 Agent 工作流/)
assert.match(huangshan, /通过 MCP 或本地仓库修改黄山派应用源码/)
assert.match(nordic, /本地 Agent 工作流/)
assert.match(nordic, /通过 MCP 或本地仓库修改 Nordic 工程/)

assert.equal(packageJson.scripts['test:no-web-code-generation-ui'], 'node scripts/test-no-web-code-generation-ui.mjs')

console.log('No web code generation UI tests passed.')
