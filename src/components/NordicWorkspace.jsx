import { useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { NORDIC_BOARD_PROFILE, listNordicCapabilities } from '../domain/nordic/boardProfile'
import { createDefaultNordicConfig, createNordicAppFiles, normalizeNordicAppName } from '../domain/nordic/appTemplate'
import { checkNordicCompilerHealth, compileNordicProject } from '../utils/nordicCompiler'
import './NordicWorkspace.css'

const QUICK_PROMPTS = [
  '做一个 BLE 外设，每秒打印心跳并闪烁 LED。',
  '做一个 GPIO 按键和 LED 测试工程，串口输出按键状态。',
  '做一个 I2C 传感器工程骨架，保留 Zephyr sensor API 接入点。',
]

export default function NordicWorkspace({ onOpenSettings }) {
  const [config, setConfig] = useState(createDefaultNordicConfig)
  const [files, setFiles] = useState(() => createNordicAppFiles(createDefaultNordicConfig()))
  const [activeFile, setActiveFile] = useState('src/main.c')
  const [prompt, setPrompt] = useState('')
  const [status, setStatus] = useState('nRF Connect SDK 工程已就绪。')
  const [buildState, setBuildState] = useState('idle')
  const [buildResult, setBuildResult] = useState(null)
  const [buildLog, setBuildLog] = useState('')
  const [health, setHealth] = useState(null)
  const capabilities = useMemo(() => listNordicCapabilities(), [])
  const activeContent = files[activeFile] || ''
  const selectedCaps = new Set(config.capabilities)

  function updateCapability(id) {
    setConfig(prev => {
      const nextCaps = new Set(prev.capabilities)
      if (nextCaps.has(id)) nextCaps.delete(id)
      else nextCaps.add(id)
      return { ...prev, capabilities: [...nextCaps] }
    })
  }

  function regenerate(nextConfig = config) {
    const normalized = {
      ...nextConfig,
      appName: normalizeNordicAppName(nextConfig.displayName || nextConfig.appName),
    }
    const nextFiles = createNordicAppFiles(normalized)
    setConfig(normalized)
    setFiles(nextFiles)
    setActiveFile(nextFiles[activeFile] ? activeFile : 'src/main.c')
    setBuildResult(null)
    setBuildLog('')
    setBuildState('idle')
    setStatus(`已生成 ${normalized.appName}，目标板 ${normalized.boardTarget}`)
  }

  function applyPrompt() {
    const lower = prompt.toLowerCase()
    const nextCaps = new Set(config.capabilities)
    if (/ble|bluetooth|蓝牙/.test(lower)) nextCaps.add('ble_peripheral')
    if (/gpio|led|button|按键|灯/.test(lower)) nextCaps.add('gpio_led_button')
    if (/uart|serial|串口|日志/.test(lower)) nextCaps.add('uart_console')
    if (/i2c|sensor|传感器/.test(lower)) nextCaps.add('i2c_sensor')
    const nextConfig = {
      ...config,
      displayName: prompt.trim().slice(0, 40) || config.displayName,
      description: prompt.trim() || config.description,
      capabilities: [...nextCaps],
    }
    regenerate(nextConfig)
  }

  const westBuild = `west build -b ${config.boardTarget} .`

  async function handleHealthCheck() {
    setBuildState('checking')
    setStatus('正在检查 Nordic 编译服务...')
    try {
      const result = await checkNordicCompilerHealth()
      setHealth(result)
      setBuildState('idle')
      setStatus(`Nordic 编译服务：${result.status}`)
    } catch (error) {
      setBuildState('error')
      setStatus(`Nordic 编译服务不可用：${error.message}`)
    }
  }

  async function handleBuild() {
    setBuildState('building')
    setBuildResult(null)
    setBuildLog('服务器 west build 正在运行...')
    setStatus('正在提交到服务器 west build...')
    try {
      const result = await compileNordicProject({
        files,
        boardTarget: config.boardTarget,
      })
      setBuildResult(result)
      setBuildLog(result.log || '')
      setBuildState(result.status === 'ok' ? 'ok' : 'error')
      setStatus(result.status === 'ok'
        ? `Nordic 构建完成：${result.projectId?.slice(0, 8) || 'unknown'}`
        : 'Nordic 构建失败')
    } catch (error) {
      setBuildResult(error.result || null)
      setBuildLog(error.result?.log || error.message)
      setBuildState('error')
      setStatus(`Nordic 构建失败：${error.message}`)
    }
  }

  return (
    <div className="nordic-workspace">
      <aside className="nordic-sidebar">
        <div className="nordic-heading">Nordic</div>
        <div className="nordic-board-card">
          <strong>{NORDIC_BOARD_PROFILE.name}</strong>
          <span>{NORDIC_BOARD_PROFILE.chip}</span>
          <code>{NORDIC_BOARD_PROFILE.boardTarget}</code>
        </div>
        <div className="nordic-status">{status}</div>
        <div className="nordic-command-box">
          <div className="nordic-heading">west</div>
          <code>{westBuild}</code>
          <code>west flash</code>
        </div>
        <div className="nordic-build-panel">
          <div className="nordic-heading">服务器 west build</div>
          {health && (
            <div className="nordic-build-meta">
              {health.status} · {health.buildTool} · {health.defaultBoardTarget}
            </div>
          )}
          <div className="nordic-build-actions">
            <button className="nordic-secondary" onClick={handleHealthCheck} disabled={buildState === 'checking' || buildState === 'building'}>
              检查服务
            </button>
            <button className="nordic-primary" onClick={handleBuild} disabled={buildState === 'building'}>
              {buildState === 'building' ? '构建中...' : '服务器构建'}
            </button>
          </div>
          {buildResult?.artifacts?.length > 0 && (
            <div className="nordic-artifacts">
              {buildResult.artifacts.map(artifact => (
                <code key={artifact.relativePath}>
                  {artifact.relativePath} · {(artifact.size / 1024).toFixed(1)} KB
                </code>
              ))}
            </div>
          )}
          {buildLog && <pre className="nordic-build-log">{buildLog}</pre>}
        </div>
        <div className="nordic-capability-list">
          <div className="nordic-heading">能力</div>
          {capabilities.map(capability => (
            <label key={capability.id} className="nordic-capability">
              <input
                type="checkbox"
                checked={selectedCaps.has(capability.id)}
                onChange={() => updateCapability(capability.id)}
              />
              <span>{capability.label}</span>
            </label>
          ))}
        </div>
        <button className="nordic-primary" onClick={() => regenerate()}>重新生成工程</button>
      </aside>

      <main className="nordic-main">
        <section className="nordic-overview">
          <div>
            <div className="nordic-heading">nRF Connect SDK</div>
            <h2>{config.displayName}</h2>
            <p>{config.description}</p>
          </div>
          <div className="nordic-stack">
            <span>Zephyr RTOS</span>
            <span>CMake</span>
            <span>Kconfig</span>
            <span>Devicetree</span>
          </div>
        </section>

        <section className="nordic-editor-wrap">
          <div className="nordic-files">
            {Object.keys(files).map(path => (
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
          <div className="nordic-editor">
            <Editor
              key={activeFile}
              language={languageForPath(activeFile)}
              theme="vs-dark"
              value={activeContent}
              onChange={value => setFiles(prev => ({ ...prev, [activeFile]: value || '' }))}
              options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
            />
          </div>
        </section>
      </main>

      <aside className="nordic-assistant">
        <div className="nordic-chat-header">
          <div>
            <div className="nordic-heading">AI 代码助手</div>
            <strong>nRF Connect SDK / Zephyr</strong>
          </div>
          <button onClick={onOpenSettings}>AI 设置</button>
        </div>
        <div className="nordic-chat-body">
          <p>描述需求后会生成真实 Zephyr 工程文件，包含 CMake、prj.conf 和 src/main.c。</p>
          <p>当前已接入服务器 west build；J-Link/nrfjprog 烧录和设备证据后续接入。</p>
          <div className="nordic-prompts">
            {QUICK_PROMPTS.map(item => (
              <button key={item} onClick={() => setPrompt(item)}>{item}</button>
            ))}
          </div>
        </div>
        <div className="nordic-input-area">
          <textarea
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
            placeholder="描述你想要的 nRF 功能..."
          />
          <button className="nordic-primary" onClick={applyPrompt} disabled={!prompt.trim()}>生成代码</button>
        </div>
      </aside>
    </div>
  )
}

function languageForPath(path) {
  if (path.endsWith('.c') || path.endsWith('.h')) return 'c'
  if (path.endsWith('.conf')) return 'ini'
  if (path.endsWith('.txt')) return 'cmake'
  if (path.endsWith('.md')) return 'markdown'
  return 'plaintext'
}
