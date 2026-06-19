import { listCapabilities } from '../../backend/mcp-server/tools/capabilities.mjs'
import './McpPanel.css'

const TOOL_SUMMARIES = {
  'vibeboard.health': 'Check that the local MCP process is responding.',
  'vibeboard.list_capabilities': 'List the hardware console tools exposed to local agents.',
  'vibeboard.compile_project': 'Assemble trusted ESP-IDF files, compile, and persist build artifacts.',
  'vibeboard.get_build_evidence': 'Load the latest build record, diagnostics, and artifact metadata.',
  'vibeboard.render_lvgl_preview': 'Render an LVGL first-screen preview and save the screenshot artifact.',
  'vibeboard.flash_usb': 'Validate USB flash artifacts and route confirmed requests to a local flasher bridge.',
  'vibeboard.flash_wifi_ota': 'Upload firmware to the OTA service and create a queued device job.',
  'vibeboard.flash_ble_ota': 'Validate BLE OTA firmware and require a browser or native BLE bridge.',
  'vibeboard.collect_device_evidence': 'Normalize logs, delivery results, and OTA job state into repair context.',
}

function formatToolName(name) {
  return name.replace('vibeboard.', '')
}

export default function McpPanel() {
  const capabilities = listCapabilities()
  const availableTools = capabilities.tools.filter(tool => tool.status === 'available').length

  return (
    <section className="mcp-panel" aria-label="MCP hardware tools">
      <div className="mcp-panel-header">
        <div>
          <h2>Local MCP</h2>
          <p>{availableTools} tools available for Codex, Claude Code, and local agents.</p>
        </div>
        <span className="mcp-server-chip">stdio</span>
      </div>

      <div className="mcp-command-block">
        <span>Start server</span>
        <code>npm run mcp:server</code>
      </div>

      <div className="mcp-tool-list">
        {capabilities.tools.map(tool => (
          <article className="mcp-tool-row" key={tool.name}>
            <div className="mcp-tool-main">
              <div className="mcp-tool-title">
                <code>{formatToolName(tool.name)}</code>
                <span className={`mcp-status ${tool.status}`}>{tool.status}</span>
              </div>
              <p>{TOOL_SUMMARIES[tool.name] || 'Hardware console capability.'}</p>
            </div>
            <div className="mcp-transport-list">
              {tool.transports.map(transport => (
                <span key={transport}>{transport}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
