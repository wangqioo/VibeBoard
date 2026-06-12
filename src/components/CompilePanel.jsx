import { useState, useEffect, useRef } from 'react'
import { compileBleOtaReceiver, compileFirmware, compileOfficialExample, compileOtaReceiver, downloadBin, loadOfficialExamples } from '../utils/compiler'
import { getDeviceInfo, pushOta, loadOtaIp, saveOtaIp } from '../utils/ota'
import { connectBle } from '../utils/bleOta'
import { getPairedSerialDebugPorts, isSerialAutoConnectBlocked } from '../utils/logStream'
import {
  flashAppOnlyOverUsb,
  isWebSerialSupported,
  notifyUsbFlashFinished,
  releaseUsbLogPortForFlash,
  waitForUsbPortSettle,
  webSerialUnavailableReason,
} from '../utils/usbFlash'
import { createRemoteOtaJob, formatLastSeen, getRemoteOtaJob, isDeviceOnline, listRemoteDevices, uploadFirmwareForRemoteOta } from '../utils/remoteOta'
import { assembleCompileFiles } from '../utils/projectAssembly'
import { OFFICIAL_EXAMPLES, getOfficialExample } from '../data/officialExamples'
import { createBuildEvidence } from '../domain/evidence/buildEvidence'
import { createDeliveryDeviceEvidence } from '../domain/evidence/deviceEvidence'
import './CompilePanel.css'

const BUILD = {
  idle: { label: '▶ 编译', cls: '' },
  building: { label: '⏳ 编译中...', cls: 'building' },
  ok: { label: '✓ 编译成功', cls: 'ok' },
  error: { label: '✕ 编译失败', cls: 'error' },
}
const OTA = {
  idle: { label: '→ 推送 OTA', cls: '' },
  pushing: { label: '→ 推送中...', cls: 'building' },
  ok: { label: '✓ 烧录成功', cls: 'ok' },
  error: { label: '✕ 推送失败', cls: 'error' },
}
const BLE = {
  idle: { label: 'BLE 烧录', cls: '' },
  connecting: { label: '⬆ 配对中...', cls: 'building' },
  flashing: { label: '⬆ 烧录中...', cls: 'building' },
  ok: { label: '✓ BLE 成功', cls: 'ok' },
  error: { label: '✕ BLE 失败', cls: 'error' },
}
const USB = {
  idle: { label: 'USB 直刷', cls: '' },
  flashing: { label: 'USB 烧录中...', cls: 'building' },
  ok: { label: 'USB 成功', cls: 'ok' },
  error: { label: 'USB 失败', cls: 'error' },
}
const REMOTE = {
  idle: { label: '远程 OTA', cls: '' },
  uploading: { label: '上传固件...', cls: 'building' },
  queued: { label: '等待设备领取', cls: 'building' },
  done: { label: '远程完成', cls: 'ok' },
  error: { label: '远程失败', cls: 'error' },
}

function summarizeCompileError(errorLog, buildLog) {
  if (errorLog) return errorLog
  const lines = buildLog.map(line => line.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean)
  const firstError = lines.findIndex(line =>
    /CMake Error|fatal error| error:|FAILED:|undefined reference|cmake failed|ninja: build stopped/i.test(line)
  )
  if (firstError === -1) return lines.slice(-20).join('\n')
  return lines.slice(firstError, Math.min(lines.length, firstError + 14)).join('\n')
}

function formatBuildEvidenceValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value)) return value.filter(Boolean).join(', ')
  return String(value)
}

function copyTextFallback(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('copy failed')
}

