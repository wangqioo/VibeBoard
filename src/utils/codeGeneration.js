import { normalizeProjectFiles } from './filePlacement'
import { validateProgramManifest } from '../domain/program/validateManifest'
import { WRITE_SURFACES } from '../domain/program/manifestSchema'
import { DIGITAL_TWIN_MANIFEST_KEY, extractDigitalTwinManifest } from '../domain/digitalTwin/uiManifest'
import {
  DEFAULT_LVGL_DESIGN_PROFILE_ID,
  formatLvglDesignProfilesForPrompt,
  getLvglDesignProfileById,
  normalizeLvglDesignProfileId,
} from '../context/boards/szpi_esp32s3/lvglDesignProfiles'
export { inferSkillsFromRequest } from '../domain/program/intent'

export function extractJsonObject(text) {
  const trimmed = String(text || '').trim()
  const candidates = []

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed)

  for (const match of trimmed.matchAll(/```json\s*([\s\S]*?)\s*```/gi)) {
    candidates.push(match[1].trim())
  }

  for (const match of trimmed.matchAll(/```\w*\s*([\s\S]*?)\s*```/g)) {
    const block = match[1].trim()
    if (block.startsWith('{') && block.endsWith('}')) candidates.push(block)
  }

  for (const candidate of findBalancedJsonCandidates(trimmed)) {
    candidates.push(candidate)
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (isStructuredGenerationJson(parsed)) return candidate
    } catch {}
  }

  return ''
}

function isStructuredGenerationJson(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Array.isArray(value.files) ||
    value.scopeStatus !== undefined ||
    value.schemaVersion !== undefined ||
    value.boardId !== undefined ||
    value.entry !== undefined ||
    value.allowedWriteSurface !== undefined
}

export function parseScopeClarificationResponse(text) {
  const jsonText = extractJsonObject(text)
  if (!jsonText) return { ok: false, status: 'needs_clarification', questions: [], summary: '', errors: ['missing-json'] }

  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, status: 'needs_clarification', questions: [], summary: '', errors: ['invalid-json'] }
  }

  const status = parsed.scopeStatus === 'ready' ? 'ready' : 'needs_clarification'
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map(question => String(question || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : []
  const selectedSkillIds = Array.isArray(parsed.selectedSkillIds)
    ? parsed.selectedSkillIds.map(skillId => String(skillId || '').trim()).filter(Boolean)
    : []
  const designRequired = typeof parsed.designRequired === 'boolean'
    ? parsed.designRequired
    : selectedSkillIds.includes('lvgl')
  const designProfileId = normalizeLvglDesignProfileId(parsed.designProfileId || DEFAULT_LVGL_DESIGN_PROFILE_ID)

  return {
    ok: true,
    status,
    summary: String(parsed.scopeSummary || '').trim(),
    questions,
    selectedSkillIds,
    designRequired,
    designProfileId,
    designIntent: String(parsed.designIntent || '').trim(),
    constraints: Array.isArray(parsed.constraints)
      ? parsed.constraints.map(item => String(item || '').trim()).filter(Boolean)
      : [],
  }
}

export function parseGeneratedFilesResponse(text, board) {
  return parseGeneratedFilesResponseWithOptions(text, board)
}

export function parseGeneratedFilesResponseWithOptions(text, board, options = {}) {
  const jsonText = extractJsonObject(text)
  if (!jsonText) return parseFileBlockResponse(text, board, 'missing-json', options)

  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return parseFileBlockResponse(text, board, 'invalid-json', options)
  }

  if (!Array.isArray(parsed.files)) {
    return { ok: false, files: {}, errors: ['missing-files-array'] }
  }

  const rawFiles = {}
  const errors = []
  for (const file of parsed.files) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      errors.push('invalid-file-entry')
      continue
    }
    rawFiles[file.path] = file.content
  }

  const { accepted, rejected } = normalizeProjectFiles(rawFiles, board)
  for (const item of rejected) errors.push(`${item.path}:${item.reason}`)

  const sourceEntries = Object.entries(accepted)
  if (options.requireCompleteProject !== false) {
    const hasMain = sourceEntries.some(([path, content]) =>
      /^main\/main\.(c|cpp)$/.test(path) && /\bapp_main\s*\(/.test(content)
    )
    if (!hasMain) errors.push('missing-main-app-main')
  }
  if (options.validateManifestFiles !== false) {
    errors.push(...validateGeneratedFileSet(accepted, options.manifest))
  }

  const files = { ...accepted }
  const digitalTwinManifest = extractDigitalTwinManifest(parsed)
  if (digitalTwinManifest) files[DIGITAL_TWIN_MANIFEST_KEY] = digitalTwinManifest

  return { ok: errors.length === 0, files, errors, digitalTwinManifest }
}

export function findBalancedJsonCandidates(text) {
  const candidates = []
  const source = String(text || '')

  for (let start = source.indexOf('{'); start !== -1; start = source.indexOf('{', start + 1)) {
    let depth = 0
    let inString = false
    let escaped = false

    for (let i = start; i < source.length; i += 1) {
      const ch = source[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === '{') depth += 1
      if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          candidates.push(source.slice(start, i + 1).trim())
          break
        }
      }
    }
  }

  return candidates
}

