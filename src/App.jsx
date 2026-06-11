import { useState, useCallback, useEffect, useMemo } from 'react'
import ChatPanel from './components/ChatPanel'
import LogPanel from './components/LogPanel'
import SettingsModal from './components/SettingsModal'
import CompilePanel from './components/CompilePanel'
import ProjectEditor from './components/ProjectEditor'
import HuangshanWorkspace from './components/HuangshanWorkspace'
import NordicWorkspace from './components/NordicWorkspace'
import { BOARDS, DEFAULT_BOARD_ID, getBoardList, getBoard } from './context/boards'
import { listPlatformBoards, getPlatformBoard } from './context/boardPlatform'
import { TOOLCHAINS } from './context/boardContract'
import { providerKeyForBaseUrl } from './utils/aiApi'
import { buildDefaultSettings } from './config/aiDefaults'
import { buildGeneratedConfig } from './utils/projectAssembly'
import { isSourcePath } from './utils/filePlacement'
import { normalizeGeneratedSourceFiles } from './utils/projectValidation'
import { normalizeApplicationFiles } from './domain/compilePackage/compilePackage'
import { DIGITAL_TWIN_MANIFEST_KEY } from './domain/digitalTwin/uiManifest'
import { createDeviceRepairContext } from './domain/evidence/deviceEvidence'
import { evaluateAcceptanceChecks } from './domain/workflow/acceptanceChecks'
import { NORDIC_BOARD_ID } from './domain/nordic/boardProfile'
import { stablePreviewFingerprint } from './utils/preview'
import bspHeader from '../backend/compiler-service/template/components/esp32_s3_szp/esp32_s3_szp.h?raw'
import bspSource from '../backend/compiler-service/template/components/esp32_s3_szp/esp32_s3_szp.c?raw'
import bspCmake from '../backend/compiler-service/template/components/esp32_s3_szp/CMakeLists.txt?raw'
import bspManifest from '../backend/compiler-service/template/components/esp32_s3_szp/idf_component.yml?raw'
import './App.css'

const STORAGE_KEY = 'esp32-vibe-coder-settings'
const BOARD_STORAGE_KEY = 'esp32-vibe-coder-board'

// Default connection settings come from build-time env vars (see
// src/config/aiDefaults.js and .env.example). No credentials live in source.
const DEFAULT_SETTINGS = buildDefaultSettings()

function withDefaultSettings(settings = {}) {
  const baseUrl = settings.baseUrl?.trim()
  const model = settings.model?.trim()
  const providerKeys = {
    ...(DEFAULT_SETTINGS.providerKeys || {}),
    ...(settings.providerKeys || {}),
  }
  const activeProviderKey = providerKeyForBaseUrl(baseUrl || DEFAULT_SETTINGS.baseUrl)
  if (settings.apiKey && !settings.providerKeys?.[activeProviderKey]) {
    providerKeys[activeProviderKey] = settings.apiKey.trim()
  }
  const apiKey = providerKeys[activeProviderKey] || ''
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    baseUrl: baseUrl || DEFAULT_SETTINGS.baseUrl,
    providerKeys,
    apiKey,
    model: model || DEFAULT_SETTINGS.model,
  }
}

function getDefaultFiles(boardId) {
  const board = getBoard(boardId)
  if (!board) return { 'main/main.c': '// place your code here\n' }

  return { 'main/main.c': '// Place your ESP-IDF code here\n#include <stdio.h>\n\nvoid app_main(void)\n{\n    printf("Hello from ESP32-Vibe-Coder!\\n");\n}\n' }
}

function getMainSourcePath() { return 'main/main.c' }

function loadInitialBoardId() {
  return localStorage.getItem(BOARD_STORAGE_KEY) || DEFAULT_BOARD_ID
}

const BSP_REFERENCE_FILES = {
  'components/esp32_s3_szp/esp32_s3_szp.h': bspHeader,
  'components/esp32_s3_szp/esp32_s3_szp.c': bspSource,
  'components/esp32_s3_szp/CMakeLists.txt': bspCmake,
  'components/esp32_s3_szp/idf_component.yml': bspManifest,
}

function chooseActiveGeneratedFile(files) {
  if (files['main/main.c']) return 'main/main.c'
  if (files['main/main.cpp']) return 'main/main.cpp'
  return Object.keys(files).find(k => /(^|\/)app_.*\.(c|cpp)$/.test(k)) ||
    Object.keys(files).find(k => /\.(c|cpp|cc|cxx)$/.test(k)) ||
    Object.keys(files).find(k => isSourcePath(k))
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      return withDefaultSettings(JSON.parse(raw))
    }
  } catch {}
  return DEFAULT_SETTINGS
}
function saveSettings(s) { localStorage.setItem(STORAGE_KEY, JSON.stringify(withDefaultSettings(s))) }

function newCompileSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `project-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [showCompile, setShowCompile] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState('esp-idf')
  const [rightTab, setRightTab] = useState('chat')
  const [pendingLogAnalysis, setPendingLogAnalysis] = useState(null)
  const [pendingBuildRepair, setPendingBuildRepair] = useState(null)
  const [compileSessionId, setCompileSessionId] = useState(newCompileSessionId)
  const [boardId, setBoardId] = useState(loadInitialBoardId)
  const [selectedSkills, setSelectedSkills] = useState([])
  const [latestManifest, setLatestManifest] = useState(null)
  const [latestPreviewContext, setLatestPreviewContext] = useState(null)
  const [latestDeviceEvidence, setLatestDeviceEvidence] = useState(null)
  const [latestCompileArtifact, setLatestCompileArtifact] = useState(null)
  const board = BOARDS[boardId]
  const generatedFiles = buildGeneratedConfig(boardId, selectedSkills)

  const [projectFiles, setProjectFiles] = useState(() => getDefaultFiles(loadInitialBoardId()))
  const [activeFile, setActiveFile] = useState(() => {
    const files = getDefaultFiles(loadInitialBoardId())
    return Object.keys(files)[0] || ''
  })

  function handleSaveSettings(s) {
    const next = withDefaultSettings(s)
    setSettings(next)
    saveSettings(next)
  }
  function handleBoardChange(id) {
    setBoardId(id)
    setCompileSessionId(newCompileSessionId())
    setLatestCompileArtifact(null)
    localStorage.setItem(BOARD_STORAGE_KEY, id)
  }

  // Unified picker: a board's toolchain decides which workspace renders.
  // SiFli/SCons boards (Huangshan) route to the Huangshan workspace; ESP-IDF
  // boards stay in the main editor. This replaces the standalone mode toggle
  // as the primary selection path while keeping both renderers intact.
  function handlePlatformBoardChange(id) {
    const platformBoard = getPlatformBoard(id)
    if (platformBoard?.toolchain === TOOLCHAINS.SIFLI_SCONS) {
      setWorkspaceMode('huangshan')
      return
    }
    if (platformBoard?.toolchain === TOOLCHAINS.NCS_ZEPHYR) {
      setWorkspaceMode('nordic')
      return
    }
    setWorkspaceMode('esp-idf')
    handleBoardChange(id)
  }

  function handleSkillsChange(nextOrUpdater) {
    setSelectedSkills(prev => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater
      return next || []
    })
  }

  function resetProjectState() {
    const files = getDefaultFiles(boardId)
    setProjectFiles(files)
    setSelectedSkills([])
    setLatestManifest(null)
    setLatestPreviewContext(null)
    setLatestDeviceEvidence(null)
    setActiveFile(Object.keys(files)[0] || '')
    setPendingLogAnalysis(null)
    setPendingBuildRepair(null)
    setLatestCompileArtifact(null)
    setCompileSessionId(newCompileSessionId())
  }

  useEffect(() => {
    const files = getDefaultFiles(boardId)
    setProjectFiles(files)
    setSelectedSkills([])
    setLatestManifest(null)
    setLatestPreviewContext(null)
    setLatestDeviceEvidence(null)
    setLatestCompileArtifact(null)
    setActiveFile(Object.keys(files)[0] || '')
  }, [boardId])

  const handlePreviewContextChange = useCallback((context) => {
    setLatestPreviewContext(context || null)
  }, [])

  const handleInsertCode = useCallback((codeOrFiles, options = {}) => {
    const manifest = options.manifest === undefined ? latestManifest : options.manifest
    let nextFiles = projectFiles
    if (typeof codeOrFiles === 'string') {
      const target = isSourcePath(activeFile) ? activeFile : getMainSourcePath()
      const normalized = normalizeGeneratedSourceFiles({ [target]: codeOrFiles }).files
      nextFiles = { ...projectFiles, ...normalized }
      setProjectFiles(nextFiles)
      setActiveFile(target)
    } else {
      const digitalTwinManifest = codeOrFiles?.[DIGITAL_TWIN_MANIFEST_KEY]
      const { files: applicationFiles } = normalizeApplicationFiles(codeOrFiles, board)
      const normalized = normalizeGeneratedSourceFiles(applicationFiles).files
      const nextActive = chooseActiveGeneratedFile(normalized)
      nextFiles = { ...projectFiles, ...normalized }
      if (digitalTwinManifest) nextFiles[DIGITAL_TWIN_MANIFEST_KEY] = digitalTwinManifest
      if (normalized['main/main.cpp']) delete nextFiles['main/main.c']
      if (normalized['main/main.c']) delete nextFiles['main/main.cpp']
      setProjectFiles(nextFiles)
      if (nextActive) setActiveFile(nextActive)
    }
    setLatestManifest(manifest || null)
  }, [activeFile, board, latestManifest, projectFiles])

  const currentCompileFingerprint = useCallback((files = projectFiles, skills = selectedSkills, manifest = latestManifest) =>
    stablePreviewFingerprint({
      projectFiles: files,
      selectedSkills: skills,
      manifest,
    }), [latestManifest, projectFiles, selectedSkills])

  const handleCompileArtifact = useCallback((artifact) => {
    if (!artifact?.firmware) {
      setLatestCompileArtifact(null)
      return
    }
    setLatestCompileArtifact({
      ...artifact,
      boardId,
      fingerprint: artifact.fingerprint || currentCompileFingerprint(artifact.projectFiles, artifact.selectedSkills, artifact.manifest),
    })
    if (artifact.autoFlash) setShowCompile(true)
  }, [boardId, currentCompileFingerprint])

  const reusableCompileArtifact = latestCompileArtifact &&
    latestCompileArtifact.boardId === boardId &&
    latestCompileArtifact.fingerprint === currentCompileFingerprint()
      ? latestCompileArtifact
      : null
  const acceptanceState = useMemo(() => evaluateAcceptanceChecks({
    manifest: latestManifest,
    buildEvidence: latestCompileArtifact?.buildEvidence || latestCompileArtifact?.firmware?.buildEvidence || null,
    deviceEvidence: latestDeviceEvidence,
  }), [latestCompileArtifact, latestDeviceEvidence, latestManifest])

  const hasConfig = settings.apiKey && settings.baseUrl && settings.model
  const currentPlatformBoardId = workspaceMode === 'nordic' ? NORDIC_BOARD_ID : boardId

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-mark" aria-hidden="true"><span></span><span></span><span></span></span>
            <span className="logo-copy">
              <span className="logo-text">VibeBoard Micro</span>
              <span className="product-subtitle">AI Hardware Workbench</span>
            </span>
          </div>
          <div className="divider" />
          <div className="workflow-strip" aria-label="Micro workflow">
            生成 / 编译 / 烧录 / 设备证据
          </div>
          <div className="divider" />
          <div className="workspace-switcher">
            <button className={workspaceMode === 'esp-idf' ? 'active' : ''} onClick={() => setWorkspaceMode('esp-idf')}>
              ESP-IDF
            </button>
            <button className={workspaceMode === 'huangshan' ? 'active' : ''} onClick={() => setWorkspaceMode('huangshan')}>
              Huangshan
            </button>
            <button className={workspaceMode === 'nordic' ? 'active' : ''} onClick={() => setWorkspaceMode('nordic')}>
              Nordic
            </button>
          </div>
          {workspaceMode !== 'huangshan' && (
            <div className="board-selector">
              <select
                className="board-select-input"
                value={currentPlatformBoardId}
                onChange={e => handlePlatformBoardChange(e.target.value)}
              >
                {listPlatformBoards().map(b => (
                  <option key={b.id} value={b.id}>
                    [{formatToolchainLabel(b.toolchain)}] {b.name} ({b.chip})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="header-right">
          <div className="model-info">
            {hasConfig ? (
              <><span className="model-dot online" /><span className="model-name">{settings.model}</span></>
            ) : (
              <><span className="model-dot offline" /><span className="model-name muted">未配置 API</span></>
            )}
          </div>
          <button className={`settings-btn ${!hasConfig ? 'pulse' : ''}`} onClick={() => setShowSettings(true)}>
            配置 AI
          </button>
        </div>
      </header>

      {workspaceMode === 'huangshan' ? (
        <div className="app-body huangshan-body">
          <HuangshanWorkspace settings={settings} onOpenSettings={() => setShowSettings(true)} />
        </div>
      ) : workspaceMode === 'nordic' ? (
        <div className="app-body huangshan-body">
          <NordicWorkspace settings={settings} onOpenSettings={() => setShowSettings(true)} />
        </div>
      ) : (
        <div className="app-body">
          <div className="editor-pane">
            <ProjectEditor
              files={projectFiles}
              generatedFiles={generatedFiles}
              referenceFiles={BSP_REFERENCE_FILES}
              activeFile={activeFile}
              board={board}
              selectedSkills={selectedSkills}
              onPreviewContextChange={handlePreviewContextChange}
              onFileChange={(newFiles, newActive) => {
                setProjectFiles(newFiles)
                setLatestCompileArtifact(null)
                if (newActive !== undefined) setActiveFile(newActive)
              }}
              onFileSelect={setActiveFile}
              onCompile={() => setShowCompile(true)}
            />
          </div>

          <div className="right-pane">
            <div className="right-tabs">
              <button className={`right-tab ${rightTab === 'chat' ? 'active' : ''}`} onClick={() => setRightTab('chat')}>
                AI 工作流
              </button>
              <button className={`right-tab ${rightTab === 'log' ? 'active' : ''}`} onClick={() => setRightTab('log')}>
                设备证据
              </button>
            </div>
            <div className="right-tab-content">
              <div className={`right-tab-panel ${rightTab === 'chat' ? 'active' : ''}`}>
                <ChatPanel
                  settings={settings}
                  board={board}
                  boardId={boardId}
                  onInsertCode={handleInsertCode}
                  onCompileArtifact={handleCompileArtifact}
                  initialPrompt={pendingLogAnalysis}
                  onConsumePrompt={() => setPendingLogAnalysis(null)}
                  repairRequest={pendingBuildRepair}
                  onConsumeRepairRequest={() => setPendingBuildRepair(null)}
                  projectFiles={projectFiles}
                  latestManifest={latestManifest}
                  previewContext={latestPreviewContext}
                  recentDeviceEvidence={latestDeviceEvidence}
                  acceptanceState={acceptanceState}
                  activeFile={activeFile}
                  selectedSkills={selectedSkills}
                  onSkillsChange={handleSkillsChange}
                  onResetProject={resetProjectState}
                />
              </div>
              <div className={`right-tab-panel ${rightTab === 'log' ? 'active' : ''}`}>
                <LogPanel
                  onDeviceEvidence={setLatestDeviceEvidence}
                  onAnalyze={(logs, deviceEvidence) => {
                    const evidence = deviceEvidence || latestDeviceEvidence
                    if (evidence) setLatestDeviceEvidence(evidence)
                    const deviceRepairContext = createDeviceRepairContext({
                      deviceEvidence: evidence,
                      manifest: latestManifest,
                      userSymptom: '用户请求 AI 分析设备日志。',
                    })
                    setPendingLogAnalysis(`请帮我分析以下 ESP32 设备日志，找出问题原因并给出修复建议：\n\n\`\`\`\n${logs}\n\`\`\``)
                    setPendingBuildRepair(prev => prev ? { ...prev, recentDeviceEvidence: deviceRepairContext } : prev)
                    setRightTab('chat')
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          defaultSettings={DEFAULT_SETTINGS}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showCompile && (
        <CompilePanel
          projectFiles={projectFiles}
          selectedSkills={selectedSkills}
          boardId={boardId}
          projectId={compileSessionId}
          manifest={latestManifest}
          initialFirmware={reusableCompileArtifact?.firmware || null}
          initialBuildEvidence={reusableCompileArtifact?.buildEvidence || null}
          initialBuildStatus={reusableCompileArtifact ? `AI 已自动编译成功 · ${(reusableCompileArtifact.firmware.size / 1024).toFixed(1)} KB` : ''}
          initialAutoFlash={Boolean(reusableCompileArtifact?.autoFlash)}
          onCompileArtifact={handleCompileArtifact}
          onConsumeInitialAutoFlash={() => {
            setLatestCompileArtifact(prev => prev ? { ...prev, autoFlash: false } : prev)
          }}
          onDeviceEvidence={setLatestDeviceEvidence}
          onRepairBuildFailure={(request) => {
            setPendingBuildRepair({
              ...request,
              recentDeviceEvidence: latestDeviceEvidence
                ? createDeviceRepairContext({
                    deviceEvidence: latestDeviceEvidence,
                    manifest: latestManifest,
                    userSymptom: '编译修复时附带最近一次设备日志证据。',
                  })
                : null,
            })
            setRightTab('chat')
          }}
          onClose={() => setShowCompile(false)}
        />
      )}
    </div>
  )
}

function formatToolchainLabel(toolchain) {
  if (toolchain === TOOLCHAINS.ESP_IDF) return 'ESP-IDF'
  if (toolchain === TOOLCHAINS.SIFLI_SCONS) return 'SiFli'
  if (toolchain === TOOLCHAINS.NCS_ZEPHYR) return 'Nordic'
  return toolchain
}
