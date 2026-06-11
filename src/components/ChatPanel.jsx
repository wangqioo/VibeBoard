import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { completeChat, streamChat } from '../utils/aiApi'
import { AGENT_TASK_TYPES, createAgentTask, runAgentTask } from '../domain/agent/agentAdapter'
import { patchSkill } from '../context/index'
import { compileFirmware } from '../utils/compiler'
import { assembleCompileFiles } from '../utils/projectAssembly'
import {
  buildBuildRepairMessages,
  buildPreviewRepairMessages,
  buildSourceContractRepairMessages,
  inferSkillsFromRequest,
  parseGeneratedFilesResponseWithOptions,
} from '../utils/codeGeneration'
import {
  runScopeStep,
  runLvglDesignStep,
  runManifestStep,
  runSourceGenerationStep,
} from '../domain/workflow/generationPipeline'
import { createPipelineDeps } from '../domain/workflow/pipelineWiring'
import {
  normalizeGeneratedSourceFiles,
  validateLvglPreviewContract,
  validateProjectIncludes,
} from '../utils/projectValidation'
import {
  WORKFLOW_STEP_STATUS,
  createGenerationWorkflow,
  updateGenerationWorkflow,
} from '../domain/workflow/generationWorkflow'
import { createWorkflowCompilerAdapter } from '../domain/workflow/workflowCompilerAdapter'
import {
  HARDWARE_WORKFLOW_EVENT,
  replaceLastAssistantMessage,
} from '../domain/workflow/hardwareWorkflowEvents'
import { runHardwareWorkflow } from '../domain/workflow/hardwareWorkflow'
import {
  buildPreviewFeedbackEvidence,
  isLikelyPreviewRepairRequest,
} from '../domain/previewRepair/repairIntent'
import './ChatPanel.css'

const QUICK_PROMPTS = [
  '帮我写一个点亮屏幕显示"Hello World"的完整例程',
  '帮我写一个读取QMI8658加速度计数据的代码',
  '帮我写一个播放MP3音乐的主函数',
  '帮我实现WiFi扫描并连接功能',
  '帮我写一个摄像头实时显示到LCD的例程',
  '帮我做一个带按钮的触屏MP3播放器',
  '帮我做一个显示WiFi连接状态的触摸界面',
]

const MAX_SOURCE_REPAIR_ATTEMPTS = 2
const MAX_BUILD_REPAIR_ATTEMPTS = 2
const LVGL_DESIGN_APPROVAL_RE = /(定稿|确认|通过|继续生成|生成完整|完整固件|可以了|就这样|ok|OK|approve|approved|continue)/i

function hasLvglDesignDraft(files = {}) {
  return Boolean(files['main/app_ui.c'] && files['main/app_ui.h'])
}

function isLvglDesignApproval(text, files = {}, skillIds = []) {
  return hasLvglDesignDraft(files) &&
    new Set(skillIds || []).has('lvgl') &&
    LVGL_DESIGN_APPROVAL_RE.test(String(text || ''))
}

function needsLvglDesignDraft(scopeResult, skillIds = [], text = '', files = {}) {
  if (isLvglDesignApproval(text, files, skillIds)) return false
  return Boolean(scopeResult?.designRequired || new Set(skillIds || []).has('lvgl'))
}

function getQuickPrompts(board) {
  if (board.id === 'szpi_esp32s3') return QUICK_PROMPTS
  const skillLabels = board.skills.map(s => s.label).filter(Boolean)
  if (skillLabels.length === 0) return ['帮我写一个完整的示例程序']
  return skillLabels.map(label => `帮我实现${label}的功能`)
}

async function extractKnowledge({ settings, board, userMsg, aiReply, selectedSkillIds }) {
  const validIds = board.skills.map(s => s.id).join('|')
  const extractPrompt = `You just helped a user with embedded development.

User asked: ${userMsg}

Your reply contained this code/info: ${aiReply.slice(0, 1200)}

Current skill IDs loaded: ${selectedSkillIds.join(', ') || 'none'}

Task: Does your reply contain a pitfall, a correct usage pattern, or an init sequence that is NOT already documented in the loaded skills?
If YES, respond with ONLY valid JSON (no markdown):
{"found": true, "skillId": "<one of: ${validIds}>", "type": "pitfall|usage", "content": "<one concise sentence>"}
If NO new knowledge, respond with ONLY: {"found": false}`

  let result = ''
  await streamChat({
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    messages: [
      { role: 'system', content: 'You are a knowledge extractor. Reply only with the JSON asked, nothing else.' },
      { role: 'user', content: extractPrompt },
    ],
    onChunk: c => { result += c },
    onDone: () => {},
    onError: () => {},
  })
  try {
    return JSON.parse(result.trim())
  } catch {
    return { found: false }
  }
}

