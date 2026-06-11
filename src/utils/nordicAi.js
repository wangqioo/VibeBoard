import { completeChat } from './aiApi.js'

const REQUIRED_FILES = ['CMakeLists.txt', 'prj.conf', 'sysbuild.conf', 'src/main.c', 'README.md']
const REQUIRED_DFU_CONFIG = [
  'CONFIG_BOOTLOADER_MCUBOOT=y',
  'CONFIG_MCUMGR=y',
  'CONFIG_MCUMGR_TRANSPORT_UART=y',
  'CONFIG_MCUMGR_GRP_IMG=y',
  'CONFIG_MCUMGR_GRP_OS=y',
  'CONFIG_IMG_MANAGER=y',
  'CONFIG_MCUBOOT_IMG_MANAGER=y',
  'CONFIG_FLASH=y',
  'CONFIG_FLASH_MAP=y',
  'CONFIG_STREAM_FLASH=y',
  'CONFIG_BASE64=y',
  'CONFIG_CRC=y',
  'CONFIG_ZCBOR=y',
]

export function createNordicAiMessages({ userPrompt, board }) {
  const boardName = board?.name || 'Seeed XIAO nRF52840'
  const boardTarget = board?.boardTarget || 'xiao_ble'
  return [
    {
      role: 'system',
      content: `You generate complete, buildable nRF Connect SDK / Zephyr projects for VibeBoard.
Return only JSON with this shape: {"files":{"CMakeLists.txt":"...","prj.conf":"...","sysbuild.conf":"...","src/main.c":"...","README.md":"..."}}.
Target board: ${boardName}
west board target: ${boardTarget}

Rules:
- Generate exactly these editable files: ${REQUIRED_FILES.join(', ')}.
- Do not emit markdown outside JSON.
- Use Zephyr APIs, not Arduino or deprecated nRF5 SDK APIs.
- Keep MCUboot + MCUmgr serial DFU enabled so browser Web Serial DFU can upload zephyr.signed.bin after first provisioning.
- prj.conf must include: ${REQUIRED_DFU_CONFIG.join(', ')}.
- sysbuild.conf must include SB_CONFIG_BOOTLOADER_MCUBOOT=y.
- src/main.c must call boot_write_img_confirmed() during startup.
- Avoid board-specific aliases unless you guard them with Zephyr devicetree-safe fallback macros.`,
    },
    {
      role: 'user',
      content: `User request:\n${userPrompt}`,
    },
  ]
}

export async function generateNordicProjectWithAi({
  settings,
  userPrompt,
  board,
  completeChatImpl = completeChat,
}) {
  if (!settings?.baseUrl || !settings?.apiKey || !settings?.model) {
    throw new Error('请先配置 AI API。')
  }
  const messages = createNordicAiMessages({ userPrompt, board })
  const rawText = await completeChatImpl({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    messages,
  })
  return {
    rawText,
    ...extractNordicFilesFromAiText(rawText),
  }
}

export function extractNordicFilesFromAiText(rawText) {
  const text = String(rawText || '').trim()
  const jsonText = text.startsWith('```')
    ? text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    : text
  let parsed
  try {
    parsed = JSON.parse(jsonText)
  } catch (error) {
    throw new Error(`AI 返回的 Nordic 代码不是合法 JSON：${error.message}`)
  }
  return validateNordicGeneratedFiles(parsed.files || parsed)
}

export function validateNordicGeneratedFiles(inputFiles) {
  const files = {}
  if (!inputFiles || typeof inputFiles !== 'object' || Array.isArray(inputFiles)) {
    throw new Error('AI 返回缺少 files 对象')
  }
  for (const [path, content] of Object.entries(inputFiles)) {
    const safePath = sanitizeNordicAiPath(path)
    files[safePath] = String(content ?? '')
  }
  for (const required of REQUIRED_FILES) {
    if (!files[required]?.trim()) throw new Error(`AI 返回缺少必需文件：${required}`)
  }
  for (const symbol of REQUIRED_DFU_CONFIG) {
    if (!files['prj.conf'].includes(symbol)) {
      throw new Error(`AI 返回的 prj.conf missing required DFU config: ${symbol}`)
    }
  }
  if (!files['sysbuild.conf'].includes('SB_CONFIG_BOOTLOADER_MCUBOOT=y')) {
    throw new Error('AI 返回的 sysbuild.conf 缺少 SB_CONFIG_BOOTLOADER_MCUBOOT=y')
  }
  if (!files['src/main.c'].includes('boot_write_img_confirmed')) {
    throw new Error('AI 返回的 src/main.c 必须调用 boot_write_img_confirmed()')
  }
  return { files }
}

function sanitizeNordicAiPath(path) {
  const value = String(path || '').replace(/\\/g, '/')
  const allowed = new Set(REQUIRED_FILES)
  if (!allowed.has(value)) throw new Error(`Unsafe Nordic AI file path: ${path}`)
  return value
}
