const TOOLS = [
  { name: 'vibeboard.health', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.list_capabilities', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.compile_project', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.get_build_evidence', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.flash_usb', status: 'available', transports: ['stdio', 'bridge', 'optional-browser'] },
  { name: 'vibeboard.flash_wifi_ota', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.flash_ble_ota', status: 'planned', transports: ['stdio', 'bridge', 'optional-browser'] },
  { name: 'vibeboard.render_lvgl_preview', status: 'available', transports: ['stdio'] },
  { name: 'vibeboard.collect_device_evidence', status: 'planned', transports: ['stdio'] },
]

export function runHealth() {
  return {
    status: 'ok',
    service: 'vibeboard-mcp-server',
    transport: 'stdio',
  }
}

export function listCapabilities() {
  return {
    tools: TOOLS.map(tool => ({
      name: tool.name,
      status: tool.status,
      transports: [...tool.transports],
    })),
  }
}
