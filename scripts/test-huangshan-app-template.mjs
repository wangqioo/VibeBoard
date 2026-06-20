import assert from 'node:assert/strict'
import {
  createHuangshanAppFiles,
  normalizeHuangshanAppId,
  normalizeHuangshanAppName,
  validateHuangshanAppFiles,
} from '../src/domain/huangshan/appTemplate.js'

assert.equal(normalizeHuangshanAppName('Board Diagnostics'), 'Board_Diagnostics')
assert.equal(normalizeHuangshanAppName('  传感器 面板  '), 'App')
assert.equal(normalizeHuangshanAppId('Board Diagnostics'), 'board_diagnostics')
assert.equal(normalizeHuangshanAppId('123 Demo'), 'app_123_demo')

const files = createHuangshanAppFiles({
  displayName: 'Board Diagnostics',
  description: 'Show display, touch, and timer status.',
})

assert.ok(files['src/gui_apps/Board_Diagnostics/main.c'].includes('#define APP_ID "board_diagnostics"'))
assert.ok(files['src/gui_apps/Board_Diagnostics/main.c'].includes('BUILTIN_APP_EXPORT'))
assert.ok(files['src/gui_apps/Board_Diagnostics/main.c'].includes('BUILTIN_APP_EXPORT(LV_EXT_STR_ID(lckfb), LV_EXT_IMG_GET(img_LiChuang), APP_ID, msg_handler);'))
assert.doesNotMatch(files['src/gui_apps/Board_Diagnostics/main.c'], /LV_EXT_STR_ID\(board_diagnostics\)/)
assert.ok(files['src/gui_apps/Board_Diagnostics/main.c'].includes('GUI_APP_MSG_ONSTART'))
assert.ok(files['src/gui_apps/Board_Diagnostics/main.c'].includes('rt_kprintf("[Board_Diagnostics] start'))
assert.ok(files['src/gui_apps/Board_Diagnostics/SConscript'].includes("src = Glob('*.c')"))

const valid = validateHuangshanAppFiles(files, { appName: 'Board_Diagnostics' })
assert.equal(valid.ok, true)
assert.deepEqual(valid.rejected, [])

const invalid = validateHuangshanAppFiles({
  'src/gui_apps/Board_Diagnostics/main.c': 'int ok;',
  'project/proj.conf': 'CONFIG_BAD=y',
  '../escape.c': 'int bad;',
  'src/gui_apps/Other/main.c': 'int wrong;',
}, { appName: 'Board_Diagnostics' })
assert.equal(invalid.ok, false)
assert.deepEqual(invalid.rejected.map(item => item.reason), [
  'project-config-not-allowed',
  'unsafe-path',
  'outside-active-app',
])

const escaped = createHuangshanAppFiles({
  displayName: 'Quote Test',
  description: 'Status "quoted" \\ path',
})
assert.ok(escaped['src/gui_apps/Quote_Test/main.c'].includes('Status \\"quoted\\" \\\\ path'))

const asciiOnly = createHuangshanAppFiles({
  displayName: '传感器 面板',
  description: '环境光 状态',
})
assert.ok(asciiOnly['src/gui_apps/Codex_App/main.c'])
assert.doesNotMatch(asciiOnly['src/gui_apps/Codex_App/main.c'], /[\u4e00-\u9fff]/)

console.log('huangshan app template tests passed')
