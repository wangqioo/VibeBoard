import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-code-generation-'))

async function copyModule(relPath) {
  const source = new URL(`../${relPath}`, import.meta.url)
  const target = join(tmp, relPath.replace(/^src\//, 'src/'))
  await mkdir(dirname(target), { recursive: true })
  let code = await readFile(source, 'utf8')
  code = code.replaceAll(/from '(\.[^']+)'/g, (match, spec) => {
    if (spec.endsWith('.js')) return match
    return `from '${spec}.js'`
  })
  await writeFile(target, code)
  return target
}

await copyModule('src/utils/filePlacement.js')
await copyModule('src/domain/workflow/failureCategories.js')
await copyModule('src/domain/digitalTwin/uiManifest.js')
await copyModule('src/domain/program/intent.js')
await copyModule('src/domain/program/manifestSchema.js')
await copyModule('src/domain/program/validateManifest.js')
await copyModule('src/domain/previewRepair/repairIntent.js')
await copyModule('src/context/boards/szpi_esp32s3/lvglDesignProfiles.js')
await copyModule('src/utils/codeGeneration.js')

const {
  buildLvglDesignDraftMessages,
  buildManifestCodeGenerationMessages,
  buildProgramManifestMessages,
  buildScopeClarificationMessages,
  buildBuildRepairMessages,
  buildSourceContractRepairMessages,
  extractFileBlocks,
  extractJsonObject,
  buildPreviewRepairMessages,
  inferSkillsFromRequest,
  parseProgramManifestResponse,
  parseScopeClarificationResponse,
  parseGeneratedFilesResponse,
  parseGeneratedFilesResponseWithOptions,
} = await import(pathToFileURL(join(tmp, 'src/utils/codeGeneration.js')).href)
const {
  buildPreviewFeedbackEvidence,
  hasEditableProject,
  isLikelyPreviewRepairRequest,
} = await import(pathToFileURL(join(tmp, 'src/domain/previewRepair/repairIntent.js')).href)

assert.equal(extractJsonObject('```json\n{"files":[]}\n```'), '{"files":[]}')
assert.equal(extractJsonObject('```c\nvoid app_main(void) {}\n```'), '')

const fencedWithText = extractJsonObject('Here is the result:\n```json\n{"files":[]}\n```\nDone.')
assert.equal(fencedWithText, '{"files":[]}')

const ok = parseGeneratedFilesResponse(JSON.stringify({
  files: [
    { path: 'main/main.c', content: '#include "helper.h"\nvoid app_main(void) { helper(); }' },
    { path: 'helper.h', content: '#pragma once\nvoid helper(void);' },
    { path: 'helper.c', content: '#include "helper.h"\nvoid helper(void) {}' },
  ],
}))
assert.equal(ok.ok, true)
assert.deepEqual(Object.keys(ok.files).sort(), ['main/helper.c', 'main/helper.h', 'main/main.c'])

const withUiManifest = parseGeneratedFilesResponse(JSON.stringify({
  files: [
    { path: 'main/main.c', content: 'void app_main(void) {}' },
  ],
  uiManifest: {
    title: 'Hello UI',
    screen: { background: '#101820' },
    widgets: [
      { id: 'title', type: 'label', text: 'Hello', x: 12, y: 10, w: 160, h: 28 },
      { id: 'start', type: 'button', text: 'Start', x: 220, y: 190, w: 80, h: 32 },
    ],
  },
}))
assert.equal(withUiManifest.ok, true)
assert.equal(withUiManifest.files.__digitalTwinManifest.title, 'Hello UI')
assert.equal(withUiManifest.files.__digitalTwinManifest.widgets.length, 2)
assert.equal(withUiManifest.digitalTwinManifest.screen.background, '#101820')

const fileBlockRaw = `FILE: main/main.c
\`\`\`c
#include "helper.h"
void app_main(void) { helper(); }
\`\`\`

FILE: main/helper.h
\`\`\`c
#pragma once
void helper(void);
\`\`\`

FILE: main/helper.c
\`\`\`c
#include "helper.h"
void helper(void) {}
\`\`\``
assert.deepEqual(Object.keys(extractFileBlocks(fileBlockRaw)).sort(), ['main/helper.c', 'main/helper.h', 'main/main.c'])
const fileBlock = parseGeneratedFilesResponse(fileBlockRaw)
assert.equal(fileBlock.ok, true)
assert.deepEqual(Object.keys(fileBlock.files).sort(), ['main/helper.c', 'main/helper.h', 'main/main.c'])

