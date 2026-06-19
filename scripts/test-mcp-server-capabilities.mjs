import assert from 'node:assert/strict'

import { runHealth, listCapabilities } from '../backend/mcp-server/tools/capabilities.mjs'
import { requireObject } from '../backend/mcp-server/tools/validate.mjs'
import { dispatchTool } from '../backend/mcp-server/server.mjs'

const expectedTools = [
  ['vibeboard.health', 'available', ['stdio']],
  ['vibeboard.list_capabilities', 'available', ['stdio']],
  ['vibeboard.compile_project', 'available', ['stdio']],
  ['vibeboard.get_build_evidence', 'available', ['stdio']],
  ['vibeboard.flash_usb', 'available', ['stdio', 'bridge', 'optional-browser']],
  ['vibeboard.flash_wifi_ota', 'available', ['stdio']],
  ['vibeboard.flash_ble_ota', 'planned', ['stdio', 'bridge', 'optional-browser']],
  ['vibeboard.render_lvgl_preview', 'available', ['stdio']],
  ['vibeboard.collect_device_evidence', 'planned', ['stdio']],
]

assert.deepEqual(runHealth(), {
  status: 'ok',
  service: 'vibeboard-mcp-server',
  transport: 'stdio',
})

const capabilities = listCapabilities()
assert.equal(Array.isArray(capabilities.tools), true)
assert.equal(capabilities.tools.length, expectedTools.length)

const toolsByName = new Map(capabilities.tools.map(tool => [tool.name, tool]))

for (const [name, status, transports] of expectedTools) {
  assert.equal(toolsByName.has(name), true, `${name} should be listed`)
  assert.equal(toolsByName.get(name).status, status)
  assert.deepEqual(toolsByName.get(name).transports, transports)
}

assert.equal(toolsByName.has('viboard.list_capabilities'), false)

assert.deepEqual(requireObject({ boardId: 'demo' }), { boardId: 'demo' })
assert.throws(() => requireObject(null, 'params'), /params must be an object/)
assert.throws(() => requireObject([], 'params'), /params must be an object/)

assert.deepEqual(await dispatchTool('vibeboard.health'), {
  status: 'success',
  result: {
    status: 'ok',
    service: 'vibeboard-mcp-server',
    transport: 'stdio',
  },
})

assert.deepEqual(await dispatchTool('vibeboard.list_capabilities', {}), {
  status: 'success',
  result: capabilities,
})

assert.deepEqual(await dispatchTool('viboard.list_capabilities', {}), {
  status: 'error',
  code: 'tool-not-found',
  message: 'Unknown tool: viboard.list_capabilities',
})
