#!/usr/bin/env node

import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { listCapabilities, runHealth } from './tools/capabilities.mjs'
import { compileProjectTool } from './tools/compileProject.mjs'
import { getBuildEvidenceTool } from './tools/buildEvidence.mjs'
import { renderLvglPreviewTool } from './tools/lvglPreview.mjs'
import { flashUsbTool } from './tools/usbFlash.mjs'
import { flashWifiOtaTool } from './tools/wifiOta.mjs'
import { flashBleOtaTool } from './tools/bleOta.mjs'
import { collectDeviceEvidenceTool } from './tools/deviceEvidence.mjs'
import { requireObject } from './tools/validate.mjs'

const TOOL_HANDLERS = {
  'vibeboard.health': runHealth,
  'vibeboard.list_capabilities': listCapabilities,
  'vibeboard.compile_project': compileProjectTool,
  'vibeboard.get_build_evidence': getBuildEvidenceTool,
  'vibeboard.render_lvgl_preview': renderLvglPreviewTool,
  'vibeboard.flash_usb': flashUsbTool,
  'vibeboard.flash_wifi_ota': flashWifiOtaTool,
  'vibeboard.flash_ble_ota': flashBleOtaTool,
  'vibeboard.collect_device_evidence': collectDeviceEvidenceTool,
}

export async function dispatchTool(name, input = {}, adapters = {}) {
  requireObject(input)

  const handler = TOOL_HANDLERS[name]

  if (!handler) {
    return {
      status: 'error',
      code: 'tool-not-found',
      message: `Unknown tool: ${name}`,
    }
  }

  return {
    status: 'success',
    result: await handler(input, adapters),
  }
}

async function dispatchMessage(message) {
  const request = requireObject(message, 'message')
  const params = request.params === undefined ? {} : requireObject(request.params, 'params')
  const result = await dispatchTool(request.method, params)

  return {
    id: request.id ?? null,
    ...result,
  }
}

async function runStdioServer() {
  const lines = createInterface({ input })

  for await (const line of lines) {
    if (!line.trim()) {
      continue
    }

    try {
      const response = await dispatchMessage(JSON.parse(line))
      output.write(`${JSON.stringify(response)}\n`)
    } catch (error) {
      output.write(JSON.stringify({
        id: null,
        status: 'error',
        code: 'invalid-request',
        message: error.message,
      }) + '\n')
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runStdioServer()
}