export default function CompilePanel({
  projectFiles: sourceProp,
  selectedSkills,
  boardId,
  projectId,
  manifest = null,
  initialFirmware = null,
  initialBuildEvidence = null,
  initialBuildStatus = '',
  initialAutoFlash = false,
  onCompileArtifact,
  onConsumeInitialAutoFlash,
  onClose,
  onRepairBuildFailure,
  onDeviceEvidence,
}) {
  const [compileMode, setCompileMode] = useState('project')
  const [officialExampleId, setOfficialExampleId] = useState(OFFICIAL_EXAMPLES[0]?.id || '')
  const [serverExamples, setServerExamples] = useState([])
  const [otaWifiSsid, setOtaWifiSsid] = useState('1-306')
  const [otaWifiPassword, setOtaWifiPassword] = useState('szyt1008')
  const [agentServerUrl, setAgentServerUrl] = useState(() => window.location.origin)
  const [agentDeviceId, setAgentDeviceId] = useState('szpi-s3-ota-receiver')
  const [agentDeviceToken, setAgentDeviceToken] = useState('vibeboard-ota-receiver')
  const [buildState, setBuildState] = useState('idle')
  const [otaState, setOtaState] = useState('idle')
  const [status, setStatus] = useState('')
  const [errorLog, setErrorLog] = useState('')
  const [firmware, setFirmware] = useState(null)
  const [otaIp, setOtaIp] = useState(loadOtaIp)
  const [deviceInfo, setDeviceInfo] = useState(null)
  const [otaProgress, setOtaProgress] = useState(0)
  const [bleState, setBleState] = useState('idle')
  const [bleProgress, setBleProgress] = useState(0)
  const [usbState, setUsbState] = useState('idle')
  const [usbProgress, setUsbProgress] = useState(0)
  const [remoteState, setRemoteState] = useState('idle')
  const [remoteDevices, setRemoteDevices] = useState([])
  const [remoteDeviceId, setRemoteDeviceId] = useState('')
  const [remoteJob, setRemoteJob] = useState(null)
  const [showFiles, setShowFiles] = useState(false)
  const [buildLog, setBuildLog] = useState([])
  const [copyState, setCopyState] = useState('idle')
  const [buildEvidence, setBuildEvidence] = useState(null)
  const logEndRef = useRef(null)
  const autoFlashAttemptedRef = useRef(false)
  const officialExample = getOfficialExample(officialExampleId)
  const availableExampleIds = new Set(serverExamples.map(example => example.id))
  const selectedServerExample = serverExamples.find(example => example.id === officialExampleId)
  const officialExampleAvailable = compileMode !== 'official' || availableExampleIds.has(officialExampleId)

  const { files: compileProjectFiles, mainFile, compilePackage } = assembleCompileFiles({
    boardId,
    projectFiles: sourceProp || {},
    selectedSkills: selectedSkills || [],
  })

  useEffect(() => {
    const hasReusableProjectFirmware = compileMode === 'project' && initialFirmware
    setBuildState('idle')
    setOtaState('idle')
    setBleState('idle')
    setUsbState('idle')
    setRemoteState('idle')
    setFirmware(hasReusableProjectFirmware ? initialFirmware : null)
    setBuildEvidence(hasReusableProjectFirmware ? (initialBuildEvidence || initialFirmware.buildEvidence || null) : null)
    setErrorLog('')
    setStatus(hasReusableProjectFirmware ? (initialBuildStatus || `编译成功 · ${(initialFirmware.size / 1024).toFixed(1)} KB`) : '')
    setBuildState(hasReusableProjectFirmware ? 'ok' : 'idle')
    autoFlashAttemptedRef.current = false
  }, [sourceProp, selectedSkills, boardId, compileMode, officialExampleId, initialFirmware, initialBuildEvidence, initialBuildStatus])
  useEffect(() => {
    let cancelled = false
    function refresh() {
      listRemoteDevices()
        .then(devices => {
          if (cancelled) return
          setRemoteDevices(devices)
          if (!remoteDeviceId) {
            const onlineDevice = devices.find(device => isDeviceOnline(device))
            if (onlineDevice) setRemoteDeviceId(onlineDevice.deviceId)
          }
        })
        .catch(() => {
          if (!cancelled) setRemoteDevices([])
        })
    }
    refresh()
    const timer = setInterval(refresh, 10000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [remoteDeviceId])
  useEffect(() => {
    let cancelled = false
    loadOfficialExamples()
      .then(examples => {
        if (cancelled) return
        setServerExamples(examples)
        if (examples.length > 0 && !examples.some(example => example.id === officialExampleId)) {
          setOfficialExampleId(examples[0].id)
        }
      })
      .catch(() => {
        if (!cancelled) setServerExamples([])
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line
  useEffect(() => {
    if (!otaIp) return
    let cancelled = false
    getDeviceInfo(otaIp)
      .then(info => { if (!cancelled) setDeviceInfo(info) })
      .catch(() => { if (!cancelled) setDeviceInfo(null) })
    return () => { cancelled = true }
  }, [otaIp])

  async function handleCompile() {
    setBuildState('building')
    setOtaState('idle')
    setErrorLog('')
    setCopyState('idle')
    setBuildLog([])
    setBuildEvidence(null)
    setFirmware(null)
    setStatus('正在连接编译服务器...')

    try {
      let blob
      if (compileMode === 'official') {
        if (!officialExampleAvailable) throw new Error(`官方例程未上传到编译服务器: ${officialExampleId}`)
        blob = await compileOfficialExample(officialExampleId, setStatus, line => {
          setBuildLog(prev => [...prev, line])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        })
      } else if (compileMode === 'ota-receiver') {
        if (!otaWifiSsid.trim()) throw new Error('请先填写 WiFi SSID')
        blob = await compileOtaReceiver({
          wifiSsid: otaWifiSsid.trim(),
          wifiPassword: otaWifiPassword,
          serverUrl: agentServerUrl.trim(),
          deviceId: agentDeviceId.trim(),
          deviceToken: agentDeviceToken.trim(),
        }, setStatus, line => {
          setBuildLog(prev => [...prev, line])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        })
      } else if (compileMode === 'ble-ota-receiver') {
        blob = await compileBleOtaReceiver(setStatus, line => {
          setBuildLog(prev => [...prev, line])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        })
      } else {
        if (!compilePackage.ok) {
          const preflightEvidence = createBuildEvidence({
            status: 'failure',
            command: 'preflight-project-assembly',
            error: compilePackage.message,
            logLines: compilePackage.diagnostics || [],
          })
          setErrorLog(compilePackage.message)
          setBuildEvidence(preflightEvidence)
          setStatus('编译前检查失败')
          setBuildState('error')
          return
        }

        const mainPath = Object.keys(compileProjectFiles).find(k => k === mainFile || k === `main/${mainFile}` || k.endsWith(`/${mainFile}`)) || mainFile
        const code = compileProjectFiles[mainPath] || ''
        const compilerFiles = compilePackage.backendProjectFiles || compileProjectFiles
        const configFiles = Object.fromEntries(Object.entries(compilerFiles).filter(([k]) => !k.startsWith('__') && k !== mainPath))
        const compileMetadata = Object.fromEntries(Object.entries(compilerFiles).filter(([k]) => k === '__mainFile'))
        blob = await compileFirmware(code, { ...configFiles, ...compileMetadata }, setStatus, line => {
          setBuildLog(prev => [...prev, line])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        }, { projectId })
      }
      setFirmware(blob)
      setBuildEvidence(blob.buildEvidence || null)
      setStatus(`编译成功 · ${(blob.size / 1024).toFixed(1)} KB`)
      setBuildState('ok')
      if (compileMode === 'project') {
        onCompileArtifact?.({
          firmware: blob,
          buildEvidence: blob.buildEvidence || null,
          projectFiles: sourceProp || {},
          selectedSkills: selectedSkills || [],
          manifest,
          source: 'manual-compile',
        })
      }
    } catch (e) {
      setBuildEvidence(e.buildEvidence || null)
      setErrorLog(e.message)
      setStatus('编译失败，查看错误日志')
      setBuildState('error')
    }
  }

  async function handleCopyLog(text) {
    if (!text) return
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
      } else {
        copyTextFallback(text)
      }
      setCopyState('ok')
      setTimeout(() => setCopyState('idle'), 1500)
    } catch {
      try {
        copyTextFallback(text)
        setCopyState('ok')
        setTimeout(() => setCopyState('idle'), 1500)
      } catch {
        setCopyState('error')
      }
    }
  }

  async function handleOta() {
    if (!firmware || !otaIp) return
    saveOtaIp(otaIp)
    setOtaState('pushing')
    setOtaProgress(0)
    setStatus('正在推送固件...')
    try {
      await pushOta(otaIp, firmware, pct => {
        setOtaProgress(pct)
        setStatus(`推送中... ${pct}%`)
      })
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'wifi-ota',
        message: '固件推送成功，设备正在重启...',
        deliveryResult: { status: 'success', ip: otaIp, firmwareSize: firmware.size, progress: 100 },
        deviceInfo,
      }))
      setStatus('固件推送成功，设备正在重启...')
      setOtaState('ok')
      setDeviceInfo(null)
    } catch (e) {
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'wifi-ota',
        deliveryResult: { status: 'failure', error: e.message, ip: otaIp, firmwareSize: firmware.size, progress: otaProgress },
        deviceInfo,
      }))
      setErrorLog(e.message)
      setStatus('OTA 推送失败')
      setOtaState('error')
    }
  }

  async function handleBleFlash() {
    if (!firmware) return
    setBleState('connecting')
    setBleProgress(0)
    setStatus('请在弹窗中选择 ESP32-Vibe-OTA 设备...')
    let session
    try {
      session = await connectBle()
      setBleState('flashing')
      setStatus(`BLE 已连接 ${session.deviceName}，开始烧录...`)
    } catch (e) {
      setBleState('error')
      setStatus('BLE 连接失败: ' + e.message)
      return
    }
    try {
      const buf = await firmware.arrayBuffer()
      await session.flash(buf, ({ sent, total, percent }) => {
        setBleProgress(percent)
        setStatus(`BLE 烧录中... ${percent}%  (${(sent / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB)`)
      })
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'ble-ota',
        message: 'BLE 烧录成功，设备正在重启...',
        deliveryResult: { status: 'success', deviceName: session.deviceName, firmwareSize: firmware.size, progress: 100 },
        deviceInfo: { name: session.deviceName },
      }))
      setStatus('BLE 烧录成功，设备正在重启...')
      setBleState('ok')
    } catch (e) {
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'ble-ota',
        deliveryResult: { status: 'failure', error: e.message, deviceName: session?.deviceName, firmwareSize: firmware.size, progress: bleProgress },
        deviceInfo: session?.deviceName ? { name: session.deviceName } : null,
      }))
      setErrorLog(e.message)
      setStatus('BLE 烧录失败')
      setBleState('error')
    } finally {
      session?.disconnect?.()
    }
  }

  async function handleUsbFlash({ port = null, automatic = false } = {}) {
    if (!firmware) return
    setUsbState('flashing')
    setUsbProgress(0)
    setErrorLog('')
    setStatus('正在释放 USB 串口日志连接...')
    try {
      await releaseUsbLogPortForFlash({
        onLog: line => {
          setBuildLog(prev => [...prev, `[usb] ${line}`])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        },
      })
      await waitForUsbPortSettle()
      setStatus(automatic ? '检测到已授权 ESP32-S3 USB 串口，开始自动烧录...' : '请选择 ESP32-S3 USB 串口设备...')
      await flashAppOnlyOverUsb({
        firmware,
        port,
        onProgress: pct => {
          setUsbProgress(pct)
          setStatus(`USB 烧录中... ${pct}%`)
        },
        onLog: line => {
          setBuildLog(prev => [...prev, `[usb] ${line}`])
          setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 0)
        },
      })
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'usb',
        message: 'USB 烧录完成，设备已复位',
        deliveryResult: { status: 'success', automatic, firmwareSize: firmware.size, progress: 100 },
      }))
      setStatus('USB 烧录完成，设备已复位')
      setUsbState('ok')
    } catch (e) {
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'usb',
        deliveryResult: { status: 'failure', error: e.message, automatic, firmwareSize: firmware.size, progress: usbProgress },
      }))
      setErrorLog(e.message)
      setStatus('USB 烧录失败')
      setUsbState('error')
    } finally {
      notifyUsbFlashFinished()
    }
  }

  useEffect(() => {
    if (!initialAutoFlash || autoFlashAttemptedRef.current) return
    if (compileMode !== 'project' || buildState !== 'ok' || !firmware) return

    autoFlashAttemptedRef.current = true
    onConsumeInitialAutoFlash?.()

    async function autoFlashIfPossible() {
      if (!isWebSerialSupported()) {
        setStatus(`AI 已自动编译成功；${webSerialUnavailableReason()}`)
        return
      }
      if (isSerialAutoConnectBlocked()) {
        setStatus('AI 已自动编译成功；USB 串口已手动断开，未自动烧录')
        return
      }
      const ports = await getPairedSerialDebugPorts()
      if (ports.length === 0) {
        setStatus('AI 已自动编译成功；未检测到已授权 USB 串口，可点击 USB 直刷手动选择')
        return
      }
      await handleUsbFlash({ port: ports[0], automatic: true })
    }

    autoFlashIfPossible().catch(err => {
      setErrorLog(err.message)
      setStatus('自动 USB 烧录失败')
      setUsbState('error')
      notifyUsbFlashFinished()
    })
  }, [initialAutoFlash, compileMode, buildState, firmware]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRemoteOta() {
    if (!firmware || !remoteDeviceId) return
    const selectedDevice = remoteDevices.find(device => device.deviceId === remoteDeviceId)
    if (!isDeviceOnline(selectedDevice)) {
      setRemoteState('error')
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'remote-ota',
        deliveryResult: {
          status: 'failure',
          error: '远程设备当前不在线。设备心跳每 10 秒一次，30 秒内没有心跳就不会下发 OTA。',
          deviceId: remoteDeviceId,
          firmwareSize: firmware.size,
        },
        deviceInfo: selectedDevice || { deviceId: remoteDeviceId },
      }))
      setErrorLog('远程设备当前不在线。设备心跳每 10 秒一次，30 秒内没有心跳就不会下发 OTA。')
      setStatus('远程 OTA 失败')
      return
    }
    setRemoteState('uploading')
    setRemoteJob(null)
    setErrorLog('')
    setStatus('正在上传固件到服务器...')
    try {
      const remoteFirmware = await uploadFirmwareForRemoteOta(firmware)
      setStatus('正在创建远程 OTA 任务...')
      const job = await createRemoteOtaJob({
        deviceId: remoteDeviceId,
        firmwareId: remoteFirmware.firmwareId,
      })
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'remote-ota',
        message: '远程 OTA 已下发，等待设备领取',
        deliveryResult: { ...job, firmwareSize: firmware.size },
        deviceInfo: selectedDevice || { deviceId: remoteDeviceId },
      }))
      setRemoteJob(job)
      setRemoteState('queued')
      setStatus(`远程 OTA 已下发，等待设备领取：${job.jobId.slice(0, 8)}`)
    } catch (e) {
      onDeviceEvidence?.(createDeliveryDeviceEvidence({
        transport: 'remote-ota',
        deliveryResult: { status: 'failure', error: e.message, deviceId: remoteDeviceId, firmwareSize: firmware.size },
        deviceInfo: selectedDevice || { deviceId: remoteDeviceId },
      }))
      setErrorLog(e.message)
      setStatus('远程 OTA 失败')
      setRemoteState('error')
    }
  }

  useEffect(() => {
    if (!remoteJob?.jobId || remoteState === 'done' || remoteState === 'error') return
    let cancelled = false
    const timer = setInterval(async () => {
      try {
        const job = await getRemoteOtaJob(remoteJob.jobId)
        if (cancelled) return
        setRemoteJob(job)
        if (job.status === 'done' || job.status === 'flashed' || job.status === 'rebooting') {
          onDeviceEvidence?.(createDeliveryDeviceEvidence({
            transport: 'remote-ota',
            message: `远程 OTA 状态：${job.status}`,
            deliveryResult: { ...job, firmwareSize: firmware?.size || null },
            deviceInfo: remoteDevices.find(device => device.deviceId === job.deviceId) || { deviceId: job.deviceId },
          }))
          setRemoteState('done')
          setStatus(`远程 OTA 状态：${job.status}`)
        } else if (job.status === 'failed') {
          onDeviceEvidence?.(createDeliveryDeviceEvidence({
            transport: 'remote-ota',
            deliveryResult: { ...job, status: 'failure', error: job.error || '远程 OTA 失败', firmwareSize: firmware?.size || null },
            deviceInfo: remoteDevices.find(device => device.deviceId === job.deviceId) || { deviceId: job.deviceId },
          }))
          setRemoteState('error')
          setErrorLog(job.error || '远程 OTA 失败')
          setStatus('远程 OTA 失败')
        } else {
          setStatus(`远程 OTA 状态：${job.status}`)
        }
      } catch {
        // Keep the existing state; the next poll may recover.
      }
    }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [remoteJob?.jobId, remoteState])

  const b = BUILD[buildState]
  const o = OTA[otaState]
  const bl = BLE[bleState]
  const us = USB[usbState]
  const rm = REMOTE[remoteState]
  const failureSummary = buildState === 'error' ? summarizeCompileError(errorLog, buildLog) : ''
  const fullFailureLog = buildState === 'error' ? [...buildLog, errorLog].filter(Boolean).join('\n') : ''
  const firstFailingLocation = buildEvidence?.firstError?.file
    ? `${buildEvidence.firstError.file}${buildEvidence.firstError.lineNumber ? `:${buildEvidence.firstError.lineNumber}` : ''}`
    : (buildEvidence?.repairContext?.primaryFile
        ? `${buildEvidence.repairContext.primaryFile}${buildEvidence.repairContext.lineNumber ? `:${buildEvidence.repairContext.lineNumber}` : ''}`
        : null)
  const repairContextSummary = buildEvidence?.repairContext?.kind
    ? [
        buildEvidence.repairContext.kind,
        buildEvidence.repairContext.confidence ? `confidence ${buildEvidence.repairContext.confidence}` : null,
      ].filter(Boolean).join(' · ')
    : null
  const buildEvidenceRows = [
    { label: '失败分类', value: buildEvidence?.failureCategory || buildEvidence?.repairContext?.category },
    { label: '首个失败位置', value: firstFailingLocation },
    { label: '修复上下文', value: repairContextSummary },
    { label: '修复策略', value: buildEvidence?.repairContext?.repairStrategy || buildEvidence?.repairStrategy },
  ]
    .map(row => ({ ...row, value: formatBuildEvidenceValue(row.value) }))
    .filter(row => row.value)

  return (
    <div className="compile-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="compile-panel">
        <div className="compile-header">
          <span className="compile-title">编译、烧录与证据</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="compile-body">
          <div className="compile-mode-tabs">
            <button
              className={`compile-mode-tab ${compileMode === 'project' ? 'active' : ''}`}
              onClick={() => setCompileMode('project')}
            >
              当前工程
            </button>
            <button
              className={`compile-mode-tab ${compileMode === 'official' ? 'active' : ''}`}
              onClick={() => setCompileMode('official')}
            >
              官方例程
            </button>
            <button
              className={`compile-mode-tab ${compileMode === 'ota-receiver' ? 'active' : ''}`}
              onClick={() => setCompileMode('ota-receiver')}
            >
              OTA 基础固件
            </button>
            <button
              className={`compile-mode-tab ${compileMode === 'ble-ota-receiver' ? 'active' : ''}`}
              onClick={() => setCompileMode('ble-ota-receiver')}
            >
              BLE OTA 基础固件
            </button>
          </div>

          {compileMode === 'project' && (
            <div className="project-files-row">
              <span className="field-label" style={{ margin: 0 }}>系统生成文件</span>
              <button className="files-toggle" onClick={() => setShowFiles(v => !v)}>
                {showFiles ? '收起' : `查看 ${Object.keys(compileProjectFiles).filter(k => !k.startsWith('__')).length} 个文件`}
              </button>
            </div>
          )}

          {compileMode === 'ota-receiver' && (
            <div className="official-example-box">
              <label className="field-label">WiFi SSID</label>
              <input
                className="field-input"
                value={otaWifiSsid}
                onChange={e => setOtaWifiSsid(e.target.value)}
                placeholder="你的 WiFi 名称"
              />
              <label className="field-label">WiFi 密码</label>
              <input
                className="field-input"
                type="password"
                value={otaWifiPassword}
                onChange={e => setOtaWifiPassword(e.target.value)}
                placeholder="WiFi 密码，可为空"
              />
              <div className="compile-hint">
                这个固件会启动 HTTP OTA 服务：/ping、/info、/ota。首次需要用 USB/串口烧录；设备连上 WiFi 后，再用下面的 WiFi OTA 推送后续固件。
              </div>
              <label className="field-label">远程 OTA 服务器</label>
              <input
                className="field-input"
                value={agentServerUrl}
                onChange={e => setAgentServerUrl(e.target.value)}
                placeholder="https://your-vibeboard.example.com"
              />
              <label className="field-label">设备 ID</label>
              <input
                className="field-input"
                value={agentDeviceId}
                onChange={e => setAgentDeviceId(e.target.value)}
                placeholder="szpi-s3-lab-01"
              />
              <label className="field-label">设备 Token</label>
              <input
                className="field-input"
                value={agentDeviceToken}
                onChange={e => setAgentDeviceToken(e.target.value)}
                placeholder="用于设备鉴权"
              />
            </div>
          )}

          {compileMode === 'ble-ota-receiver' && (
            <div className="official-example-box">
              <div className="compile-hint">
                这个固件会广播 ESP32-Vibe-OTA，并启动 BLE GATT OTA 服务。首次需要用 USB/串口烧录；之后可以用下面的 BLE 烧录按钮推送新的 app 固件。BLE 传输较慢，适合作为无 WiFi 时的试验路径。
              </div>
            </div>
          )}

          {compileMode === 'official' && (
            <div className="official-example-box">
              <label className="field-label">官方例程</label>
              <select
                className="field-input official-example-select"
                value={officialExampleId}
                onChange={e => setOfficialExampleId(e.target.value)}
              >
                {OFFICIAL_EXAMPLES.map(example => (
                  <option key={example.id} value={example.id}>
                    {example.id} · {example.name}
                  </option>
                ))}
              </select>
              <div className="official-example-meta">
                <span>{officialExample?.description || 'Official ESP-IDF example'}</span>
                {selectedServerExample && (
                  <span>{selectedServerExample.fileCount} files{selectedServerExample.hasSpiffs ? ' · SPIFFS' : ''}</span>
                )}
              </div>
              <div className="compile-hint">
                官方例程从服务器原始工程目录直接编译，不读取左侧代码，不经过 AI，也不做源码修正。
              </div>
              {!officialExampleAvailable && (
                <div className="compile-status error">
                  这个官方例程还没有上传到编译服务器。
                </div>
              )}
            </div>
          )}

          {compileMode === 'project' && showFiles && (
            <div className="project-files-preview">
              {Object.entries(compileProjectFiles).filter(([name]) => !name.startsWith('__')).map(([name, content]) => (
                <details key={name}>
                  <summary>{name}</summary>
                  <pre>{content}</pre>
                </details>
              ))}
            </div>
          )}

          <div className="compile-primary-actions">
            <button className={`compile-btn primary ${b.cls}`} onClick={handleCompile} disabled={buildState === 'building'}>
              {b.label}
            </button>

            {buildState === 'error' && compileMode === 'project' && onRepairBuildFailure && (
              <button
                className="compile-btn repair"
                onClick={() => {
                  onRepairBuildFailure({
                    buildEvidence,
                    buildLog,
                    errorLog,
                    projectFiles: sourceProp || {},
                    selectedSkills: selectedSkills || [],
                  })
                  onClose?.()
                }}
              >
                AI 修复编译错误
              </button>
            )}
          </div>

          <div className="ota-section">
            <label className="field-label">设备 IP（WiFi OTA）</label>
            <div className="ota-ip-row">
              <input
                className="field-input"
                value={otaIp}
                onChange={e => { setOtaIp(e.target.value); setDeviceInfo(null) }}
                placeholder="192.168.1.88"
              />
              <div
                className={`device-dot ${deviceInfo ? 'online' : 'offline'}`}
                title={deviceInfo ? `${deviceInfo.version} RSSI: ${deviceInfo.rssi} dBm` : '未检测到设备'}
              />
            </div>
            {deviceInfo && (
              <div className="device-info">
                当前固件: <b>{deviceInfo.version}</b> · RSSI: {deviceInfo.rssi} dBm
              </div>
            )}
            {otaState === 'pushing' && (
              <div className="ota-progress-wrap">
                <div className="ota-progress-bar" style={{ width: `${otaProgress}%` }} />
                <span>{otaProgress}%</span>
              </div>
            )}
            <div className="compile-actions">
              <button className={`compile-btn ${o.cls}`} onClick={handleOta} disabled={!firmware || !otaIp || otaState === 'pushing'}>
                {o.label}
              </button>
              {buildState === 'ok' && (
                <button className="compile-btn download" onClick={() => downloadBin(firmware)}>
                  ↓ 下载 .bin
                </button>
              )}
            </div>
          </div>

          <div className="ota-section remote-section">
            <label className="field-label">远程 OTA（设备主动拉取）</label>
            <p className="compile-hint">
              设备运行 OTA 基础固件并配置服务器地址后，会主动上报在线状态并领取远程 OTA 任务；不需要和服务器在同一个局域网。
            </p>
            <select
              className="field-input"
              value={remoteDeviceId}
              onChange={e => setRemoteDeviceId(e.target.value)}
            >
              <option value="">选择远程设备</option>
              {remoteDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {isDeviceOnline(device) ? '在线' : '离线'} · {device.deviceId} · {device.version || 'unknown'}
                  {' · '}
                  {formatLastSeen(device)}
                </option>
              ))}
            </select>
            {remoteDevices.length === 0 && (
              <div className="compile-status">
                暂无远程设备。先编译并 USB 直刷带服务器地址的 OTA 基础固件。
              </div>
            )}
            {remoteJob && (
              <div className="device-info">
                任务 <b>{remoteJob.jobId.slice(0, 8)}</b> · 状态 <b>{remoteJob.status}</b>
                {remoteJob.error ? ` · ${remoteJob.error}` : ''}
              </div>
            )}
            <button
              className={`compile-btn remote-btn ${rm.cls}`}
              onClick={handleRemoteOta}
              disabled={!firmware || !remoteDeviceId || remoteState === 'uploading' || remoteState === 'queued'}
            >
              {rm.label}
            </button>
          </div>

          <div className="ota-section ble-section">
            <label className="field-label">USB 直刷（Web Serial）</label>
            <p className="compile-hint">
              使用 Chrome / Edge 选择 ESP32-S3 串口。编译结果带 flash 清单时会写入 bootloader、partition table、ota data 和 app；否则只更新 0x10000 的 app。
            </p>
            {!isWebSerialSupported() && (
              <div className="compile-status error">{webSerialUnavailableReason()}</div>
            )}
            {usbState === 'flashing' && (
              <div className="ota-progress-wrap">
                <div className="ota-progress-bar usb-bar" style={{ width: `${usbProgress}%` }} />
                <span>{usbProgress}%</span>
              </div>
            )}
            <button className={`compile-btn usb-btn ${us.cls}`} onClick={handleUsbFlash} disabled={!firmware || usbState === 'flashing' || !isWebSerialSupported()}>
              {us.label}
            </button>
          </div>

          <div className="ota-section ble-section">
            <label className="field-label">BLE 烧录（试验）</label>
            <p className="compile-hint">
              需要设备已运行 BLE OTA 基础固件并广播 ESP32-Vibe-OTA。首次仍需 USB 直刷基础固件；后续才能用 BLE 更新 app。
            </p>
            {bleState === 'flashing' && (
              <div className="ota-progress-wrap">
                <div className="ota-progress-bar ble-bar" style={{ width: `${bleProgress}%` }} />
                <span>{bleProgress}%</span>
              </div>
            )}
            <button className={`compile-btn ble-btn ${bl.cls}`} onClick={handleBleFlash} disabled={!firmware || bleState === 'connecting' || bleState === 'flashing'}>
              {bl.label}
            </button>
          </div>

          {status && (
            <div className={`compile-status ${otaState === 'ok' ? 'ok' : buildState}`}>
              {status}
            </div>
          )}
          {buildState === 'error' && buildEvidence && buildEvidenceRows.length > 0 && (
            <section className="build-evidence-panel" aria-label="编译证据">
              <div className="build-evidence-title">编译证据</div>
              <dl className="build-evidence-grid">
                {buildEvidenceRows.map(row => (
                  <div className="build-evidence-row" key={row.label}>
                    <dt className="build-evidence-label">{row.label}</dt>
                    <dd className="build-evidence-value">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {failureSummary && (
            <div className="log-wrap">
              <div className="log-toolbar error">
                <span>错误概要</span>
                <button className="copy-log-btn" onClick={() => handleCopyLog(failureSummary)}>
                  {copyState === 'ok' ? '已复制' : copyState === 'error' ? '复制失败' : '复制概要'}
                </button>
              </div>
              <pre className="compile-log error-log summary-log">{failureSummary}</pre>
            </div>
          )}
          {buildLog.length > 0 && (
            <details className="log-wrap full-log-wrap" open={buildState !== 'error'}>
              <summary className="log-toolbar">
                <span>完整编译日志</span>
                {buildState === 'error' && (
                  <button className="copy-log-btn" onClick={e => { e.preventDefault(); handleCopyLog(fullFailureLog) }}>
                    {copyState === 'ok' ? '已复制' : copyState === 'error' ? '复制失败' : '复制完整日志'}
                  </button>
                )}
              </summary>
              <pre className="compile-log build-log">
                {buildLog.join('\n')}
                <span ref={logEndRef} />
              </pre>
            </details>
          )}
          {errorLog && buildLog.length === 0 && !failureSummary && (
            <div className="log-wrap">
              <div className="log-toolbar error">
                <span>错误日志</span>
                <button className="copy-log-btn" onClick={() => handleCopyLog(errorLog)}>
                  {copyState === 'ok' ? '已复制' : copyState === 'error' ? '复制失败' : '复制错误日志'}
                </button>
              </div>
              <pre className="compile-log error-log">{errorLog}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
