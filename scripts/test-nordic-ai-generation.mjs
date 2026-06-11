import assert from 'node:assert/strict'
import {
  createNordicAiMessages,
  extractNordicFilesFromAiText,
  generateNordicProjectWithAi,
  validateNordicGeneratedFiles,
} from '../src/utils/nordicAi.js'

const files = {
  'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20.0)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\nproject(ai_xiao)\ntarget_sources(app PRIVATE src/main.c)\n',
  'prj.conf': [
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
    'CONFIG_BUILD_OUTPUT_UF2=y',
    'CONFIG_GPIO=y',
  ].join('\n'),
  'sysbuild.conf': 'SB_CONFIG_BOOTLOADER_MCUBOOT=y\n',
  'sysbuild/mcuboot/prj.conf': [
    'CONFIG_FLASH=y',
    'CONFIG_BOOT_MAX_IMG_SECTORS=256',
    'CONFIG_CONSOLE=n',
    'CONFIG_SERIAL=n',
  ].join('\n'),
  'boards/xiao_ble.overlay': 'slot0_partition: partition@c000 {}\nslot1_partition: partition@82000 {}\nboot_partition: partition@0 {}\nstorage_partition: partition@f8000 {}\n',
  'sysbuild/mcuboot/boards/xiao_ble.overlay': 'slot0_partition: partition@c000 {}\nslot1_partition: partition@82000 {}\nboot_partition: partition@0 {}\nstorage_partition: partition@f8000 {}\n',
  'src/main.c': '#include <zephyr/kernel.h>\n#include <zephyr/dfu/mcuboot.h>\nint main(void) { boot_write_img_confirmed(); return 0; }\n',
  'README.md': '# AI XIAO\n',
}

assert.ok(createNordicAiMessages({
  userPrompt: '做一个 XIAO LED 闪烁程序',
  board: { name: 'Seeed XIAO nRF52840', boardTarget: 'xiao_ble' },
}).some(message => message.content.includes('xiao_ble')))

assert.deepEqual(extractNordicFilesFromAiText(JSON.stringify({ files })).files, files)
assert.deepEqual(extractNordicFilesFromAiText(`\`\`\`json\n${JSON.stringify({ files })}\n\`\`\``).files, files)
assert.deepEqual(validateNordicGeneratedFiles(files).files, files)

assert.throws(
  () => validateNordicGeneratedFiles({ ...files, '../escape.c': 'bad' }),
  /Unsafe Nordic AI file path/,
)
assert.throws(
  () => validateNordicGeneratedFiles({ ...files, 'prj.conf': 'CONFIG_GPIO=y\n' }),
  /missing required DFU config/,
)

let capturedMessages = null
const result = await generateNordicProjectWithAi({
  settings: { baseUrl: 'https://example.test/v1', apiKey: 'key', model: 'model' },
  userPrompt: '做一个真正 AI 生成的 XIAO 程序',
  board: { name: 'Seeed XIAO nRF52840', boardTarget: 'xiao_ble', chip: 'nRF52840' },
  completeChatImpl: async ({ messages }) => {
    capturedMessages = messages
    return JSON.stringify({ files })
  },
})

assert.equal(result.files['src/main.c'], files['src/main.c'])
assert.ok(capturedMessages.some(message => message.content.includes('做一个真正 AI 生成的 XIAO 程序')))
assert.ok(capturedMessages.some(message => message.content.includes('MCUboot')))
await assert.rejects(
  () => generateNordicProjectWithAi({
    settings: {},
    userPrompt: 'test',
    board: { name: 'Seeed XIAO nRF52840', boardTarget: 'xiao_ble' },
    completeChatImpl: async () => JSON.stringify({ files }),
  }),
  /请先配置 AI API/,
)

console.log('nordic AI generation tests passed')