function loadPatches() {
  try { return JSON.parse(localStorage.getItem('skillPatches') || '[]') } catch { return [] }
}
function savePatches(patches) {
  localStorage.setItem('skillPatches', JSON.stringify(patches))
}

function normalizeAndValidateGeneratedFiles(files, selectedSkillIds, board, options = {}) {
  const normalized = normalizeGeneratedSourceFiles(files || {})
  const validation = options.previewOnly
    ? validateLvglPreviewContract(normalized.files, selectedSkillIds)
    : validateProjectIncludes(normalized.files, selectedSkillIds, board)
  return {
    ok: validation.ok,
    files: normalized.files,
    message: validation.message,
    changed: normalized.changed,
  }
}

async function compileGeneratedFiles({ boardId, files, selectedSkills, onStatus, onLog }) {
  const adapter = createWorkflowCompilerAdapter({
    assembleCompileFiles,
    compileFirmware,
  })
  const result = await adapter.compile({
    boardId,
    projectId: `generation-${Date.now()}`,
    files,
    selectedSkills,
    onStatus,
    onLog,
  })
  return result.firmware
}

function appendOrReplaceAssistantMessage(setMessages, nextMessage) {
  setMessages(prev => replaceLastAssistantMessage(prev, nextMessage))
}

export default function ChatPanel({
  settings,
  board,
  boardId,
  onInsertCode,
  onCompileArtifact,
  initialPrompt,
  onConsumePrompt,
  repairRequest,
  onConsumeRepairRequest,
  previewRepairRequest,
  onConsumePreviewRepairRequest,
  selectedSkills = [],
  onSkillsChange,
  onResetProject,
  projectFiles = {},
  latestManifest = null,
  previewContext = null,
  recentDeviceEvidence = null,
  acceptanceState = null,
  activeFile = '',
}) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [knowledgeCard, setKnowledgeCard] = useState(null)
  const [generationWorkflow, setGenerationWorkflow] = useState(createGenerationWorkflow)
  const [pendingLvglDesign, setPendingLvglDesign] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  useEffect(() => {
    loadPatches().forEach(p => patchSkill(boardId, p.skillId, p.type, p.content))
  }, [boardId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (initialPrompt) {
      sendMessage(initialPrompt)
      onConsumePrompt?.()
    }
  }, [initialPrompt]) // eslint-disable-line

  useEffect(() => {
    if (repairRequest) {
      repairBuildFailure(repairRequest)
      onConsumeRepairRequest?.()
    }
  }, [repairRequest]) // eslint-disable-line

  useEffect(() => {
    if (previewRepairRequest) {
      repairPreviewFailure(previewRepairRequest)
      onConsumePreviewRepairRequest?.()
    }
  }, [previewRepairRequest]) // eslint-disable-line

  const hasConfig = settings.apiKey && settings.baseUrl && settings.model
  const quickPrompts = useMemo(() => getQuickPrompts(board), [board])

  async function runVibeBoardAgentTask(taskType, messages, context = {}) {
    const result = await runAgentTask({
      task: createAgentTask({
        taskType,
        boardId,
        skillIds: selectedSkills,
        context,
        messages,
      }),
      settings,
    })
    return result.content
  }

  function toggleSkill(id) {
    onSkillsChange?.(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
  }

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || streaming || !hasConfig) return

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setStreaming(true)
    setKnowledgeCard(null)

    const aiMsg = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, aiMsg])

    const systemPrompt = board.buildSystemPrompt(selectedSkills)
    const apiMessages = [{ role: 'system', content: systemPrompt }, ...newMessages]

    let aborted = false
    let finalReply = ''
    abortRef.current = () => { aborted = true }

    await streamChat({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: apiMessages,
      onChunk: (chunk) => {
        if (aborted) return
        finalReply += chunk
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: updated[updated.length - 1].content + chunk,
          }
          return updated
        })
      },
      onDone: async () => {
        setStreaming(false)
        if (!aborted && finalReply.length > 100) {
          const extracted = await extractKnowledge({
            settings, board,
            userMsg: text,
            aiReply: finalReply,
            selectedSkillIds: selectedSkills,
          })
          if (extracted.found) setKnowledgeCard(extracted)
        }
      },
      onError: (err) => {
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: `**错误**: ${err}`,
            error: true,
          }
          return updated
        })
        setStreaming(false)
      },
    })
  }, [messages, streaming, hasConfig, settings, board, selectedSkills, onInsertCode])

  async function generateCodeFromInput(textOverride = null) {
    const text = typeof textOverride === 'string' ? textOverride.trim() : input.trim()
    if (!text || generating || streaming || !hasConfig) return

    if (isLikelyPreviewRepairRequest({
      text,
      projectFiles,
      manifest: latestManifest,
      previewContext,
    })) {
      await repairPreviewFailure({
        userFeedback: text,
        previewEvidence: buildPreviewFeedbackEvidence({
          userFeedback: text,
          projectFiles,
          previewContext,
          activeFile,
        }),
        manifest: latestManifest,
        projectFiles,
        selectedSkills,
      })
      setInput('')
      return
    }

    setGenerating(true)
    setKnowledgeCard(null)
    setGenerationWorkflow(updateGenerationWorkflow(createGenerationWorkflow(), 'intent', WORKFLOW_STEP_STATUS.ACTIVE, '解析用户需求和技能'))
    const approvedPendingDesign = Boolean(
      pendingLvglDesign &&
      hasLvglDesignDraft(projectFiles) &&
      LVGL_DESIGN_APPROVAL_RE.test(text),
    )
    const effectiveUserRequest = approvedPendingDesign ? pendingLvglDesign.userRequest : text
    setMessages(prev => [
      ...prev,
      { role: 'user', content: text },
      {
        role: 'assistant',
        content: approvedPendingDesign
          ? '已收到 LVGL 设计定稿，正在基于已批准界面生成完整固件...'
          : '正在结合板级能力界定功能范围...',
      },
    ])
    try {
      const inferredSkills = approvedPendingDesign
        ? pendingLvglDesign.selectedSkills
        : inferSkillsFromRequest(board, text, selectedSkills)
      if (inferredSkills.join(',') !== selectedSkills.join(',')) {
        onSkillsChange?.(inferredSkills)
      }

      // Injected collaborators for the pure pipeline steps (no UI inside them).
      const pipelineDeps = createPipelineDeps({
        board,
        runAgentTask: runVibeBoardAgentTask,
        validateGeneratedFiles: normalizeAndValidateGeneratedFiles,
      })

      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'scope', WORKFLOW_STEP_STATUS.ACTIVE, '按当前板子外设/BSP/官方例程界定功能'))
      const scopeStep = approvedPendingDesign
        ? { ok: true, status: 'ready', scope: { ...pendingLvglDesign.scope, status: 'ready', ok: true }, skills: pendingLvglDesign.selectedSkills }
        : await runScopeStep(pipelineDeps, { userRequest: text, inferredSkills, projectFiles })
      if (!scopeStep.ok) {
        setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'scope', WORKFLOW_STEP_STATUS.FAILED, scopeStep.errors.join(', ')))
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = {
            role: 'assistant',
            content: `功能范围界定失败：${scopeStep.errors.join(', ')}`,
            error: true,
          }
          return next
        })
        return
      }
      const scopeResult = scopeStep.scope
      const scopedSkills = scopeStep.skills
      if (scopedSkills.join(',') !== inferredSkills.join(',')) {
        onSkillsChange?.(scopedSkills)
      }
      if (scopeStep.status === 'needs_clarification') {
        setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'scope', WORKFLOW_STEP_STATUS.FAILED, '等待用户确认功能边界'))
        setMessages(prev => {
          const next = [...prev]
          const questions = scopeResult.questions.length > 0
            ? scopeResult.questions.map((question, index) => `${index + 1}. ${question}`).join('\n')
            : '请补充这个功能要使用板子上的哪些外设和第一版验收目标。'
          const constraints = scopeResult.constraints.length > 0
            ? `\n\n板级约束：\n${scopeResult.constraints.map(item => `- ${item}`).join('\n')}`
            : ''
          next[next.length - 1] = {
            role: 'assistant',
            content: `先确认功能边界，再生成代码。\n\n${scopeResult.summary ? `已知范围：${scopeResult.summary}\n\n` : ''}${questions}${constraints}`,
          }
          return next
        })
        return
      }
      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'scope', WORKFLOW_STEP_STATUS.DONE, scopeResult.summary || '功能范围已限定到板级能力'))

      if (needsLvglDesignDraft(scopeResult, scopedSkills, text, projectFiles)) {
        setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'design', WORKFLOW_STEP_STATUS.ACTIVE, '生成 LVGL 第一屏设计草稿'))
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = {
            role: 'assistant',
            content: `功能范围已确认，正在先生成 LVGL 设计草稿供你定稿...\n\n设计类型：${scopeResult.designProfileId || 'compact_control_panel'}`,
          }
          return next
        })

        const designStep = await runLvglDesignStep(pipelineDeps, {
          userRequest: effectiveUserRequest,
          scopedSkills,
          scope: scopeResult,
          projectFiles,
        })
        if (!designStep.ok) {
          const message = designStep.stage === 'parse'
            ? `LVGL 设计草稿未通过文件校验：${designStep.message}`
            : `LVGL 设计草稿未通过预览契约：\n\n${designStep.message}`
          setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'design', WORKFLOW_STEP_STATUS.FAILED, designStep.message))
          setMessages(prev => replaceLastAssistantMessage(prev, {
            role: 'assistant',
            content: message,
            error: true,
          }))
          return
        }

        setPendingLvglDesign({
          userRequest: effectiveUserRequest,
          selectedSkills: scopedSkills,
          scope: scopeResult,
        })
        onInsertCode?.(designStep.files, {
          selectedSkills: scopedSkills,
          autoPreview: true,
          source: 'lvgl-design-draft',
        })
        setInput('')
        setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'design', WORKFLOW_STEP_STATUS.DONE, 'LVGL 设计草稿已写入并触发预览'))
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = {
            role: 'assistant',
            content: `已生成 LVGL 第一屏设计草稿，并写入 main/app_ui.c / main/app_ui.h 供预览。\n\n请先看右侧 LVGL 预览定稿：\n- 满意：回复“定稿，继续生成完整固件”\n- 不满意：直接说要改哪里，比如“按钮再大一点、背景换浅灰、列表放上面”\n\n这一步不编译、不烧录，只用于确认屏幕设计。`,
          }
          return next
        })
        return
      }
      if (approvedPendingDesign) {
        setPendingLvglDesign(null)
      }

      let latestCompileLog = []
      let currentBuildRepairAttempt = 0
      let latestSourceChanged = false
      const workflowOutcome = await runHardwareWorkflow({
        boardId,
        userRequest: effectiveUserRequest,
        selectedSkills: scopedSkills,
        projectFiles,
      }, {
        maxSourceRepairAttempts: MAX_SOURCE_REPAIR_ATTEMPTS,
        maxBuildRepairAttempts: MAX_BUILD_REPAIR_ATTEMPTS,
        resolveSkills: async () => scopedSkills,
        runScope: async () => ({ ...scopeResult, status: 'ready', selectedSkillIds: scopedSkills }),
        shouldDraftDesign: () => false,
        generateManifest: async () => {
          setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'manifest', WORKFLOW_STEP_STATUS.ACTIVE, '生成 Program Manifest'))
          const result = await runManifestStep(pipelineDeps, {
            userRequest: effectiveUserRequest,
            scopedSkills,
            scope: scopeResult,
            projectFiles,
          })
          if (!result.ok) {
            return { ok: false, message: `程序清单未通过校验：${result.message}` }
          }
          setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'validate-manifest', WORKFLOW_STEP_STATUS.DONE, 'Manifest 已通过校验'))
          if (result.manifest.skillIds?.length) {
            onSkillsChange?.(result.manifest.skillIds)
          }
          return { ok: true, manifest: result.manifest }
        },
        generateSource: async ({ manifest }) => {
          setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'generate-files', WORKFLOW_STEP_STATUS.ACTIVE, `生成 ${manifest.files.length} 个应用文件`))
          appendOrReplaceAssistantMessage(setMessages, {
            role: 'assistant',
            content: `已生成程序清单，正在生成 ${manifest.files.length} 个应用文件...`,
            manifest,
          })
          return runSourceGenerationStep(pipelineDeps, {
            userRequest: effectiveUserRequest,
            manifest,
            projectFiles,
          })
        },
        validateSource: async (files, { manifest }) => {
          setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'validate-source', WORKFLOW_STEP_STATUS.ACTIVE, '校验生成文件'))
          const result = normalizeAndValidateGeneratedFiles(files, manifest.skillIds, board)
          latestSourceChanged = Boolean(result.changed)
          return result
        },
        repairSource: async ({ files, diagnostics, attempt, manifest }) => {
          const repairContent = await completeChat({
            baseUrl: settings.baseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: buildSourceContractRepairMessages({
              board,
              selectedSkills: manifest.skillIds,
              userRequest: effectiveUserRequest,
              manifest,
              projectFiles: files,
              diagnostics,
              attempt,
            }),
          })
          const repairParsed = parseGeneratedFilesResponseWithOptions(repairContent, board, { manifest })
          if (!repairParsed.ok) return { ok: false, message: `自动修复结果未通过文件校验：${repairParsed.errors.join(', ')}` }
          return { ok: true, files: repairParsed.files }
        },
        compile: async ({ files, manifest }) => {
          latestCompileLog = []
          setGenerationWorkflow(prev => updateGenerationWorkflow(
            prev,
            'validate-source',
            WORKFLOW_STEP_STATUS.ACTIVE,
            currentBuildRepairAttempt > 0
              ? `编译修复后重新验证 ${currentBuildRepairAttempt}/${MAX_BUILD_REPAIR_ATTEMPTS}`
              : '源码契约已通过，正在自动编译验证',
          ))
          appendOrReplaceAssistantMessage(setMessages, {
            role: 'assistant',
            content: currentBuildRepairAttempt > 0
              ? `已应用编译修复，正在第 ${currentBuildRepairAttempt}/${MAX_BUILD_REPAIR_ATTEMPTS} 次重新编译验证...`
              : '源码契约自检通过，正在自动调用编译服务验证真实 ESP-IDF 构建...',
            manifest,
          })
          try {
            const firmware = await compileGeneratedFiles({
              boardId,
              files,
              selectedSkills: manifest.skillIds,
              onStatus: () => {},
              onLog: line => { latestCompileLog.push(line) },
            })
            return {
              firmware,
              buildEvidence: firmware?.buildEvidence || null,
            }
          } catch (err) {
            err.buildLog = latestCompileLog
            throw err
          }
        },
        repairBuild: async ({ files, error, buildEvidence, attempt, manifest }) => {
          currentBuildRepairAttempt = attempt
          const repairContent = await runVibeBoardAgentTask(
            AGENT_TASK_TYPES.REPAIR_BUILD,
            buildBuildRepairMessages({
              board,
              selectedSkills: manifest.skillIds,
              buildEvidence,
              buildLog: latestCompileLog,
              errorLog: error,
              projectFiles: files,
              manifest,
              activeFile,
              recentDeviceEvidence,
            }),
            {
              buildEvidence,
              repairContext: buildEvidence?.repairContext || null,
              recentDeviceEvidence,
              source: 'generation-auto-compile',
            },
          )
          const repairParsed = parseGeneratedFilesResponseWithOptions(repairContent, board, {
            requireCompleteProject: false,
            validateManifestFiles: false,
          })
          if (!repairParsed.ok) return { ok: false, message: `编译自动修复补丁未通过校验：${repairParsed.errors.join(', ')}` }
          return { ok: true, files: repairParsed.files }
        },
        emit: event => {
          if (event.type === HARDWARE_WORKFLOW_EVENT.MESSAGE) {
            appendOrReplaceAssistantMessage(setMessages, {
              role: 'assistant',
              ...(event.payload || {}),
            })
          }
        },
      })

      if (workflowOutcome.status !== 'completed') {
        throw new Error(workflowOutcome.error || '硬件工作流未完成')
      }

      const finalFiles = workflowOutcome.files
      const manifest = workflowOutcome.manifest
      const compiledFirmware = workflowOutcome.artifact
      const sourceDetail = workflowOutcome.sourceRepairAttempts > 0
        ? `源码契约已通过校验，源码自动修复 ${workflowOutcome.sourceRepairAttempts} 轮`
        : latestSourceChanged
          ? '源码契约已通过校验，已应用本地机械修复'
          : '源码契约已通过校验'
      const buildDetail = compiledFirmware
        ? `自动编译验证已通过${workflowOutcome.buildRepairAttempts > 0 ? `，编译自动修复 ${workflowOutcome.buildRepairAttempts} 轮` : ''}`
        : '自动编译验证未运行'
      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'validate-source', WORKFLOW_STEP_STATUS.DONE, `${sourceDetail}；${buildDetail}`))
      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'apply-source', WORKFLOW_STEP_STATUS.ACTIVE, '写入编辑器'))
      onInsertCode?.(finalFiles, {
        manifest,
        selectedSkills: manifest.skillIds,
        autoPreview: true,
      })
      if (compiledFirmware) {
        onCompileArtifact?.({
          firmware: compiledFirmware,
          buildEvidence: compiledFirmware.buildEvidence || null,
          projectFiles: finalFiles,
          selectedSkills: manifest.skillIds,
          manifest,
          autoFlash: true,
          source: 'ai-auto-compile',
        })
      }
      setInput('')
      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, 'apply-source', WORKFLOW_STEP_STATUS.DONE, `${Object.keys(finalFiles).length} 个文件已写入`))
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: `已通过源码自检和自动编译验证，并写入左侧编辑器，共 ${Object.keys(finalFiles).length} 个应用文件：\n\n${Object.keys(finalFiles).map(path => `- ${path}`).join('\n')}\n\n${sourceDetail}\n${buildDetail}\n编译产物已保存，可直接烧录；检测到已授权 USB 串口时会自动开始 USB 直刷。\n使用技能：${manifest.skillIds.join(', ') || 'none'}`,
          manifest,
        }
        return next
      })
    } catch (err) {
      setGenerationWorkflow(prev => updateGenerationWorkflow(prev, prev.activeStep || 'intent', WORKFLOW_STEP_STATUS.FAILED, err.message))
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `生成失败：${err.message}`, error: true }
        return next
      })
    } finally {
      setGenerating(false)
    }
  }

  async function repairBuildFailure(request) {
    if (generating || streaming || !hasConfig) return
    setGenerating(true)
    setKnowledgeCard(null)
    setMessages(prev => [
      ...prev,
      { role: 'user', content: '请根据编译错误自动修复当前应用源码。' },
      { role: 'assistant', content: '正在分析 Build Evidence 并生成源码补丁...' },
    ])
    try {
      const content = await runVibeBoardAgentTask(
        AGENT_TASK_TYPES.REPAIR_BUILD,
        buildBuildRepairMessages({
          board,
          selectedSkills: request.selectedSkills || selectedSkills,
          buildEvidence: request.buildEvidence,
          buildLog: request.buildLog,
          errorLog: request.errorLog,
          projectFiles: request.projectFiles,
          manifest: request.manifest || latestManifest,
          activeFile: request.activeFile || activeFile,
          recentDeviceEvidence: request.recentDeviceEvidence || recentDeviceEvidence,
        }),
        {
          buildEvidence: request.buildEvidence,
          repairContext: request.buildEvidence?.repairContext || null,
          recentDeviceEvidence: request.recentDeviceEvidence || recentDeviceEvidence,
        }
      )
      const parsed = parseGeneratedFilesResponseWithOptions(content, board, {
        requireCompleteProject: false,
        validateManifestFiles: false,
      })
      if (!parsed.ok) {
        const message = `修复补丁未通过校验：${parsed.errors.join(', ')}`
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: message, error: true }
          return next
        })
        return
      }
      onInsertCode?.(parsed.files)
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: `已应用 ${Object.keys(parsed.files).length} 个修复文件：\n\n${Object.keys(parsed.files).map(path => `- ${path}`).join('\n')}\n\n请重新编译验证。`,
        }
        return next
      })
    } catch (err) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `修复失败：${err.message}`, error: true }
        return next
      })
    } finally {
      setGenerating(false)
    }
  }

  async function repairPreviewFailure(request) {
    if (generating || streaming || !hasConfig) return
    setGenerating(true)
    setKnowledgeCard(null)
    setMessages(prev => [
      ...prev,
      { role: 'user', content: request.userFeedback || '请根据 LVGL 预览结果自动修复当前应用源码。' },
      { role: 'assistant', content: '正在分析当前项目和预览反馈，并生成定向修复补丁...' },
    ])
    try {
      const content = await completeChat({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: buildPreviewRepairMessages({
          board,
          selectedSkills: request.selectedSkills || selectedSkills,
          previewEvidence: request.previewEvidence,
          manifest: request.manifest,
          projectFiles: request.projectFiles,
          userFeedback: request.userFeedback,
        }),
      })
      const parsed = parseGeneratedFilesResponseWithOptions(content, board, {
        requireCompleteProject: false,
        validateManifestFiles: false,
      })
      if (!parsed.ok) {
        const message = `预览修复补丁未通过校验：${parsed.errors.join(', ')}`
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: message, error: true }
          return next
        })
        return
      }
      if (Object.keys(parsed.files).length === 0) {
        setMessages(prev => {
          const next = [...prev]
          next[next.length - 1] = { role: 'assistant', content: '预览修复没有返回可应用的文件修改。', error: true }
          return next
        })
        return
      }
      onInsertCode?.(parsed.files, {
        manifest: request.manifest,
        selectedSkills: request.selectedSkills || selectedSkills,
        autoPreview: true,
      })
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = {
          role: 'assistant',
          content: `已应用 ${Object.keys(parsed.files).length} 个预览修复文件：\n\n${Object.keys(parsed.files).map(path => `- ${path}`).join('\n')}\n\n正在重新生成预览。`,
        }
        return next
      })
    } catch (err) {
      setMessages(prev => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `预览修复失败：${err.message}`, error: true }
        return next
      })
    } finally {
      setGenerating(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      generateCodeFromInput()
    }
  }

  function handleStop() {
    abortRef.current?.()
    setStreaming(false)
  }

  function clearChat() {
    abortRef.current?.abort()
    setMessages([])
    setKnowledgeCard(null)
    setGenerationWorkflow(createGenerationWorkflow())
    setInput('')
    setStreaming(false)
    setGenerating(false)
    onResetProject?.()
  }

  function acceptKnowledge() {
    if (!knowledgeCard) return
    patchSkill(boardId, knowledgeCard.skillId, knowledgeCard.type, knowledgeCard.content)
    const patches = loadPatches()
    patches.push(knowledgeCard)
    savePatches(patches)
    setKnowledgeCard(null)
  }

  function CodeBlock({ children, className }) {
    const lang = className?.replace('language-', '') || 'c'
    const code = String(children).trim()
    return (
      <div className="code-block-wrap">
        <div className="code-block-header">
          <span className="code-lang">{lang}</span>
          <div className="code-actions">
            <button className="code-btn" onClick={() => navigator.clipboard.writeText(code)}>复制</button>
          </div>
        </div>
        <SyntaxHighlighter
          style={vscDarkPlus}
          language={lang}
          customStyle={{ margin: 0, borderRadius: '0 0 6px 6px', fontSize: '12px' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    )
  }

  function ManifestPreview({ manifest }) {
    if (!manifest) return null
    return (
      <div className="manifest-preview">
        <div className="manifest-preview-header">
          <span>Program Manifest</span>
          <span className="manifest-program">{manifest.programName || 'vibe_app'}</span>
        </div>
        <div className="manifest-grid">
          <div>
            <span className="manifest-label">Skills</span>
            <span>{manifest.skillIds?.join(', ') || 'none'}</span>
          </div>
          <div>
            <span className="manifest-label">Contracts</span>
            <span>{manifest.driverContracts?.join(', ') || 'none'}</span>
          </div>
          <div>
            <span className="manifest-label">Runtime</span>
            <span>{manifest.runtimeServices?.join(', ') || 'none'}</span>
          </div>
          <div>
            <span className="manifest-label">Entry</span>
            <span>{manifest.entry}</span>
          </div>
        </div>
        <div className="manifest-files">
          {(manifest.files || []).map(file => (
            <span key={`${file.role}:${file.path}`} className="manifest-file">{file.role}: {file.path}</span>
          ))}
        </div>
        {manifest.acceptanceChecks?.length > 0 && (
          <div className="manifest-checks">
            {manifest.acceptanceChecks.map(check => <span key={check}>{check}</span>)}
          </div>
        )}
      </div>
    )
  }

  function WorkflowStrip({ workflow }) {
    if (!workflow || workflow.status === 'idle') return null
    return (
      <div className={`workflow-strip ${workflow.status}`}>
        {workflow.steps.map(step => (
          <div key={step.id} className={`workflow-step ${step.status}`}>
            <span className="workflow-step-dot" />
            <span className="workflow-step-label">{step.label}</span>
          </div>
        ))}
      </div>
    )
  }

  function AcceptanceStrip({ acceptanceState = null }) {
    if (!acceptanceState) return null
    const statusLabel = {
      passes: '验收通过',
      'needs-observation': '等待观察',
      failed: '验收失败',
    }[acceptanceState.status] || '等待观察'
    return (
      <div className={`acceptance-strip ${acceptanceState.status}`}>
        <div className="acceptance-summary">
          <span className="acceptance-title">Acceptance</span>
          <span>{statusLabel}</span>
          <span className="acceptance-note">{acceptanceState.summary}</span>
        </div>
        {acceptanceState.checks?.length > 0 && (
          <div className="acceptance-checks">
            {acceptanceState.checks.map(check => (
              <span key={check.text} className={`acceptance-check ${check.status}`}>{check.text}</span>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-title">
          <span className="chat-icon">🤖</span>
          <span>AI 代码助手</span>
        </div>
        <div className="chat-header-actions">
          {messages.length > 0 && (
            <button className="icon-btn" onClick={clearChat} title="清空对话并重置工程">🗑</button>
          )}
          <div className={`status-dot ${hasConfig ? 'online' : 'offline'}`} title={hasConfig ? settings.model : '未配置 API'} />
        </div>
      </div>

      <div className="board-badge">
        <span className="board-chip">{board.chip}</span>
        <span className="board-name">{board.name}</span>
        <span className="board-idf">IDF {board.idfVersion}</span>
      </div>

      <div className="skill-selector">
        <span className="skill-selector-label">外设模块：</span>
        {board.skills.map(skill => (
          <button
            key={skill.id}
            className={`skill-tag ${selectedSkills.includes(skill.id) ? 'active' : ''}`}
            onClick={() => toggleSkill(skill.id)}
          >
            {skill.label}
          </button>
        ))}
      </div>

      <WorkflowStrip workflow={generationWorkflow} />
      <AcceptanceStrip acceptanceState={acceptanceState} />

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">⚡</div>
            <p>已注入硬件上下文包</p>
            <p className="chat-empty-sub">选择外设模块后，AI 会注入对应详细文档</p>
            <div className="quick-prompts">
              {quickPrompts.map(q => (
                <button key={q} className="quick-btn" onClick={() => generateCodeFromInput(q)}>{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            <div className="message-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
            <div className="message-content">
              {msg.role === 'assistant' ? (
                <ReactMarkdown
                  components={{
                    code({ inline, className, children }) {
                      if (inline) return <code className="inline-code">{children}</code>
                      return <CodeBlock className={className}>{children}</CodeBlock>
                    }
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              ) : (
                <p>{msg.content}</p>
              )}
              {streaming && i === messages.length - 1 && msg.role === 'assistant' && (
                <span className="cursor-blink">▋</span>
              )}
              {msg.role === 'assistant' && msg.manifest && (
                <ManifestPreview manifest={msg.manifest} />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {knowledgeCard && (
        <div className="knowledge-card">
          <div className="knowledge-card-header">
            <span>💡 发现新知识</span>
            <span className="knowledge-skill-tag">{knowledgeCard.skillId}</span>
          </div>
          <div className="knowledge-card-body">
            <span className="knowledge-type">{knowledgeCard.type === 'pitfall' ? '⚠ 陷阱' : '✓ 用法'}</span>
            {knowledgeCard.content}
          </div>
          <div className="knowledge-card-actions">
            <button className="knowledge-btn accept" onClick={acceptKnowledge}>写入 Skill</button>
            <button className="knowledge-btn dismiss" onClick={() => setKnowledgeCard(null)}>忽略</button>
          </div>
        </div>
      )}

      <div className="chat-input-area">
        {!hasConfig && (
          <div className="no-config-hint">⚠️ 请点击右上角 ⚙ 配置 AI API Key</div>
        )}
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasConfig ? '描述你需要的功能，AI 会结合开发板硬件信息生成代码...' : '请先配置 API Key'}
            disabled={!hasConfig || streaming || generating}
            rows={3}
          />
          <button
            className="send-btn generate"
            onClick={() => generateCodeFromInput()}
            disabled={!hasConfig || streaming || generating || !input.trim()}
          >
            {generating ? '生成中' : '生成代码'}
          </button>
          <button
            className={`send-btn ${streaming ? 'stop' : ''}`}
            onClick={streaming ? handleStop : () => sendMessage(input)}
            disabled={!hasConfig || generating || (!streaming && !input.trim())}
          >
            {streaming ? '■ 停止' : '解释'}
          </button>
        </div>
        <div className="chat-input-hint">生成代码会写入左侧应用文件 · 解释只聊天不改项目</div>
      </div>
    </div>
  )
}