export function extractFileBlocks(text) {
  const source = String(text || '')
  const files = {}
  const fileBlockPattern = /(?:^|\n)\s*(?:FILE|File|file)\s*:\s*([^\n\r]+)\r?\n\s*```[^\n\r]*\r?\n([\s\S]*?)```/g

  for (const match of source.matchAll(fileBlockPattern)) {
    const path = match[1].trim().replace(/^['"`]+|['"`]+$/g, '')
    const content = match[2].replace(/\s+$/g, '')
    if (path && content) files[path] = content
  }

  return files
}

function parseFileBlockResponse(text, board, originalError, options = {}) {
  const rawFiles = extractFileBlocks(text)
  if (Object.keys(rawFiles).length === 0) {
    return { ok: false, files: {}, errors: [originalError] }
  }

  const { accepted, rejected } = normalizeProjectFiles(rawFiles, board)
  const errors = rejected.map(item => `${item.path}:${item.reason}`)
  if (options.requireCompleteProject !== false) {
    const hasMain = Object.entries(accepted).some(([path, content]) =>
      /^main\/main\.(c|cpp)$/.test(path) && /\bapp_main\s*\(/.test(content)
    )
    if (!hasMain) errors.push('missing-main-app-main')
  }
  if (options.validateManifestFiles !== false) {
    errors.push(...validateGeneratedFileSet(accepted, options.manifest))
  }

  return { ok: errors.length === 0, files: accepted, errors }
}

export function validateGeneratedFileSet(files, manifest) {
  if (!manifest?.files?.length) return []

  const generated = new Set(Object.keys(files || {}))
  const expected = new Set((manifest.files || []).map(file => file.path))
  const errors = []

  for (const path of expected) {
    if (!generated.has(path)) errors.push(`${path}:manifest-file-missing`)
  }
  for (const path of generated) {
    if (!expected.has(path)) {
      const basename = path.split('/').pop()
      const matchingHeader = [...expected].some(expectedPath =>
        expectedPath.endsWith(`/${basename}`) || expectedPath === path
      )
      if (!matchingHeader) errors.push(`${path}:not-in-manifest`)
    }
  }

  return errors
}

const SZPI_OFFICIAL_EXAMPLES = [
  {
    id: '01-boot_key',
    request: 'BOOT button / GPIO interrupt',
    skills: ['gpio'],
    init: 'configure GPIO0 pull-up, install gpio ISR service, use a FreeRTOS queue in the handler path',
  },
  {
    id: '02-attitude',
    request: 'QMI8658 attitude / accelerometer',
    skills: ['imu'],
    init: 'bsp_i2c_init(); qmi8658_init(); repeatedly call qmi8658_fetch_angleFromAcc()',
  },
  {
    id: '03-micro_sd',
    request: 'microSD storage',
    skills: ['sdcard'],
    init: 'mount SDMMC 1-bit on CLK=47 CMD=48 D0=21 with esp_vfs_fat_sdmmc_mount()',
  },
  {
    id: '04-audio_es7210',
    request: 'microphone / ES7210 audio input',
    skills: ['audio'],
    init: 'bsp_i2c_init(); pca9557_init(); configure I2S and ES7210, store recordings only when storage is requested',
  },
  {
    id: '05-audio_es8311',
    request: 'speaker / ES8311 audio output',
    skills: ['audio'],
    init: 'bsp_i2c_init(); pca9557_init(); bsp_codec_init(); enable PA only from the audio playing callback',
  },
  {
    id: '06-lcd',
    request: 'LCD display',
    skills: ['lvgl'],
    init: 'bsp_i2c_init(); pca9557_init(); bsp_lcd_init(); draw with lcd_draw_bitmap()/lcd_draw_pictrue()',
  },
  {
    id: '07-lcd_camera',
    request: 'camera preview on LCD',
    skills: ['camera'],
    init: 'bsp_i2c_init(); pca9557_init(); bsp_lcd_init(); delay 500 ms; bsp_camera_init(); start camera-to-LCD loop',
  },
  {
    id: '08-lcd_lvgl',
    request: 'LVGL display/touch UI',
    skills: ['lvgl'],
    init: 'ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); create LVGL objects only after the port starts',
  },
  {
    id: '09-wifi_scan_connect',
    request: 'WiFi scan/connect UI',
    skills: ['wifi', 'lvgl'],
    init: 'nvs_flash_init() with erase fallback; ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); then WiFi app init/connect',
  },
  {
    id: '10-ble_hid_device',
    request: 'BLE HID device UI',
    skills: ['ble', 'lvgl'],
    init: 'nvs_flash_init() before BT stack; ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); app_hid_ctrl()',
  },
  {
    id: '11-mp3_player',
    request: 'touch MP3 player',
    skills: ['audio', 'lvgl'],
    init: 'ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); bsp_spiffs_mount(); bsp_codec_init(); mp3_player_init()',
  },
  {
    id: '12-speech_recognition',
    request: 'speech recognition',
    skills: ['speech', 'audio', 'lvgl'],
    init: 'ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); bsp_spiffs_mount(); bsp_codec_init(); mp3_player_init(); app_sr_init()',
  },
]

function buildOfficialExampleGuidance(board) {
  if (board?.id !== 'szpi_esp32s3') return ''

  const lines = SZPI_OFFICIAL_EXAMPLES.map(example =>
    `- ${example.id}: ${example.request}; skills=${example.skills.join('+')}; init=${example.init}`
  ).join('\n')

  return `## Official SZPI ESP32-S3 Example Rules
Use these 12 official examples as the board-specific source of truth when planning skills and init order:
${lines}

Derived rules:
- Display/touch/LVGL UI needs lvgl.
- Audio playback/recording needs audio; touch audio player needs audio + lvgl.
- WiFi and BLE official flows use NVS first and an LVGL control screen, so use wifi + lvgl or ble + lvgl for UI requests.
- Speech recognition needs speech + audio + lvgl.
- Camera preview uses camera and the LCD init path; do not force LVGL unless the user asks for touch UI/widgets.
- Storage may mean SD card (sdcard) or SPIFFS owned by audio/speech; choose based on the requested medium.`
}

function selectedDriverContracts(board, skillIds = [], manifestContracts = []) {
  const selectedSkills = new Set(skillIds || [])
  const requestedContracts = new Set(manifestContracts || [])
  return (board?.driverContracts || []).filter(contract =>
    requestedContracts.has(contract.id) || selectedSkills.has(contract.skillId)
  )
}

function buildDriverContractGuidance(board, skillIds = [], manifestContracts = []) {
  const contracts = selectedDriverContracts(board, skillIds, manifestContracts)
  if (!contracts.length) return ''

  const lines = contracts.map(contract => [
    `- ${contract.id} (${contract.label}, skill=${contract.skillId})`,
    `  requiredInit: ${(contract.requiredInit || []).join(' -> ') || 'none'}`,
    `  allowedApis: ${(contract.allowedApis || []).join(', ') || 'none'}`,
    `  forbiddenApis: ${(contract.forbiddenApis || []).join(', ') || 'none'}`,
    `  acceptanceChecks: ${(contract.acceptanceChecks || []).join('; ') || 'none'}`,
    `  commonFailures: ${(contract.commonFailures || []).join('; ') || 'none'}`,
  ].join('\n')).join('\n')

  return `## Driver Contracts
Use these structured contracts as the hardware API boundary. Generate application orchestration code that follows requiredInit, uses only relevant allowed APIs, and avoids forbidden APIs.
${lines}`
}

export function parseProgramManifestResponse(text, board) {
  const jsonText = extractJsonObject(text)
  if (!jsonText) return { ok: false, manifest: null, errors: ['missing-json'] }

  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { ok: false, manifest: null, errors: ['invalid-json'] }
  }

  const result = validateProgramManifest(parsed, { board })
  return {
    ok: result.ok,
    manifest: result.manifest,
    errors: result.errors.map(error => error.category || error.message),
    details: result.errors,
  }
}

function boardCapabilitySummary(board) {
  const skills = (board?.skills || [])
    .map(skill => `${skill.id}: ${skill.label}`)
    .join('\n') || 'none'
  const contracts = (board?.driverContracts || [])
    .map(contract => `${contract.id}: ${contract.label}; skill=${contract.skillId}; init=${(contract.requiredInit || []).join(' -> ') || 'none'}; allowed=${(contract.allowedApis || []).join(', ') || 'none'}; forbidden=${(contract.forbiddenApis || []).join(', ') || 'none'}`)
    .join('\n') || 'none'

  return `## Board Capability Boundary
Board: ${board?.name || board?.id || 'unknown'}
Hardware described by board prompt only:
- 320x240 ST7789 LCD with FT6336 touch through BSP/LVGL
- ES8311 speaker playback, ES7210 microphone input through I2S/audio BSP
- GC0308 DVP camera
- QMI8658 IMU
- microSD over SDMMC
- WiFi STA and BLE on ESP32-S3
- BOOT button GPIO0 and safe general GPIO only when pins are not reserved
- Platform-owned USB serial + WiFi WebSocket log transport

Available skill IDs:
${skills}

Driver/API contracts:
${contracts}

Official example boundary:
${SZPI_OFFICIAL_EXAMPLES.map(example => `- ${example.id}: ${example.request}; skills=${example.skills.join('+')}`).join('\n')}`
}

export function buildScopeClarificationMessages({ board, selectedSkills = [], userRequest, existingFiles = {} }) {
  const existingFileList = Object.keys(existingFiles).filter(path => !path.startsWith('__')).join(', ') || 'none'
  const selectedSkillList = selectedSkills.join(', ') || 'none'

  return [
    {
      role: 'system',
      content: `For this VibeBoard scope step, return ONLY the JSON object requested below. No markdown, no prose.

You are NOT brainstorming arbitrary product ideas. You are narrowing a firmware request to what this exact board, its BSP, selected skills, driver contracts, and official examples can implement.

${boardCapabilitySummary(board)}

Allowed output schema:
{
  "scopeStatus": "ready",
  "scopeSummary": "one sentence describing the bounded firmware",
  "selectedSkillIds": ["lvgl"],
  "designRequired": true,
  "designProfileId": "compact_control_panel",
  "designIntent": "first LVGL screen the user must approve before firmware generation",
  "constraints": ["uses ST7789 LCD via bsp_lvgl_start", "no unsupported cloud dependency"],
  "questions": []
}

Or, if the request is too ambiguous to implement safely:
{
  "scopeStatus": "needs_clarification",
  "scopeSummary": "what is known from the request",
  "selectedSkillIds": ["lvgl"],
  "designRequired": true,
  "designProfileId": "compact_control_panel",
  "designIntent": "first LVGL screen cannot be drafted until the user chooses the target flow",
  "constraints": ["only use supported board peripherals"],
  "questions": ["Which board-supported output should be used: LCD display, speaker playback, WiFi log, or BLE HID?"]
}

LVGL design profiles, if the bounded firmware uses LVGL or touch/display UI:
${formatLvglDesignProfilesForPrompt()}

Rules:
- Ask clarification only when it changes hardware capability, driver choice, data path, or first-version acceptance checks.
- Ask 1 to 3 short questions maximum.
- Every question MUST offer choices that are implementable on this board with available skills/BSP APIs.
- Do NOT ask about unsupported peripherals or vague future product ideas.
- Do NOT propose GPS, cellular, external cloud camera, external sensors, HDMI, battery charging, motor control, or other hardware unless the current board prompt/skills explicitly support it.
- If the request can be implemented as a small first version using existing board capabilities, return scopeStatus "ready".
- Prefer a minimal first version over a large feature set.
- selectedSkillIds must use only available skill IDs.
- constraints should name the relevant board capability or BSP boundary.
- Set designRequired=true when selectedSkillIds includes lvgl or the user asks for a touch/screen/LVGL UI that can be previewed before firmware compilation.
- Set designRequired=false for raw camera-to-LCD preview without LVGL widgets, or for non-display firmware.
- designProfileId must be one of the LVGL design profile IDs above when designRequired=true. Pick the closest fit; do not invent a profile.
- designIntent should name the first screen and the visible state the user should approve.
- Return ONLY valid JSON.`,
    },
    {
      role: 'user',
      content: `User request: ${userRequest}

Currently selected skills: ${selectedSkillList}
Existing editable files: ${existingFileList}

Decide whether to continue to code generation or ask board-bounded clarification questions.`,
    },
  ]
}

export function buildProgramManifestMessages({ board, selectedSkills = [], userRequest, existingFiles = {} }) {
  const existingFileList = Object.keys(existingFiles).filter(path => !path.startsWith('__')).join(', ') || 'none'
  const selectedSkillList = selectedSkills.join(', ') || 'none'
  const validSkills = board.skills.map(skill => `${skill.id}: ${skill.label}`).join('\n')
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const driverContractGuidance = buildDriverContractGuidance(board, selectedSkills)
  const validDriverContracts = (board.driverContracts || [])
    .map(contract => `${contract.id}: ${contract.label} (skill=${contract.skillId})`)
    .join('\n') || 'none'

  return [
    {
      role: 'system',
      content: `For this VibeBoard planning step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(selectedSkills)}

${officialExampleGuidance}

${driverContractGuidance}

You are planning a VibeBoard ESP-IDF firmware Program Manifest. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "schemaVersion": 1,
  "boardId": "${board.id}",
  "skillIds": ["lvgl"],
  "programName": "short_snake_case_name",
  "entry": "main/main.c",
  "files": [
    { "path": "main/main.c", "role": "entry" },
    { "path": "main/app_ui.h", "role": "header" },
    { "path": "main/app_ui.c", "role": "module" }
  ],
  "requires": {
    "display": true,
    "network": false,
    "audio": false,
    "camera": false,
    "storage": false
  },
  "driverContracts": ["display.lvgl-ui"],
  "runtimeServices": ["freertos-task", "serial-log"],
  "acceptanceChecks": ["LCD shows the main screen", "serial log contains READY"],
  "preview": {
    "viewport": { "width": 320, "height": 240 },
    "scene": "first_screen",
    "peripherals": [
      { "id": "display", "state": "active" }
    ]
  },
  "allowedWriteSurface": "${WRITE_SURFACES.APPLICATION_SOURCE_ONLY}"
}

Rules:
- Plan Application Source only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- Follow the official SZPI examples: keep main/main.c or main/main.cpp as a thin app_main entrypoint, and put real features in app_*.c/app_*.h modules.
- Preferred module names: app_ui.c/h for LVGL UI, app_wifi.c/h for WiFi, app_audio.c/h for audio, app_camera.c/h for camera, app_sr.c/h for speech recognition.
- If skillIds includes lvgl or requires.display is true, include main/app_ui.c and main/app_ui.h in files. app_ui.c must define void app_ui_create(lv_obj_t *root) and void app_ui_start(void); app_ui.h must declare both.
- app_ui.* must be pure LVGL previewable code: include lvgl.h only, create widgets under the supplied root object, and do not call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs.
- main/main.c should do board init and then call app_ui_start() after bsp_lvgl_start().
- preview.viewport must be 320x240 for the SZPI LCD unless the user explicitly asks for another target.
- preview.peripherals should list hardware status chips implied by the request and selected skills, such as display, microphone, speaker, wifi, ble, camera, sdcard, imu, gpio.
- For vision/C++ features, use main/main.cpp plus app_camera.cpp/app_camera.hpp or who_*.cpp/who_*.hpp modules.
- For assets, use main/assets/*.c and main/assets/*.h. For BLE HID/protocol helpers, use main/bt/*.c and main/bt/*.h.
- Do not plan CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, BSP files, or .ino files.
- Include exactly one file with role "entry".
- The entry must be present in files.
- Use only selected skills unless the request clearly requires another valid skill. If adding a skill, include it in skillIds.
- skillIds must cover every true requires.* field and every API family used by the planned files.
- driverContracts must use only valid IDs and each contract's skill must be present in skillIds.
- runtimeServices may only use: freertos-task, event-loop, nvs, wifi, ble, lvgl, ota, serial-log.
- acceptanceChecks should describe observable build or device behavior, not implementation wishes.
- Valid skill IDs:
${validSkills}
- Valid driver contract IDs:
${validDriverContracts}`,
    },
    {
      role: 'user',
      content: `User request: ${userRequest}

Currently selected skills: ${selectedSkillList}
Existing editable files: ${existingFileList}

Create the Program Manifest now.`,
    },
  ]
}

export function buildLvglDesignDraftMessages({
  board,
  selectedSkills = [],
  userRequest,
  scope = {},
  existingFiles = {},
}) {
  const existingFileList = Object.keys(existingFiles).filter(path => !path.startsWith('__')).join(', ') || 'none'
  const selectedSkillList = selectedSkills.join(', ') || 'none'
  const designProfileId = normalizeLvglDesignProfileId(scope.designProfileId || DEFAULT_LVGL_DESIGN_PROFILE_ID)
  const designProfile = getLvglDesignProfileById(designProfileId)

  return [
    {
      role: 'system',
      content: `For this VibeBoard LVGL design draft step, return ONLY the JSON object requested below. No markdown, no prose, no FILE labels.

You are drafting the first 320x240 LVGL screen for the 立创实战派ESP32-S3 board before firmware generation. The user must approve this visible design before full ESP-IDF code is generated.

Board display facts:
- 320x240 ST7789 LCD with FT6336 touch.
- LVGL preview runs directly from main/app_ui.c and main/app_ui.h without compiling or flashing firmware.
- The draft must be portable LVGL-only source. It must not call board drivers, ESP-IDF, FreeRTOS, WiFi, audio, camera, storage, GPIO, I2C, I2S, or network APIs.

Selected LVGL design profile:
- id: ${designProfile?.id || designProfileId}
- label: ${designProfile?.label || designProfileId}
- bestFor: ${(designProfile?.bestFor || []).join(', ') || 'general LVGL screen'}
- layout: ${designProfile?.layout || 'compact 320x240 app screen'}
- widgets: ${(designProfile?.widgets || []).join(', ') || 'label, button, status'}
- constraints: ${(designProfile?.constraints || []).join('; ') || 'fit in 320x240'}

Available design profiles:
${formatLvglDesignProfilesForPrompt()}

Allowed output schema:
{
  "files": [
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ],
  "uiManifest": {
    "title": "short preview title",
    "screen": { "background": "#f6f8fa" },
    "widgets": [
      { "id": "title", "type": "label", "text": "Hello", "x": 16, "y": 12, "w": 200, "h": 28 },
      { "id": "ok", "type": "button", "text": "OK", "x": 220, "y": 190, "w": 80, "h": 32, "action": "ok_clicked" }
    ]
  }
}

Rules:
- Generate exactly main/app_ui.h and main/app_ui.c. Do not generate main/main.c in this draft step.
- main/app_ui.h must include lvgl.h and declare void app_ui_create(lv_obj_t *root); and void app_ui_start(void);
- main/app_ui.c must include "app_ui.h" and define both functions.
- app_ui_create(lv_obj_t *root) must create all widgets under root.
- app_ui_start(void) may call app_ui_create(lv_scr_act()) only.
- Use explicit root/screen background in LVGL and set opacity to LV_OPA_COVER.
- The uiManifest screen.background must match the actual LVGL root background color.
- Use stable fixed dimensions for controls so preview and device layout match.
- Use LVGL built-in widgets only. No custom fonts except lv_font_montserrat_20 unless the request clearly needs smaller/larger built-in Montserrat fonts.
- Do not write explanatory labels about how the UI works. Show the actual app state and controls.
- Do not use nested cards or landing-page composition. This is a small operational device screen, not a marketing page.
- Keep all visible text short enough to fit 320x240.
- Return ONLY valid JSON.`,
    },
    {
      role: 'user',
      content: `User request: ${userRequest}

Scope summary: ${scope.summary || ''}
Scope constraints:
${(scope.constraints || []).map(item => `- ${item}`).join('\n') || '- none'}
Design intent: ${scope.designIntent || 'Draft the first LVGL screen for approval.'}

Selected skills: ${selectedSkillList}
Existing editable files: ${existingFileList}

Generate the LVGL design draft now.`,
    },
  ]
}

export function buildCodeGenerationMessages({ board, selectedSkills = [], userRequest, existingFiles = {} }) {
  const existingFileList = Object.keys(existingFiles).filter(path => !path.startsWith('__')).join(', ') || 'none'
  const selectedSkillList = selectedSkills.join(', ') || 'none'
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const driverContractGuidance = buildDriverContractGuidance(board, selectedSkills)

  return [
    {
      role: 'system',
      content: `For this VibeBoard file-generation step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(selectedSkills)}

${officialExampleGuidance}

${driverContractGuidance}

You are generating project files for VibeBoard. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "files": [
    { "path": "main/main.c", "content": "..." },
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ],
  "uiManifest": {
    "title": "short preview title",
    "screen": { "background": "#f6f8fa" },
    "widgets": [
      { "id": "title", "type": "label", "text": "Hello", "x": 16, "y": 12, "w": 200, "h": 28 },
      { "id": "ok", "type": "button", "text": "OK", "x": 220, "y": 190, "w": 80, "h": 32, "action": "ok_clicked" }
    ]
  }
}

Rules:
- Generate application source files only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- Follow the official SZPI examples: main/main.c or main/main.cpp should be a thin entrypoint; put feature logic in app_*.c/app_*.h modules.
- Preferred module names: app_ui.c/h, app_wifi.c/h, app_audio.c/h, app_camera.c/h, app_sr.c/h. Use who_*.cpp/hpp for AI vision helpers.
- For LVGL/display projects, generate main/app_ui.c and main/app_ui.h. app_ui.c must define void app_ui_create(lv_obj_t *root), and app_ui.h must declare it.
- app_ui.* must be portable LVGL-only preview code: include lvgl.h only, create widgets under root, and never call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs.
- main/main.c must perform board init and call app_ui_create(lv_scr_act()) after bsp_lvgl_start().
- Use main/assets/* for generated C assets and main/bt/* for BLE helper modules when useful.
- Do not generate CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, or BSP files.
- Include a complete app_main in main/main.c or main/main.cpp.
- Put helper functions in helper files when useful; do not force everything into main.c.
- If main includes a local header, include that header file in files.
- Use #include "esp32_s3_szp.h" for board APIs.`,
    },
    {
      role: 'user',
      content: `User request: ${userRequest}

Selected skills: ${selectedSkillList}
Existing editable files: ${existingFileList}

Generate the files now.`,
    },
  ]
}

export function buildManifestCodeGenerationMessages({ board, manifest, userRequest, existingFiles = {} }) {
  const existingFileList = Object.keys(existingFiles).filter(path => !path.startsWith('__')).join(', ') || 'none'
  const approvedLvglDesign = existingFiles?.['main/app_ui.c'] && existingFiles?.['main/app_ui.h']
    ? `## Approved LVGL Design Draft
The user has already approved the current LVGL design files:
- main/app_ui.c
- main/app_ui.h

Preserve the approved visual layout, object hierarchy, text, colors, and dimensions in main/app_ui.c and main/app_ui.h unless the user explicitly asked to change the design in this request.
Generate the surrounding firmware modules and entrypoint around that approved app_ui contract.`
    : ''
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const driverContractGuidance = buildDriverContractGuidance(
    board,
    manifest.skillIds || [],
    manifest.driverContracts || [],
  )
  return [
    {
      role: 'system',
      content: `For this VibeBoard file-generation step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(manifest.skillIds || [])}

${officialExampleGuidance}

${driverContractGuidance}

${approvedLvglDesign}

You are generating project files for VibeBoard from a validated Program Manifest. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "files": [
    { "path": "main/main.c", "content": "..." },
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ],
  "uiManifest": {
    "title": "short preview title",
    "screen": { "background": "#f6f8fa" },
    "widgets": [
      { "id": "title", "type": "label", "text": "Hello", "x": 16, "y": 12, "w": 200, "h": 28 },
      { "id": "ok", "type": "button", "text": "OK", "x": 220, "y": 190, "w": 80, "h": 32, "action": "ok_clicked" }
    ]
  }
}

Rules:
- Generate exactly the files listed in the manifest unless a required matching local header is missing.
- Generate Application Source only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- Follow the official SZPI examples: keep app_main thin and move feature logic into app_*.c/app_*.h modules.
- For LVGL/display UI, main/app_ui.c must define void app_ui_create(lv_obj_t *root) and void app_ui_start(void); main/app_ui.h must declare both so VibeBoard can reuse the same UI source in both preview runners.
- app_ui.* must be portable LVGL-only preview code: include lvgl.h only, create widgets under root, and never call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs.
- main/main.c must perform board init and call app_ui_start() after bsp_lvgl_start().
- Use main/assets/* for generated C assets and main/bt/* for BLE helper modules when listed in the manifest.
- Do not generate CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, or BSP files.
- Include a complete app_main in the manifest entry file.
- If a file includes a local quoted header, generate that header too.
- Use #include "esp32_s3_szp.h" for board APIs.
- Do not use APIs from a skill family that is absent from manifest.skillIds.
- Keep system configuration owned by VibeBoard.
- Also include uiManifest for immediate semantic browser preview when the program uses LVGL, LCD, buttons, sliders, lists, dropdowns, textareas, WiFi status, audio controls, BLE status, camera preview, IMU status, or speech status.
- uiManifest is not firmware source and is not proof of LVGL correctness; it is a 320x240 screen description used before the real LVGL simulator runs. Use only these widget types: label, button, slider, dropdown, textarea, list, image, status.
- Match uiManifest to the generated LVGL/app behavior closely enough that users can preview layout and state flow before compiling.`,
    },
    {
      role: 'user',
      content: `User request: ${userRequest}

Validated Program Manifest:
${JSON.stringify(manifest, null, 2)}

Existing editable files: ${existingFileList}
${approvedLvglDesign ? `\nApproved current main/app_ui.h:\n${existingFiles['main/app_ui.h']}\n\nApproved current main/app_ui.c:\n${existingFiles['main/app_ui.c']}` : ''}

Generate the files now.`,
    },
  ]
}

export function buildSourceContractRepairMessages({
  board,
  selectedSkills = [],
  userRequest,
  manifest,
  projectFiles = {},
  diagnostics = '',
  attempt = 1,
}) {
  const editableFiles = Object.fromEntries(
    Object.entries(projectFiles || {}).filter(([path]) => !path.startsWith('__'))
  )
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const driverContractGuidance = buildDriverContractGuidance(
    board,
    selectedSkills,
    manifest?.driverContracts || [],
  )
  const manifestFiles = (manifest?.files || []).map(file => file.path).join(', ') || 'none'

  return [
    {
      role: 'system',
      content: `For this VibeBoard self-repair step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(selectedSkills)}

${officialExampleGuidance}

${driverContractGuidance}

You are repairing AI-generated VibeBoard source before it is inserted into the editor, previewed, compiled, or flashed. The previous output failed VibeBoard's local source contract checks. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "files": [
    { "path": "main/main.c", "content": "..." },
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ],
  "uiManifest": {
    "title": "short preview title",
    "screen": { "background": "#f6f8fa" },
    "widgets": []
  }
}

Rules:
- This is repair attempt ${attempt}. Fix every diagnostic below directly.
- Return full replacement content for the complete application file set, not a partial patch.
- Generate exactly these manifest files unless a required matching local header is missing: ${manifestFiles}.
- Generate Application Source only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- Do not generate CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, BSP files, or .ino files.
- Preserve the user's requested behavior and the Program Manifest intent.
- Include a complete app_main in the manifest entry file.
- If a file includes a local quoted header, generate that header too.
- Use #include "esp32_s3_szp.h" for board APIs.
- Do not use APIs from a skill family that is absent from selectedSkills.
- Keep system configuration, WiFi serial debug, partitions, CMake, and BSP owned by VibeBoard.
- For LVGL/display UI, main/main.c must initialize the real SZPI screen in this order: ESP_ERROR_CHECK(bsp_i2c_init()); ESP_ERROR_CHECK(pca9557_init()); ESP_ERROR_CHECK(bsp_lvgl_start()); then app_ui_start().
- main/main.c must include "esp32_s3_szp.h", "esp_err.h", and "app_ui.h" when using LVGL/display.
- main/app_ui.c must define void app_ui_create(lv_obj_t *root) and void app_ui_start(void).
- main/app_ui.h must declare void app_ui_create(lv_obj_t *root) and void app_ui_start(void).
- app_ui.* must be portable LVGL-only preview code: include lvgl.h/app_ui.h only, create widgets under root, and never call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, I2C, I2S, task, or network APIs.
- Also include uiManifest for immediate semantic browser preview when the program has a visible screen.`,
    },
    {
      role: 'user',
      content: `User request:
${userRequest}

Selected skills:
${selectedSkills.join(', ') || 'none'}

Program Manifest:
${JSON.stringify(manifest || {}, null, 2)}

Source contract diagnostics:
${diagnostics || 'unknown validation failure'}

Current generated editable files:
${JSON.stringify(editableFiles, null, 2)}

Regenerate the complete corrected application source now.`,
    },
  ]
}

function formatDriverContractSection(driverContracts = []) {
  if (!Array.isArray(driverContracts) || driverContracts.length === 0) return ''

  const lines = driverContracts.map(contract => {
    if (typeof contract === 'string') return `- ${contract}`
    return [
      `- ${contract.id || 'unknown'}${contract.label ? ` (${contract.label})` : ''}${contract.skillId ? `, skill=${contract.skillId}` : ''}`,
      `  requiredInit: ${(contract.requiredInit || []).join(' -> ') || 'none'}`,
      `  allowedApis: ${(contract.allowedApis || []).join(', ') || 'none'}`,
      `  forbiddenApis: ${(contract.forbiddenApis || []).join(', ') || 'none'}`,
      `  acceptanceChecks: ${(contract.acceptanceChecks || []).join('; ') || 'none'}`,
      `  commonFailures: ${(contract.commonFailures || []).join('; ') || 'none'}`,
    ].join('\n')
  }).join('\n')

  return `Driver Contracts:
${lines}`
}

export function buildBuildRepairMessages({
  board,
  selectedSkills = [],
  buildEvidence,
  buildLog = [],
  errorLog = '',
  projectFiles = {},
  manifest = null,
  activeFile = '',
  driverContracts = [],
  recentDeviceEvidence = null,
}) {
  const editableFiles = Object.fromEntries(
    Object.entries(projectFiles || {}).filter(([path]) => !path.startsWith('__'))
  )
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const repairContext = buildEvidence?.repairContext || null
  const manifestSection = manifest
    ? `Program Manifest:
${JSON.stringify(manifest, null, 2)}`
    : ''
  const activeFileSection = activeFile
    ? `Active file:
${activeFile}`
    : ''
  const driverContractsSection = formatDriverContractSection(driverContracts)
  const recentDeviceEvidenceSection = recentDeviceEvidence
    ? `Recent Device Evidence:
${JSON.stringify(recentDeviceEvidence, null, 2)}`
    : ''
  return [
    {
      role: 'system',
      content: `For this VibeBoard repair step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(selectedSkills)}

${officialExampleGuidance}

You are repairing a VibeBoard ESP-IDF build failure. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "files": [
    { "path": "main/main.c", "content": "..." },
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ]
}

Rules:
- Patch Application Source only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- Preserve the official-example structure: keep app_main thin and repair app_*.c/app_*.h modules when possible.
- For LVGL/display repairs, preserve or create main/app_ui.c and main/app_ui.h. app_ui.c must define void app_ui_create(lv_obj_t *root), and app_ui.h must declare it.
- app_ui.* must be portable LVGL-only preview code: include lvgl.h only and do not call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs.
- main/main.c should own hardware init and call app_ui_create(lv_scr_act()) after bsp_lvgl_start().
- Do not generate CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, or BSP files.
- Preserve the user's intended behavior; fix the compile error with the smallest complete source update.
- Follow the Repair Context first. If it identifies a missing header, missing symbol, implicit declaration, CMake layout issue, or LVGL thread-safety issue, repair that root cause directly before making broader changes.
- Include full replacement content for every changed file.
- If main includes a missing local header, either generate that header or remove the include.
- Include a complete app_main in main/main.c or main/main.cpp.
- Use #include "esp32_s3_szp.h" for board APIs.`,
    },
    {
      role: 'user',
      content: `${manifestSection}${manifestSection ? '\n\n' : ''}${activeFileSection}${activeFileSection ? '\n\n' : ''}${driverContractsSection}${driverContractsSection ? '\n\n' : ''}${recentDeviceEvidenceSection}${recentDeviceEvidenceSection ? '\n\n' : ''}Build Evidence:
${JSON.stringify(buildEvidence || {}, null, 2)}

Repair Context:
${JSON.stringify(repairContext || {}, null, 2)}

Build log tail:
${(buildLog || []).slice(-80).join('\n')}

Error summary:
${errorLog || ''}

Current editable files:
${JSON.stringify(editableFiles, null, 2)}

Repair the source files now.`,
    },
  ]
}

export function buildPreviewRepairMessages({ board, selectedSkills = [], previewEvidence, manifest, projectFiles = {}, userFeedback = '' }) {
  const editableFiles = Object.fromEntries(
    Object.entries(projectFiles || {}).filter(([path]) => !path.startsWith('__'))
  )
  const officialExampleGuidance = buildOfficialExampleGuidance(board)
  const feedback = userFeedback || previewEvidence?.userFeedback || previewEvidence?.summary || ''
  return [
    {
      role: 'system',
      content: `For this VibeBoard LVGL preview repair step, return ONLY the JSON object requested below. Do not use markdown, FILE labels, code fences, explanations, or the board prompt's normal code-block output format.

${board.buildSystemPrompt(selectedSkills)}

${officialExampleGuidance}

You are repairing a VibeBoard preview failure or visual mismatch before firmware is compiled or flashed. Return ONLY valid JSON. No markdown, no prose.

Allowed output schema:
{
  "files": [
    { "path": "main/main.c", "content": "..." },
    { "path": "main/app_ui.h", "content": "..." },
    { "path": "main/app_ui.c", "content": "..." }
  ],
  "uiManifest": {
    "title": "short preview title",
    "screen": { "background": "#f6f8fa" },
    "widgets": [
      { "id": "title", "type": "label", "text": "Hello", "x": 16, "y": 12, "w": 200, "h": 28 },
      { "id": "ok", "type": "button", "text": "OK", "x": 220, "y": 190, "w": 80, "h": 32, "action": "ok_clicked" }
    ]
  }
}

Rules:
- Patch Application Source only: main/main.c, main/main.cpp, main/**/*.c, main/**/*.cpp, main/**/*.h, main/**/*.hpp.
- For LVGL/display projects, main/app_ui.c must define void app_ui_create(lv_obj_t *root), and main/app_ui.h must declare it.
- app_ui.* must be portable LVGL-only preview code: include lvgl.h only, create widgets under root, and never call ESP-IDF, BSP, FreeRTOS, WiFi, audio, camera, NVS, GPIO, or task APIs.
- main/main.c should own hardware init and call app_ui_create(lv_scr_act()) after bsp_lvgl_start().
- Preserve the user's intended behavior and fix the reported preview issue with the smallest complete source update.
- Treat the current files as the project to patch. Do not restart from a new unrelated program.
- Infer the affected file from the current source. UI layout, widget text, sizing, colors, and interactions usually belong in main/app_ui.c and the matching uiManifest.
- Include full replacement content for every changed file.
- If the visual layout changes, include an updated uiManifest that matches the changed LVGL/app behavior for immediate semantic browser preview.
- Do not generate CMakeLists.txt, sdkconfig.defaults, idf_component.yml, partitions.csv, components/*, or BSP files.`,
    },
    {
      role: 'user',
      content: `User preview feedback:
${feedback || '(no separate user feedback)'}

Preview Evidence:
${JSON.stringify(previewEvidence || {}, null, 2)}

Program Manifest:
${JSON.stringify(manifest || {}, null, 2)}

Current editable files:
${JSON.stringify(editableFiles, null, 2)}

Repair the previewable source files now.`,
    },
  ]
}
