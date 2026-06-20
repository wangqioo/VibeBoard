import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { HUANGSHAN_BOARD_PROFILE, listHuangshanCapabilities } from '../domain/huangshan/boardProfile'
import { createHuangshanAppFiles, normalizeHuangshanAppName } from '../domain/huangshan/appTemplate'
import {
  createDefaultHuangshanBuilderConfig,
  createHuangshanAppFilesFromBuilder,
  normalizeHuangshanBuilderConfig,
} from '../domain/huangshan/appBuilder'
import { createHuangshanSemanticPreview } from '../domain/huangshan/semanticPreview'
import { createHuangshanTruthReport } from '../domain/huangshan/truthReport'
import {
  buildHuangshanWorkspace,
  flashHuangshanWorkspace,
  loadHuangshanHealth,
  loadHuangshanSerialPorts,
  monitorHuangshanSerial,
  renderHuangshanLvglPreview,
  verifyHuangshanReadback,
} from '../utils/huangshanCompiler'
import './HuangshanWorkspace.css'

const HUANGSHAN_CAPABILITY_OPTIONS = [
  { value: 'status', label: '状态' },
  { value: 'ambient_light', label: '环境光' },
  { value: 'imu', label: 'IMU' },
  { value: 'magnetometer', label: '磁力计' },
  { value: 'adc_gpio', label: 'ADC' },
  { value: 'battery', label: '电池' },
  { value: 'charger', label: '充电' },
  { value: 'tf_card', label: 'TF 卡' },
  { value: 'usb_fs', label: 'USB FS' },
  { value: 'audio_pdm', label: 'PDM' },
  { value: 'audio_i2s', label: 'I2S' },
  { value: 'audio_audprc', label: 'AUDPRC' },
  { value: 'bluetooth', label: 'BLE' },
  { value: 'low_power', label: '低功耗' },
  { value: 'key', label: '按键' },
  { value: 'led', label: 'LED' },
  { value: 'gpio_output', label: 'GPIO' },
  { value: 'uart2', label: 'UART2' },
  { value: 'motor', label: '马达' },
]

const HUANGSHAN_BRIDGE_STORAGE_KEY = 'vibeboard-huangshan-bridge-url'

function componentImplementationLabel(implementation) {
  if (implementation === 'real') return '真实'
  if (implementation === 'placeholder') return '占位'
  return '仅界面'
}

function normalizeBridgeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function bridgeStatusLabel(status) {
  if (status === 'device-ready') return '设备就绪'
  if (status === 'no-device') return '未发现设备'
  if (status === 'missing-flasher') return '缺少 sftool'
  if (status === 'missing-sdk') return '缺少 SDK'
  if (status === 'server') return '服务器模式'
  return '未启动'
}

function checkStatusText(value) {
  return value ? '就绪' : '缺失'
}

function createHuangshanBridgeStatus(health, baseUrl) {
  if (!baseUrl) {
    return {
      status: health?.ok ? 'server' : 'offline',
      label: health?.ok ? bridgeStatusLabel('server') : bridgeStatusLabel('offline'),
      checks: [],
      issues: health?.ok ? [] : ['server-offline'],
    }
  }
  const status = health?.bridge?.status || (health?.ok ? 'connected' : 'offline')
  return {
    status,
    label: bridgeStatusLabel(status),
    checks: [
      { id: 'sdk', label: 'SDK', ok: Boolean(health?.checks?.buildScript && health?.checks?.sdkExport) },
      { id: 'sftool', label: 'sftool', ok: Boolean(health?.checks?.sftool) },
      { id: 'serial', label: '串口', ok: Boolean(health?.checks?.serialPort) },
    ],
    issues: health?.bridge?.issues || [],
  }
}

