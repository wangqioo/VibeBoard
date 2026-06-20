import { useMemo, useState } from 'react'
import Editor from '@monaco-editor/react'
import { NORDIC_BOARD_PROFILE, getNordicBoardProfile, listNordicBoards, listNordicCapabilities } from '../domain/nordic/boardProfile'
import { createDefaultNordicConfig, createNordicAppFiles, normalizeNordicAppName } from '../domain/nordic/appTemplate'
import { checkNordicCompilerHealth, compileNordicProject, downloadNordicArtifact, saveNordicArtifact, summarizeNordicBuildFailure } from '../utils/nordicCompiler'
import { flashNordicOverSerial, nordicDfuUnavailableReason } from '../utils/nordicDfu'
import { selectNordicDfuArtifact, selectNordicUf2Artifact } from '../utils/nordicDfuProtocol'
import './NordicWorkspace.css'

export default function NordicWorkspace({ settings, onOpenSettings }) {
  const [config, setConfig] = useState(createDefaultNordicConfig)
  const [files, setFiles] = useState(() => createNordicAppFiles(createDefaultNordicConfig()))
  const [activeFile, setActiveFile] = useState('src/main.c')
  const [status, setStatus] = useState('nRF Connect SDK 工程已就绪。')
  const [buildState, setBuildState] = useState('idle')
  const [buildResult, setBuildResult] = useState(null)
  const [buildLog, setBuildLog] = useState('')
  const [buildSummary, setBuildSummary] = useState(null)
  const [showFullBuildLog, setShowFullBuildLog] = useState(false)
  const [health, setHealth] = useState(null)
  const [dfuState, setDfuState] = useState('idle')
  const [dfuProgress, setDfuProgress] = useState(0)
  const [dfuLog, setDfuLog] = useState('')
  const boards = useMemo(() => listNordicBoards(), [])
  const capabilities = useMemo(() => listNordicCapabilities(), [])
  const selectedBoard = getNordicBoardProfile(config.boardId || config.boardTarget)
  const activeContent = files[activeFile] || ''
  const selectedCaps = new Set(config.capabilities)
  const uf2Artifact = selectNordicUf2Artifact(buildResult?.artifacts || [])
  const dfuArtifact = selectNordicDfuArtifact(buildResult?.artifacts || [])
  const dfuUnavailable = nordicDfuUnavailableReason()

  function resetBuildAndDfuState() {
    setBuildResult(null)
    setBuildLog('')
    setBuildSummary(null)
    setShowFullBuildLog(false)
    setBuildState('idle')
    setDfuState('idle')
    setDfuProgress(0)
    setDfuLog('')
  }

  function updateCapability(id) {
    setConfig(prev => {
      const nextCaps = new Set(prev.capabilities)
      if (nextCaps.has(id)) nextCaps.delete(id)
      else nextCaps.add(id)
      return { ...prev, capabilities: [...nextCaps] }
    })
  }

  function regenerate(nextConfig = config) {
    const board = getNordicBoardProfile(nextConfig.boardId || nextConfig.boardTarget)
    const normalized = {
      ...nextConfig,
      appName: normalizeNordicAppName(nextConfig.displayName || nextConfig.appName),
      boardId: board.id,
      boardTarget: board.boardTarget,
    }
    const nextFiles = createNordicAppFiles(normalized)
    setConfig(normalized)
    setFiles(nextFiles)
    setActiveFile(nextFiles[activeFile] ? activeFile : 'src/main.c')
    resetBuildAndDfuState()
    setStatus(`已生成模板 ${normalized.appName}，目标板 ${normalized.boardTarget}`)
  }

  function handleBoardChange(boardId) {
    const board = getNordicBoardProfile(boardId)
    regenerate({
      ...config,
      boardId: board.id,
      boardTarget: board.boardTarget,
    })
  }

  const westBuild = `west build -b ${selectedBoard.boardTarget} .`

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
    setBuildSummary(null)
    setShowFullBuildLog(false)
    setBuildLog('服务器 west build 正在运行...')
    setStatus('正在提交到服务器 west build...')
    try {
      const result = await compileNordicProject({
        files,
        boardTarget: selectedBoard.boardTarget,
      })
      setBuildResult(result)
      setBuildLog(result.log || '')
      setBuildSummary(null)
      setBuildState(result.status === 'ok' ? 'ok' : 'error')
      setStatus(result.status === 'ok'
        ? `Nordic 构建完成：${result.projectId?.slice(0, 8) || 'unknown'}`
        : 'Nordic 构建失败')
    } catch (error) {
      setBuildResult(error.result || null)
      const summary = error.summary || summarizeNordicBuildFailure(error.result?.log || error.message)
      setBuildSummary(summary)
      setBuildLog(error.result?.log || error.message)
      setBuildState('error')
      setStatus(`Nordic 构建失败：${summary.title}`)
    }
  }

  async function handleDfuFlash() {
    setDfuState('running')
    setDfuProgress(0)
    setDfuLog('准备 Web Serial DFU...')
    setStatus('正在通过浏览器串口烧录 Nordic 固件...')
    try {
      await flashNordicOverSerial({
        artifact: dfuArtifact,
        downloadArtifact: downloadNordicArtifact,
        onLog: line => setDfuLog(prev => `${prev}${prev ? '\n' : ''}${line}`),
        onProgress: value => setDfuProgress(value),
      })
      setDfuState('ok')
      setStatus('Nordic Web Serial DFU 完成')
    } catch (error) {
      setDfuState('error')
      setDfuLog(prev => `${prev}${prev ? '\n' : ''}${error.message}`)
      setStatus(`Nordic 串口烧录失败：${error.message}`)
    }
  }

  async function handleUf2Download() {
    if (!uf2Artifact) return
    try {
      const result = await saveNordicArtifact(uf2Artifact)
      setStatus(`已下载 ${result.name} · ${(result.size / 1024).toFixed(1)} KB`)
    } catch (error) {
      setStatus(`UF2 下载失败：${error.message}`)
    }
  }

  return (
    <div className="nordic-workspace">
      <aside className="nordic-sidebar">
        <div className="nordic-heading">Nordic</div>
        <div className="nordic-board-card">
          <strong>{NORDIC_BOARD_PROFILE.name}</strong>
          <span>{selectedBoard.chip}</span>
          <code>{selectedBoard.boardTarget}</code>
        </div>
        <label className="nordic-field">
          <span className="nordic-heading">目标板</span>
          <select value={selectedBoard.id} onChange={event => handleBoardChange(event.target.value)}>
            {boards.map(board => (
              <option key={board.id} value={board.id}>{board.name} · {board.boardTarget}</option>
            ))}
          </select>
        </label>
        <div className="nordic-status">{status}</div>
        <div className="nordic-command-box">
          <div className="nordic-heading">west</div>
          <code>{westBuild}</code>
          <code>UF2 首刷 / MCUmgr 后续升级</code>
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
                  {artifact.relativePath} · {(artifact.size / 1024).toFixed(1)} KB{artifact.uf2 ? ' · UF2' : ''}{artifact.dfu ? ' · DFU' : ''}
                </code>
              ))}
            </div>
          )}
          {buildSummary && (
            <div className="nordic-build-summary">
              <strong>{buildSummary.title}</strong>
              {buildSummary.suggestion && <span>{buildSummary.suggestion}</span>}
              {buildSummary.excerpt && <pre>{buildSummary.excerpt}</pre>}
            </div>
          )}
          {buildLog && (
            <>
              {buildSummary && (
                <button className="nordic-log-toggle" onClick={() => setShowFullBuildLog(prev => !prev)}>
                  {showFullBuildLog ? '隐藏完整日志' : '展开完整日志'}
                </button>
              )}
              {(!buildSummary || showFullBuildLog) && <pre className="nordic-build-log">{buildLog}</pre>}
            </>
          )}
        </div>
        <div className="nordic-uf2-panel">
          <div className="nordic-heading">UF2 下载 / 拖拽烧录</div>
          <div className="nordic-dfu-meta">
            {uf2Artifact
              ? `将下载 ${uf2Artifact.name || uf2Artifact.relativePath}`
              : '先服务器构建，生成 zephyr.uf2'}
          </div>
          <button className="nordic-primary" onClick={handleUf2Download} disabled={!uf2Artifact}>
            下载 UF2
          </button>
          <div className="nordic-dfu-note">
            首次烧录或恢复时，XIAO 双击 reset 进入 UF2/U 盘模式后，把 zephyr.uf2 拖进去。
          </div>
        </div>
        <div className="nordic-dfu-panel">
          <div className="nordic-heading">MCUmgr 串口升级 / Web Serial DFU</div>
          <div className="nordic-dfu-meta">
            {dfuArtifact
              ? `将烧录 ${dfuArtifact.name || dfuArtifact.relativePath}`
              : '先服务器构建，生成 zephyr.signed.bin'}
          </div>
          <button
            className="nordic-primary"
            onClick={handleDfuFlash}
            disabled={!dfuArtifact || Boolean(dfuUnavailable) || dfuState === 'running'}
            title={dfuUnavailable || '通过 Chrome/Edge Web Serial 烧录 nRF'}
          >
            {dfuState === 'running' ? `烧录中 ${dfuProgress}%` : '串口烧录'}
          </button>
          <div className="nordic-dfu-progress" aria-label="Nordic DFU progress">
            <span style={{ width: `${dfuProgress}%` }} />
          </div>
          <div className="nordic-dfu-note">
            需要板子已运行 VibeBoard 固件，并启用 MCUboot + MCUmgr；之后可用浏览器上传 zephyr.signed.bin。
          </div>
          {(dfuUnavailable || dfuLog) && (
            <pre className="nordic-dfu-log">{dfuLog || dfuUnavailable}</pre>
          )}
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
            <div className="nordic-heading">本地 Agent 工作流</div>
            <strong>nRF Connect SDK / Zephyr</strong>
          </div>
        </div>
        <div className="nordic-chat-body">
          <p>本页面不再调用浏览器模型写代码。请在本地 Codex 或 Claude Code 中通过 MCP 或本地仓库修改 Nordic 工程。</p>
          <p>当前已接入服务器 west build、UF2 首刷和浏览器 Web Serial MCUmgr 后续升级。</p>
          <div className="nordic-prompts">
            <code>src/main.c</code>
            <code>prj.conf</code>
            <code>CMakeLists.txt</code>
            <code>boards/xiao_ble.overlay</code>
          </div>
        </div>
        <div className="nordic-input-area">
          <p>修改文件后使用左侧服务器构建和 DFU 工具验证，构建日志会保留给本地 Agent 继续修复。</p>
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
