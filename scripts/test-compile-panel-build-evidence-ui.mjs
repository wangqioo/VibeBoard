import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const compilePanel = await readFile(new URL('../src/components/CompilePanel.jsx', import.meta.url), 'utf8')
const compilePanelCss = await readFile(new URL('../src/components/CompilePanel.css', import.meta.url), 'utf8')
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

assert.match(compilePanel, /function formatBuildEvidenceValue\(/)
assert.match(compilePanel, /import \{ createBuildEvidence \} from '..\/domain\/evidence\/buildEvidence'/)
assert.match(compilePanel, /const preflightEvidence = createBuildEvidence\(\{/)
assert.match(compilePanel, /status: 'failure'/)
assert.match(compilePanel, /command: 'preflight-project-assembly'/)
assert.match(compilePanel, /logLines: compilePackage\.diagnostics \|\| \[\]/)
assert.match(compilePanel, /setBuildEvidence\(preflightEvidence\)/)
assert.match(compilePanel, /const buildEvidenceRows = /)
assert.match(compilePanel, /buildState === 'error' && buildEvidence && buildEvidenceRows\.length > 0/)
assert.match(compilePanel, /className="build-evidence-panel"/)
assert.match(compilePanel, />Build Evidence</)
assert.match(compilePanel, /label: '失败分类'/)
assert.match(compilePanel, /value: buildEvidence\?\.failureCategory/)
assert.match(compilePanel, /label: '首个失败位置'/)
assert.match(compilePanel, /buildEvidence\?\.firstError\?\.file/)
assert.match(compilePanel, /buildEvidence\.firstError\.lineNumber/)
assert.match(compilePanel, /label: '修复上下文'/)
assert.match(compilePanel, /buildEvidence\?\.repairContext\?\.kind/)
assert.match(compilePanel, /buildEvidence\.repairContext\.confidence/)
assert.match(compilePanel, /label: '修复策略'/)
assert.match(compilePanel, /buildEvidence\?\.repairContext\?\.repairStrategy/)

assert.match(compilePanel, /buildEvidence,\s*\n\s*buildLog,\s*\n\s*errorLog,\s*\n\s*projectFiles: sourceProp \|\| \{\},\s*\n\s*selectedSkills: selectedSkills \|\| \[\],/)
assert.match(compilePanel, />\s*AI 修复编译错误\s*</)

assert.match(compilePanelCss, /\.build-evidence-panel/)
assert.match(compilePanelCss, /\.build-evidence-grid/)
assert.match(compilePanelCss, /\.build-evidence-label/)
assert.match(compilePanelCss, /\.build-evidence-value/)

assert.equal(
  packageJson.scripts['test:compile-panel-build-evidence-ui'],
  'node scripts/test-compile-panel-build-evidence-ui.mjs'
)

console.log('compile panel build evidence UI guard passed')