export default function HuangshanWorkspace({ settings, onOpenSettings }) {
  const [appDisplayName, setAppDisplayName] = useState('传感器仪表盘')
  const [description, setDescription] = useState('显示黄山派真实传感器和 ADC 读数。')
  const [builderConfig, setBuilderConfig] = useState(() => normalizeHuangshanBuilderConfig(createDefaultHuangshanBuilderConfig({
    displayName: '传感器仪表盘',
    description: '显示黄山派真实传感器和 ADC 读数。',
  })))
  const [files, setFiles] = useState(() => createHuangshanAppFiles({
    displayName: '传感器仪表盘',
    description: '显示黄山派真实传感器和 ADC 读数。',
  }))
  const [activeFile, setActiveFile] = useState(() => Object.keys(files)[0])
  const [health, setHealth] = useState(null)
  const [status, setStatus] = useState('')
  const [buildState, setBuildState] = useState('idle')
  const [buildLog, setBuildLog] = useState([])
  const [serialLog, setSerialLog] = useState([])
  const [buildEvidence, setBuildEvidence] = useState(null)
  const [serialPorts, setSerialPorts] = useState([])
  const [selectedPort, setSelectedPort] = useState(HUANGSHAN_BOARD_PROFILE.debug.defaultSerialPort)
  const [monitorBaud, setMonitorBaud] = useState(921600)
  const [flashState, setFlashState] = useState('idle')
  const [verifyState, setVerifyState] = useState('idle')
  const [readbackEvidence, setReadbackEvidence] = useState(null)
  const [monitorState, setMonitorState] = useState('idle')
  const [monitorAbort, setMonitorAbort] = useState(null)
  const [realPreview, setRealPreview] = useState(null)
  const [renderState, setRenderState] = useState('idle')
  const [renderError, setRenderError] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [bridgeUrl, setBridgeUrl] = useState(() => {
    try {
      return localStorage.getItem(HUANGSHAN_BRIDGE_STORAGE_KEY) || ''
    } catch {
      return ''
    }
  })

  const appName = useMemo(() => normalizeHuangshanAppName(appDisplayName), [appDisplayName])
  const huangshanServiceBaseUrl = useMemo(() => normalizeBridgeUrl(bridgeUrl), [bridgeUrl])
  const bridgeStatus = createHuangshanBridgeStatus(health, huangshanServiceBaseUrl)
  const capabilities = useMemo(() => listHuangshanCapabilities(), [])
  const preview = useMemo(() => createHuangshanSemanticPreview({
    displayName: appDisplayName,
    description,
    files,
  }), [appDisplayName, description, files])
  const truthReport = useMemo(() => createHuangshanTruthReport({
    config: builderConfig,
    buildEvidence,
    serialLogLines: serialLog,
  }), [builderConfig, buildEvidence, serialLog])

  useEffect(() => {
    try {
      const normalized = normalizeBridgeUrl(bridgeUrl)
      if (normalized) {
        localStorage.setItem(HUANGSHAN_BRIDGE_STORAGE_KEY, normalized)
      } else {
        localStorage.removeItem(HUANGSHAN_BRIDGE_STORAGE_KEY)
      }
    } catch {
      // Local storage can be unavailable in strict browser modes.
    }
  }, [bridgeUrl])

  const refreshHuangshanService = useCallback(() => {
    loadHuangshanHealth({ baseUrl: huangshanServiceBaseUrl })
      .then(setHealth)
      .catch(error => setHealth({ ok: false, error: error.message }))
    loadHuangshanSerialPorts({ baseUrl: huangshanServiceBaseUrl })
      .then(payload => {
        const ports = payload.ports || []
        setSerialPorts(ports)
        const recommended = ports.find(port => port.recommended) || ports[0]
        if (recommended) setSelectedPort(recommended.path)
      })
      .catch(() => setSerialPorts([]))
  }, [huangshanServiceBaseUrl])

  useEffect(() => {
    refreshHuangshanService()
  }, [refreshHuangshanService])

  function resetGeneratedState() {
    setBuildEvidence(null)
    setReadbackEvidence(null)
    setBuildLog([])
    setSerialLog([])
    setRealPreview(null)
    setRenderState('idle')
    setRenderError('')
  }

  function regenerateTemplate() {
    const next = createHuangshanAppFiles({ displayName: appDisplayName, description })
    setFiles(next)
    setActiveFile(Object.keys(next)[0])
    resetGeneratedState()
    setStatus(`已生成 ${appName}`)
  }

  function applyBuilderConfig(normalized, statusText = null) {
    const next = createHuangshanAppFilesFromBuilder(normalized)
    setAppDisplayName(normalized.displayName)
    setDescription(normalized.description)
    setBuilderConfig(normalized)
    setFiles(next)
    setActiveFile(Object.keys(next)[0])
    resetGeneratedState()
    setStatus(statusText || `已生成 ${normalizeHuangshanAppName(normalized.displayName)}`)
  }

  function handleGenerateBuilderApp() {
    const normalized = normalizeHuangshanBuilderConfig({
      ...builderConfig,
      displayName: appDisplayName,
      description,
      components: builderConfig.components.filter(component => component.enabled !== false),
    })
    applyBuilderConfig(normalized)
  }

  function updateBuilderComponent(componentId, patch) {
    setBuilderConfig(prev => ({
      ...normalizeHuangshanBuilderConfig({
        ...prev,
        components: prev.components.map(component => (
        component.id === componentId ? { ...component, ...patch } : component
        )),
      }),
    }))
    setRealPreview(null)
  }

  function toggleBuilderComponent(componentId) {
    setBuilderConfig(prev => ({
      ...prev,
      components: prev.components.map(component => (
        component.id === componentId ? { ...component, enabled: component.enabled === false } : component
      )),
    }))
    setRealPreview(null)
  }

  async function handleRenderPreview(tap = null) {
    const safeTap = tap && Number.isFinite(Number(tap.x)) && Number.isFinite(Number(tap.y))
      ? { x: Number(tap.x), y: Number(tap.y) }
      : null
    setRenderState('rendering')
    setRenderError('')
    setStatus(safeTap ? `正在渲染点击 ${safeTap.x}, ${safeTap.y}...` : '正在渲染 LVGL 预览...')
    try {
      const rendered = await renderHuangshanLvglPreview({
        displayName: appDisplayName,
        description,
        files,
        tap: safeTap,
        baseUrl: huangshanServiceBaseUrl,
      })
      setRealPreview(rendered)
      setRenderState('ok')
      const cacheText = rendered.cache?.hit ? '命中缓存' : '已编译'
      setStatus(`预览就绪：${rendered.viewport.width}x${rendered.viewport.height} / ${cacheText}`)
    } catch (error) {
      setRealPreview(null)
      setRenderState('error')
      setRenderError(error.message || 'LVGL 预览失败')
      setStatus(error.message || 'LVGL 预览失败')
    }
  }

  async function handleBuild() {
    setBuildState('building')
    setBuildLog([])
    setReadbackEvidence(null)
    setSerialLog([])
    setBuildEvidence(null)
    setStatus('正在编译黄山派工程...')
    try {
      const evidence = await buildHuangshanWorkspace({
        files,
        baseUrl: huangshanServiceBaseUrl,
        onStatus: setStatus,
        onLog: line => setBuildLog(prev => [...prev, line]),
      })
      setBuildEvidence(evidence)
      setBuildState('ok')
      setStatus('编译成功，可以烧录。')
    } catch (error) {
      setBuildEvidence(error.buildEvidence || null)
      setBuildState('error')
      setStatus(error.message || '编译失败')
    }
  }

  async function handleFlash() {
    setFlashState('flashing')
    setBuildLog([])
    setStatus(`正在烧录 ${selectedPort}...`)
    try {
      await flashHuangshanWorkspace({
        port: selectedPort,
        baseUrl: huangshanServiceBaseUrl,
        onStatus: setStatus,
        onLog: line => setBuildLog(prev => [...prev, line]),
      })
      setFlashState('ok')
      setStatus('烧录成功')
    } catch (error) {
      setFlashState('error')
      setStatus(error.message || '烧录失败')
    }
  }

  async function handleVerifyReadback() {
    setVerifyState('verifying')
    setBuildLog([])
    setReadbackEvidence(null)
    setStatus(`正在读回校验 ${selectedPort}...`)
    try {
      const evidence = await verifyHuangshanReadback({
        port: selectedPort,
        baseUrl: huangshanServiceBaseUrl,
        onStatus: setStatus,
        onLog: line => setBuildLog(prev => [...prev, line]),
      })
      setReadbackEvidence(evidence)
      setVerifyState('ok')
      setStatus('读回校验通过')
    } catch (error) {
      setVerifyState('error')
      setReadbackEvidence(error.buildEvidence?.flashEvidence || null)
      setStatus(error.message || '读回校验失败')
    }
  }

  function handleStartMonitor() {
    const controller = new AbortController()
    setMonitorAbort(controller)
    setMonitorState('monitoring')
    setBuildLog([])
    setSerialLog([])
    monitorHuangshanSerial({
      port: selectedPort,
      baud: monitorBaud,
      baseUrl: huangshanServiceBaseUrl,
      signal: controller.signal,
      onStatus: setStatus,
      onLog: line => {
        setBuildLog(prev => [...prev, line])
        setSerialLog(prev => [...prev, line])
      },
    }).then(() => {
      setMonitorState('idle')
      setMonitorAbort(null)
    }).catch(error => {
      if (error.name === 'AbortError') {
        setStatus('串口监视已停止')
      } else {
        setStatus(error.message || '串口监视失败')
        setMonitorState('error')
      }
      setMonitorAbort(null)
    })
  }

  function handleStopMonitor() {
    monitorAbort?.abort()
    setMonitorState('idle')
    setMonitorAbort(null)
    setStatus('串口监视已停止')
  }

  const filePaths = Object.keys(files)
  const activeContent = files[activeFile] || ''
  const canFlash = buildEvidence?.status === 'success' && selectedPort && flashState !== 'flashing'
  const canVerifyReadback = buildEvidence?.status === 'success' && selectedPort && verifyState !== 'verifying' && Boolean(huangshanServiceBaseUrl)
  const canMonitor = selectedPort && monitorState !== 'monitoring'
  const logState = flashState === 'error' || monitorState === 'error' ? 'error' : buildState
  const workflowSteps = createHuangshanWorkflowSteps({
    files,
    buildState,
    flashState,
    verifiedCount: truthReport.verifiedCount,
  })

  return (
    <div className="huangshan-workspace">
      <aside className="huangshan-status-sidebar">
        <div className="huangshan-heading">状态</div>
        <div className={`huangshan-status ${logState}`}>
          {status || '本地 Agent 修改源码后，在这里预览、编译、烧录和采集证据。'}
        </div>
        <HuangshanRunLogStrip
          buildLog={buildLog}
          buildState={buildState}
          flashState={flashState}
          monitorState={monitorState}
          onClear={() => {
            setBuildLog([])
            setSerialLog([])
          }}
        />
        <TruthReportPanel report={truthReport} />
        <div className="huangshan-stage-actions">
          <button className="huangshan-secondary" onClick={() => handleRenderPreview()} disabled={renderState === 'rendering'}>
            {renderState === 'rendering' ? '预览中...' : '预览'}
          </button>
          <button className="huangshan-build" onClick={handleBuild} disabled={buildState === 'building'}>
            {buildState === 'building' ? '编译中...' : '编译'}
          </button>
          <button className="huangshan-flash" onClick={handleFlash} disabled={!canFlash}>
            {flashState === 'flashing' ? '烧录中...' : '烧录'}
          </button>
          <button className="huangshan-secondary" onClick={handleVerifyReadback} disabled={!canVerifyReadback}>
            {verifyState === 'verifying' ? '校验中...' : '读回校验'}
          </button>
        </div>
        {buildEvidence?.artifactSummary?.artifacts?.length > 0 && (
          <div className="huangshan-artifacts compact">
            {buildEvidence.artifactSummary.artifacts.map(item => (
              <div key={item.relativePath} className="huangshan-artifact">
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.kind}</span>
                </div>
                <code>{formatArtifactSize(item.size)}</code>
              </div>
            ))}
          </div>
        )}
        <FlashEvidencePanel flashEvidence={readbackEvidence} />
      </aside>

      <section className="huangshan-command">
        <div className="huangshan-chat-panel">
          <div className="huangshan-chat-header">
            <div>
              <div className="huangshan-chat-title">
                <span>本地 Agent 工作流</span>
              </div>
              <div className="huangshan-chat-subtitle">通过 MCP 或本地仓库修改黄山派应用源码</div>
            </div>
            <div className="huangshan-chat-header-actions">
              <span className="huangshan-service-mode">{huangshanServiceBaseUrl ? 'LOCAL' : 'SERVER'}</span>
              <span className={`huangshan-status-dot ${health?.ok ? 'online' : 'offline'}`} title={health?.ok ? '编译服务已连接' : '编译服务未连接'} />
            </div>
          </div>

          <div className="huangshan-board-badge">
            <span className="huangshan-board-chip">{HUANGSHAN_BOARD_PROFILE.chip}</span>
            <span className="huangshan-board-name">{HUANGSHAN_BOARD_PROFILE.name}</span>
            <span className="huangshan-board-idf">SCons</span>
          </div>

          <div className="huangshan-skill-selector">
            <span className="huangshan-skill-label">真实例程：</span>
            {['sensor', 'adc', 'gpio', 'uart2', 'ws2812'].map(skill => (
              <span key={skill} className="huangshan-skill-tag">{skill}</span>
            ))}
          </div>

          <div className="huangshan-workflow-strip">
            {workflowSteps.map(step => (
              <div key={step.id} className={`huangshan-workflow-step ${step.status}`}>
                <span>{step.label}</span>
              </div>
            ))}
          </div>

          <div className="huangshan-chat-messages">
            <div className="huangshan-message assistant">
              <div className="huangshan-message-role">MCP</div>
              <div className="huangshan-message-content">
                本页面不再调用浏览器模型写代码。请在本地 Codex 或 Claude Code 中编辑黄山派工程源码，再回到这里执行预览、编译、烧录和串口证据采集。
              </div>
            </div>
            <div className="huangshan-message assistant">
              <div className="huangshan-message-role">边界</div>
              <div className="huangshan-message-content">
                网页端只展示真实例程能力、设备状态、构建产物和真实性报告；源码变更由本地 Agent 或手动编辑完成。
              </div>
            </div>
          </div>
        </div>

        <div className="huangshan-device-compact">
          <div className={`huangshan-bridge-card ${bridgeStatus.status}`}>
            <div className="huangshan-bridge-card-head">
              <span>Bridge</span>
              <strong className="huangshan-bridge-state">{bridgeStatus.label}</strong>
            </div>
            {bridgeStatus.checks.length > 0 && (
              <div className="huangshan-bridge-checks">
                {bridgeStatus.checks.map(check => (
                  <span key={check.id} className={`huangshan-bridge-check ${check.ok ? 'ok' : 'error'}`}>
                    {check.label} {checkStatusText(check.ok)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <label>
            Bridge
            <input
              value={bridgeUrl}
              onChange={event => setBridgeUrl(event.target.value)}
              placeholder="http://127.0.0.1:8771"
            />
          </label>
          <label>
            串口
            <select value={selectedPort} onChange={event => setSelectedPort(event.target.value)}>
              {serialPorts.length === 0 && <option value={selectedPort}>{selectedPort}</option>}
              {serialPorts.map(port => (
                <option key={port.path} value={port.path}>{port.path}</option>
              ))}
            </select>
          </label>
          {monitorState === 'monitoring' ? (
            <button className="huangshan-monitor" onClick={handleStopMonitor}>停止串口</button>
          ) : (
            <button className="huangshan-monitor" onClick={handleStartMonitor} disabled={!canMonitor}>
              监视串口
            </button>
          )}
          <button className="huangshan-secondary" type="button" onClick={refreshHuangshanService}>刷新设备</button>
          <div className="huangshan-device-hint">
            {huangshanServiceBaseUrl ? '本机 bridge 接管黄山派编译、烧录和串口。' : '留空走服务器；本机 USB 需填本地 bridge。'}
          </div>
        </div>

        <button className="huangshan-advanced-toggle" onClick={() => setShowAdvanced(prev => !prev)}>
          {showAdvanced ? '隐藏代码和日志' : '查看代码和日志'}
        </button>
      </section>

      <section className="huangshan-main">
        <div className="huangshan-stage">
          <div className="huangshan-preview-panel">
            <HuangshanDevicePreview
              preview={preview}
              realPreview={realPreview}
              renderState={renderState}
              renderError={renderError}
              onRender={handleRenderPreview}
            />
          </div>
        </div>

        <div className="huangshan-workbench huangshan-code-workbench">
          <div className="huangshan-code-pane">
            <div className="huangshan-files">
              {filePaths.map(path => (
                <button
                  key={path}
                  className={activeFile === path ? 'active' : ''}
                  onClick={() => setActiveFile(path)}
                  title={path}
                >
                  {path}
                </button>
              ))}
            </div>
            <div className="huangshan-editor">
              <Editor
                key={activeFile}
                language={activeFile.endsWith('SConscript') ? 'python' : 'c'}
                theme="vs-dark"
                value={activeContent}
                onChange={value => {
                  setFiles(prev => ({ ...prev, [activeFile]: value || '' }))
                  setRealPreview(null)
                }}
                options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
              />
            </div>
          </div>
        </div>

        {showAdvanced && (
          <div className="huangshan-advanced">
            <div className="huangshan-advanced-config">
              <div className="huangshan-section">
                <div className="huangshan-heading">应用</div>
                <label>
                  名称
                  <input value={appDisplayName} onChange={event => {
                    setAppDisplayName(event.target.value)
                    setBuilderConfig(prev => ({ ...prev, displayName: event.target.value }))
                    setRealPreview(null)
                  }} />
                </label>
                <label>
                  描述
                  <textarea value={description} onChange={event => {
                    setDescription(event.target.value)
                    setBuilderConfig(prev => ({ ...prev, description: event.target.value }))
                    setRealPreview(null)
                  }} />
                </label>
              </div>

              <div className="huangshan-section">
                <div className="huangshan-heading">组件</div>
                <div className="huangshan-builder-list">
                  {builderConfig.components.map(component => (
                    <div key={component.id || `${component.type}-${component.label}`} className={`huangshan-builder-item ${component.enabled === false ? 'disabled' : ''}`}>
                      <label className="huangshan-builder-toggle">
                        <input
                          type="checkbox"
                          checked={component.enabled !== false}
                          onChange={() => toggleBuilderComponent(component.id)}
                        />
                        <span>{component.type}</span>
                      </label>
                      <span className={`huangshan-component-truth ${component.implementation}`}>
                        {componentImplementationLabel(component.implementation)}
                      </span>
                      <input
                        value={component.label}
                        onChange={event => updateBuilderComponent(component.id, { label: event.target.value })}
                        aria-label={`${component.type} label`}
                      />
                      <input
                        value={component.value}
                        onChange={event => updateBuilderComponent(component.id, { value: event.target.value })}
                        aria-label={`${component.type} value`}
                      />
                      <select
                        value={component.capability || 'status'}
                        onChange={event => updateBuilderComponent(component.id, { capability: event.target.value })}
                        aria-label={`${component.type} capability`}
                      >
                        {HUANGSHAN_CAPABILITY_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="huangshan-section">
                <div className="huangshan-heading">设备</div>
                <label>
                  波特率
                  <select value={monitorBaud} onChange={event => setMonitorBaud(Number(event.target.value))}>
                    <option value={921600}>921600</option>
                    <option value={115200}>115200</option>
                    <option value={1000000}>1000000</option>
                  </select>
                </label>
                <div className="huangshan-chips">
                  {capabilities.slice(0, 8).map(item => (
                    <span key={item.id} className={`huangshan-chip ${item.priority}`}>{item.id}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="huangshan-workbench huangshan-log-workbench">
              <aside className="huangshan-log">
                <div className="huangshan-heading">编译日志</div>
                {buildEvidence?.firstError && (
                  <pre className="huangshan-error">{buildEvidence.firstError.context.join('\n')}</pre>
                )}
                <div className="huangshan-log-lines">
                  {buildLog.slice(-160).map((line, index) => (
                    <div key={`${index}-${line}`}>{line}</div>
                  ))}
                </div>
              </aside>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function TruthReportPanel({ report }) {
  return (
    <div className="huangshan-truth">
      <div className="huangshan-heading">真实性报告</div>
      <div className="huangshan-truth-summary">
        <span>真实 {report.realCount}</span>
        <span>占位 {report.placeholderCount}</span>
        <span>已验证 {report.verifiedCount}</span>
      </div>
      <div className="huangshan-truth-list">
        {report.items.map(item => (
          <div key={item.id} className={`huangshan-truth-item ${item.implementation}`}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.dataSource}</span>
            </div>
            <code>{truthBadge(item)}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

function FlashEvidencePanel({ flashEvidence }) {
  if (!flashEvidence?.artifacts?.length) return null
  return (
    <div className="huangshan-flash-evidence">
      <div className="huangshan-heading">Flash Evidence</div>
      <div className="huangshan-flash-evidence-summary">
        <span>{flashEvidence.status === 'verified' ? '读回一致' : '读回不一致'}</span>
        <code>{flashEvidence.port}</code>
      </div>
      {flashEvidence.artifacts.map(item => (
        <div key={`${item.name}-${item.address}`} className={`huangshan-flash-evidence-row ${item.matched ? 'matched' : 'mismatch'}`}>
          <div>
            <strong>{item.name}</strong>
            <span>{item.address} / {formatArtifactSize(item.size)}</span>
          </div>
          <code>{String(item.actualSha256 || '').slice(0, 12)}</code>
        </div>
      ))}
    </div>
  )
}

function HuangshanRunLogStrip({ buildLog, buildState, flashState, monitorState, onClear }) {
  const recent = buildLog.slice(-8)
  const hasLogs = recent.length > 0
  return (
    <div className="huangshan-run-log">
      <div className="huangshan-run-log-head">
        <div className="huangshan-heading">运行日志</div>
        <button type="button" onClick={onClear} disabled={!hasLogs}>清空</button>
      </div>
      <div className="huangshan-run-states">
        <span className={buildState}>编译 {stateText(buildState)}</span>
        <span className={flashState}>烧录 {stateText(flashState)}</span>
        <span className={monitorState}>串口 {stateText(monitorState)}</span>
      </div>
      <div className="huangshan-run-lines">
        {hasLogs ? recent.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        )) : (
          <div className="empty">预览、编译、烧录或监视串口后，这里会显示最近日志。</div>
        )}
      </div>
    </div>
  )
}

function stateText(state) {
  if (state === 'ok') return '成功'
  if (state === 'error') return '失败'
  if (state === 'building') return '进行中'
  if (state === 'flashing') return '进行中'
  if (state === 'monitoring') return '运行中'
  return '待命'
}

function truthBadge(item) {
  if (item.canClaimVerified) return '已验证'
  if (item.canClaimReal) return '已编译'
  if (item.implementation === 'real') return '真实'
  if (item.implementation === 'placeholder') return '占位'
  return '仅界面'
}

function createHuangshanWorkflowSteps({ files, buildState, flashState, verifiedCount }) {
  const hasGeneratedFiles = files && Object.keys(files).some(path => path.includes('/gui_apps/'))
  return [
    { id: 'agent', label: '本地 Agent', status: 'done' },
    { id: 'code', label: '源码', status: hasGeneratedFiles ? 'done' : 'idle' },
    { id: 'build', label: '编译', status: buildState === 'building' ? 'active' : (buildState === 'ok' ? 'done' : (buildState === 'error' ? 'error' : 'idle')) },
    { id: 'flash', label: '烧录', status: flashState === 'flashing' ? 'active' : (flashState === 'ok' ? 'done' : (flashState === 'error' ? 'error' : 'idle')) },
    { id: 'verify', label: '验证', status: verifiedCount > 0 ? 'done' : 'idle' },
  ]
}

function HuangshanDevicePreview({ preview, realPreview, renderError, onRender }) {
  const hasRealPreview = realPreview?.rgbaBase64 && realPreview?.viewport

  function handlePreviewTap(point) {
    onRender(point)
  }

  return (
    <div className="huangshan-device-preview">
      <div className="huangshan-watch-shell">
        <div className="huangshan-watch-screen">
          {hasRealPreview ? (
            <HuangshanFramebufferCanvas frame={realPreview} onTap={handlePreviewTap} />
          ) : (
            <>
              <div className="huangshan-watch-glow" />
              <div className="huangshan-watch-title">{preview.title}</div>
              <div className="huangshan-watch-grid">
                {preview.launcherItems.map((item, index) => (
                  <div key={item.id} className={`huangshan-watch-icon ${item.tone}`} style={{ '--i': index }}>
                    <span>{item.label.slice(0, 2)}</span>
                  </div>
                ))}
              </div>
              <div className="huangshan-watch-status">{preview.status}</div>
              <div className="huangshan-watch-subtitle">{preview.subtitle}</div>
            </>
          )}
        </div>
      </div>
      <div className="huangshan-preview-meta">
        <span>{preview.viewport.width} x {preview.viewport.height}</span>
        <span>{hasRealPreview ? realPreview.renderer : '语义预览'}</span>
        {hasRealPreview && <span>{realPreview.cache?.hit ? '命中缓存' : '已编译'}</span>}
        {realPreview?.tap && <span>点击 {realPreview.tap.x},{realPreview.tap.y}</span>}
      </div>
      {renderError && <div className="huangshan-render-error">{renderError}</div>}
    </div>
  )
}

function HuangshanFramebufferCanvas({ frame, onTap }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { width, height } = frame.viewport
    canvas.width = width
    canvas.height = height

    const binary = atob(frame.rgbaBase64)
    const pixels = new Uint8ClampedArray(binary.length)
    for (let index = 0; index < binary.length; index++) {
      pixels[index] = binary.charCodeAt(index)
    }

    const context = canvas.getContext('2d')
    context.putImageData(new ImageData(pixels, width, height), 0, 0)
  }, [frame])

  function handlePointerDown(event) {
    if (!onTap) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const { width, height } = frame.viewport
    onTap({
      x: Math.round(((event.clientX - rect.left) / rect.width) * width),
      y: Math.round(((event.clientY - rect.top) / rect.height) * height),
    })
  }

  return (
    <canvas
      ref={canvasRef}
      className="huangshan-framebuffer"
      aria-label="Huangshan real LVGL framebuffer"
      onPointerDown={handlePointerDown}
    />
  )
}

function formatArtifactSize(size) {
  if (!Number.isFinite(size)) return '-'
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}