const config = parseGeneratedFilesResponse(JSON.stringify({
  files: [
    { path: 'main/main.c', content: 'void app_main(void) {}' },
    { path: 'CMakeLists.txt', content: 'bad' },
  ],
}))
assert.equal(config.ok, false)
assert.match(config.errors.join(','), /config-not-allowed/)

const missingMain = parseGeneratedFilesResponse(JSON.stringify({
  files: [{ path: 'main/helper.c', content: 'void helper(void) {}' }],
}))
assert.equal(missingMain.ok, false)
assert.match(missingMain.errors.join(','), /missing-main-app-main/)

const partialRepairPatch = parseGeneratedFilesResponseWithOptions(JSON.stringify({
  files: [{ path: 'main/app_ui.c', content: '#include "app_ui.h"\nvoid app_ui_create(lv_obj_t *root) {}' }],
}), null, {
  requireCompleteProject: false,
  validateManifestFiles: false,
})
assert.equal(partialRepairPatch.ok, true)
assert.deepEqual(Object.keys(partialRepairPatch.files), ['main/app_ui.c'])

const board = {
  id: 'szpi_esp32s3',
  skills: [
    { id: 'gpio', label: 'GPIO' },
    { id: 'lvgl', label: 'LVGL' },
    { id: 'wifi', label: 'WiFi' },
    { id: 'audio', label: 'Audio' },
    { id: 'ble', label: 'BLE' },
    { id: 'camera', label: 'Camera' },
    { id: 'speech', label: 'Speech' },
  ],
  buildSystemPrompt: (skills = []) => `board prompt ${skills.join(',')}`,
}

assert.deepEqual(
  new Set(inferSkillsFromRequest(board, '做一个触屏 MP3 音乐播放器')),
  new Set(['lvgl', 'audio']),
)
assert.deepEqual(
  new Set(inferSkillsFromRequest(board, 'WiFi 扫描并显示连接界面')),
  new Set(['lvgl', 'wifi']),
)
assert.deepEqual(
  new Set(inferSkillsFromRequest(board, '做一个语音识别控制屏幕')),
  new Set(['lvgl', 'audio', 'speech']),
)
assert.deepEqual(
  new Set(inferSkillsFromRequest(board, 'BOOT 按键中断计数')),
  new Set(['gpio']),
)

const scopedLvgl = parseScopeClarificationResponse(JSON.stringify({
  scopeStatus: 'ready',
  scopeSummary: 'Touch MP3 player first screen.',
  selectedSkillIds: ['lvgl', 'audio'],
  designRequired: true,
  designProfileId: 'media_console',
  designIntent: 'Approve the player home screen before firmware generation.',
  constraints: ['Use LVGL preview first'],
  questions: [],
}))
assert.equal(scopedLvgl.ok, true)
assert.equal(scopedLvgl.status, 'ready')
assert.equal(scopedLvgl.designRequired, true)
assert.equal(scopedLvgl.designProfileId, 'media_console')
assert.match(scopedLvgl.designIntent, /player home screen/)

const manifest = parseProgramManifestResponse(JSON.stringify({
  schemaVersion: 1,
  boardId: 'szpi_esp32s3',
  skillIds: ['lvgl'],
  programName: 'hello_display',
  entry: 'main.c',
  files: [
    { path: 'main.c', role: 'entry' },
    { path: 'app_ui.h', role: 'header' },
    { path: 'app_ui.c', role: 'module' },
  ],
  requires: { display: true },
  allowedWriteSurface: 'application-source-only',
}), board)
assert.equal(manifest.ok, true)
assert.equal(manifest.manifest.entry, 'main/main.c')
assert.deepEqual(manifest.manifest.files.map(file => file.path).sort(), ['main/app_ui.c', 'main/app_ui.h', 'main/main.c'])

const badManifest = parseProgramManifestResponse(JSON.stringify({
  schemaVersion: 1,
  boardId: 'szpi_esp32s3',
  skillIds: ['lvgl'],
  programName: 'bad',
  entry: 'main/main.c',
  files: [
    { path: 'main/main.c', role: 'entry' },
    { path: 'sdkconfig.defaults', role: 'module' },
  ],
  allowedWriteSurface: 'application-source-only',
}), board)
assert.equal(badManifest.ok, false)
assert.match(badManifest.errors.join(','), /system-file-write-denied/)

assert.match(
  buildProgramManifestMessages({ board, selectedSkills: ['lvgl'], userRequest: 'show hello' })[0].content,
  /Official SZPI ESP32-S3 Example Rules[\s\S]*12-speech_recognition/,
)
assert.match(
  buildProgramManifestMessages({ board, selectedSkills: ['lvgl'], userRequest: 'show hello' })[0].content,
  /app_ui_create\(lv_obj_t \*root\)/,
)
assert.match(
  buildScopeClarificationMessages({ board, selectedSkills: ['lvgl'], userRequest: 'show hello' })[0].content,
  /designRequired=true/,
)
assert.match(
  buildScopeClarificationMessages({ board, selectedSkills: ['lvgl'], userRequest: 'show hello' })[0].content,
  /LVGL design profiles/,
)
const designDraftMessages = buildLvglDesignDraftMessages({
  board,
  selectedSkills: ['lvgl', 'audio'],
  userRequest: '做一个触屏 MP3 音乐播放器',
  scope: scopedLvgl,
})
assert.match(designDraftMessages[0].content, /LVGL design draft step/)
assert.match(designDraftMessages[0].content, /Generate exactly main\/app_ui\.h and main\/app_ui\.c/)
assert.match(designDraftMessages[0].content, /media_console/)
assert.match(designDraftMessages[0].content, /uiManifest screen\.background must match/)
assert.match(designDraftMessages[1].content, /Approve the player home screen/)
assert.match(
  buildManifestCodeGenerationMessages({ board, manifest: manifest.manifest, userRequest: 'show hello' })[1].content,
  /Validated Program Manifest/,
)
assert.match(
  buildManifestCodeGenerationMessages({ board, manifest: manifest.manifest, userRequest: 'show hello' })[0].content,
  /Do not use APIs from a skill family/,
)
assert.match(
  buildManifestCodeGenerationMessages({ board, manifest: manifest.manifest, userRequest: 'show hello' })[0].content,
  /portable LVGL-only preview code/,
)
const manifestGenerationWithApprovedDesign = buildManifestCodeGenerationMessages({
  board,
  manifest: manifest.manifest,
  userRequest: 'show hello',
  existingFiles: {
    'main/app_ui.h': '#pragma once\n#include "lvgl.h"\nvoid app_ui_create(lv_obj_t *root);\nvoid app_ui_start(void);',
    'main/app_ui.c': '#include "app_ui.h"\nvoid app_ui_create(lv_obj_t *root) {}\nvoid app_ui_start(void) { app_ui_create(lv_scr_act()); }',
  },
})
assert.match(manifestGenerationWithApprovedDesign[0].content, /Approved LVGL Design Draft/)
assert.match(manifestGenerationWithApprovedDesign[0].content, /Preserve the approved visual layout/)
assert.match(manifestGenerationWithApprovedDesign[1].content, /Approved current main\/app_ui\.c/)

const generatedAgainstManifest = parseGeneratedFilesResponseWithOptions(JSON.stringify({
  files: [
    { path: 'main/main.c', content: '#include "app_ui.h"\nvoid app_main(void) { app_ui_start(); }' },
    { path: 'main/app_ui.h', content: '#pragma once\nvoid app_ui_start(void);' },
    { path: 'main/extra.c', content: 'void extra(void) {}' },
  ],
}), board, {
  manifest: {
    files: [
      { path: 'main/main.c' },
      { path: 'main/app_ui.h' },
      { path: 'main/app_ui.c' },
    ],
  },
})
assert.equal(generatedAgainstManifest.ok, false)
assert.match(generatedAgainstManifest.errors.join(','), /main\/app_ui\.c:manifest-file-missing/)
assert.match(generatedAgainstManifest.errors.join(','), /main\/extra\.c:not-in-manifest/)

const repairMessages = buildBuildRepairMessages({
  board,
  selectedSkills: ['lvgl'],
  manifest: manifest.manifest,
  activeFile: 'main/app_ui.c',
  driverContracts: [
    {
      id: 'display.lvgl-ui',
      label: 'LVGL display UI',
      skillId: 'lvgl',
      requiredInit: ['bsp_i2c_init', 'pca9557_init', 'bsp_lvgl_start'],
      allowedApis: ['bsp_lvgl_start', 'lv_scr_act'],
      forbiddenApis: ['lcd_draw_bitmap'],
      acceptanceChecks: ['LCD shows repaired UI'],
      commonFailures: ['calling LVGL before bsp_lvgl_start'],
    },
  ],
  recentDeviceEvidence: {
    source: 'serial',
    observations: ['boot log reached app_main', 'screen stayed black after LVGL init'],
  },
  buildEvidence: { firstError: { file: 'main/main.c', message: 'missing header' } },
  buildLog: ['main/main.c:12:10: fatal error: helper.h: No such file or directory'],
  projectFiles: { 'main/main.c': '#include "helper.h"\nvoid app_main(void) {}' },
})
assert.match(repairMessages[0].content, /Patch Application Source only/)
assert.match(repairMessages[0].content, /Do not generate CMakeLists\.txt/)
assert.match(repairMessages[1].content, /Program Manifest/)
assert.match(repairMessages[1].content, /hello_display/)
assert.match(repairMessages[1].content, /Active file/)
assert.match(repairMessages[1].content, /main\/app_ui\.c/)
assert.match(repairMessages[1].content, /Driver Contracts/)
assert.match(repairMessages[1].content, /display\.lvgl-ui/)
assert.match(repairMessages[1].content, /bsp_lvgl_start/)
assert.match(repairMessages[1].content, /Recent Device Evidence/)
assert.match(repairMessages[1].content, /screen stayed black/)
assert.match(repairMessages[1].content, /Build Evidence/)
assert.match(repairMessages[1].content, /helper\.h/)

const previewRepairMessages = buildPreviewRepairMessages({
  board,
  selectedSkills: ['lvgl'],
  previewEvidence: { category: 'preview-contract-missing', userFeedback: 'slider 看不清' },
  manifest: manifest.manifest,
  projectFiles: { 'main/main.c': 'void app_main(void) {}' },
})
assert.match(previewRepairMessages[0].content, /LVGL preview repair/)
assert.match(previewRepairMessages[0].content, /app_ui_create/)
assert.match(previewRepairMessages[0].content, /uiManifest/)
assert.match(previewRepairMessages[1].content, /Preview Evidence/)
assert.match(previewRepairMessages[1].content, /slider 看不清/)

const defaultProject = {
  'main/main.c': '// Place your ESP-IDF code here\nvoid app_main(void) {}\n',
}
assert.equal(hasEditableProject(defaultProject, null), false)
assert.equal(isLikelyPreviewRepairRequest({
  text: 'slider 看不清',
  projectFiles: defaultProject,
}), false)

const uiProject = {
  'main/main.c': '#include "app_ui.h"\nvoid app_main(void) { app_ui_start(); }',
  'main/app_ui.h': '#pragma once\nvoid app_ui_start(void);',
  'main/app_ui.c': '#include "app_ui.h"\nvoid app_ui_create(lv_obj_t *root) { lv_slider_create(root); }',
}
assert.equal(hasEditableProject(uiProject, manifest.manifest), true)
assert.equal(isLikelyPreviewRepairRequest({
  text: 'slider 看不清，按钮太小',
  projectFiles: uiProject,
  manifest: manifest.manifest,
  previewContext: { hasSource: true },
}), true)
assert.equal(isLikelyPreviewRepairRequest({
  text: '做一个新的 WiFi 扫描界面',
  projectFiles: uiProject,
  manifest: manifest.manifest,
  previewContext: { hasSource: true },
}), false)

const feedbackEvidence = buildPreviewFeedbackEvidence({
  userFeedback: '按钮没反应',
  projectFiles: uiProject,
  previewContext: { scene: 'lvgl-demo' },
  activeFile: 'main/app_ui.c',
})
assert.equal(feedbackEvidence.feedbackType, 'interaction')
assert.equal(feedbackEvidence.activeFile, 'main/app_ui.c')
assert.deepEqual(feedbackEvidence.editablePaths.sort(), ['main/app_ui.c', 'main/app_ui.h', 'main/main.c'])

const sourceContractRepairMessages = buildSourceContractRepairMessages({
  board,
  selectedSkills: ['lvgl'],
  userRequest: 'show hello',
  manifest: manifest.manifest,
  diagnostics: 'main/main.c must call ESP_ERROR_CHECK(bsp_lvgl_start()) before app_ui rendering.',
  projectFiles: {
    'main/main.c': '#include "app_ui.h"\nvoid app_main(void) { app_ui_start(); }',
    'main/app_ui.h': '#pragma once\nvoid app_ui_start(void);',
    'main/app_ui.c': '#include "app_ui.h"\nvoid app_ui_start(void) {}',
  },
  attempt: 2,
})
assert.match(sourceContractRepairMessages[0].content, /self-repair step/)
assert.match(sourceContractRepairMessages[0].content, /Return full replacement content/)
assert.match(sourceContractRepairMessages[0].content, /ESP_ERROR_CHECK\(bsp_i2c_init\(\)\)/)
assert.match(sourceContractRepairMessages[0].content, /void app_ui_start\(void\)/)
assert.match(sourceContractRepairMessages[1].content, /Source contract diagnostics/)
assert.match(sourceContractRepairMessages[1].content, /bsp_lvgl_start/)

console.log('code generation tests passed')
