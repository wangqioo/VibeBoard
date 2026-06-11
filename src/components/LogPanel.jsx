import { useState, useRef, useEffect, useCallback } from 'react'
import {
  createWsLogStream, createSerialLogStream,
  describeSerialPort, getPairedSerialDebugPorts, isWebSerialSupported,
  parseLine, LEVEL_COLOR, SERIAL_AUTO_CONNECT_KEY,
} from '../utils/logStream'
import { loadOtaIp } from '../utils/ota'
import {
  USB_FLASH_FINISHED_EVENT,
  USB_LOG_RELEASE_REQUEST_EVENT,
  USB_LOG_RELEASED_EVENT,
} from '../utils/usbFlash'
import { createDeviceEvidence } from '../domain/evidence/deviceEvidence'
import './LogPanel.css'

const MAX_LINES = 1000
const SERIAL_AUTO_POLL_MS = 2000
const SERIAL_AUTO_ERROR_COOLDOWN_MS = 8000

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

export default function LogPanel({ onAnalyze, onDeviceEvidence }) {
  const [lines,      setLines]      = useState([])
  const [filter,     setFilter]     = useState('')    // level filter E/W/I/D/V/all
  const [search,     setSearch]     = useState('')
  const [source,     setSource]     = useState('wifi') // 'wifi' | 'serial'
  const [wifiIp,     setWifiIp]     = useState(loadOtaIp)
  const [connStatus, setConnStatus] = useState('idle') // idle|connecting|connected|disconnected|error
  const [autoScroll, setAutoScroll] = useState(true)
  const [serialHint, setSerialHint] = useState('')
  const [copyState,  setCopyState]  = useState('idle')

  const streamRef  = useRef(null)
  const bottomRef  = useRef(null)
  const listRef    = useRef(null)
  const sourceRef  = useRef(source)
  const statusRef  = useRef(connStatus)
  const autoSerialBlockedRef = useRef(localStorage.getItem(SERIAL_AUTO_CONNECT_KEY) === 'blocked')
  const autoSerialPausedForFlashRef = useRef(false)
  const autoSerialCooldownUntilRef = useRef(0)

  /* Auto-scroll */
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  /* Detect manual scroll up → disable auto-scroll */
  function handleScroll() {
    if (!listRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = listRef.current
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40)
  }

  const addLine = useCallback((raw, src) => {
    const parsed = parseLine(raw.trimEnd())
    setLines(prev => {
      const next = [...prev, { ...parsed, src, id: Date.now() + Math.random() }]
      const trimmed = next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      const deviceEvidence = createDeviceEvidence({
        source: src,
        status: 'observed',
        lines: trimmed.map(line => line.raw),
      })
      onDeviceEvidence?.(deviceEvidence)
      return trimmed
    })
  }, [onDeviceEvidence])

  useEffect(() => { sourceRef.current = source }, [source])
  useEffect(() => { statusRef.current = connStatus }, [connStatus])

  function updateStatus(s) {
    if (s === 'disconnected') {
      streamRef.current = null
    }
    setConnStatus(s)
  }

  const connectSerialPort = useCallback(async (port, { automatic = false } = {}) => {
    streamRef.current?.stop()
    setSource('serial')
    setLines(prev => automatic ? prev : [])
    setConnStatus('connecting')
    setSerialHint(`${automatic ? '自动连接' : '连接'} ${describeSerialPort(port)}`)

    try {
      streamRef.current = await createSerialLogStream(addLine, updateStatus, { port })
      autoSerialBlockedRef.current = false
      localStorage.removeItem(SERIAL_AUTO_CONNECT_KEY)
    } catch (e) {
      streamRef.current = null
      autoSerialCooldownUntilRef.current = Date.now() + SERIAL_AUTO_ERROR_COOLDOWN_MS
      setConnStatus('error')
      addLine(`[错误] ${e.message}`, 'serial')
    }
  }, [addLine])

  async function connect() {
    streamRef.current?.stop()
    setLines([])
    setConnStatus('connecting')

    try {
      if (source === 'wifi') {
        streamRef.current = createWsLogStream(wifiIp, addLine, updateStatus)
      } else {
        autoSerialBlockedRef.current = false
        localStorage.removeItem(SERIAL_AUTO_CONNECT_KEY)
        setSerialHint('')
        streamRef.current = await createSerialLogStream(addLine, updateStatus)
      }
    } catch (e) {
      streamRef.current = null
      if (source === 'serial') {
        autoSerialCooldownUntilRef.current = Date.now() + SERIAL_AUTO_ERROR_COOLDOWN_MS
      }
      setConnStatus('error')
      addLine(`[错误] ${e.message}`, source)
    }
  }

  function disconnect() {
    streamRef.current?.stop()
    streamRef.current = null
    if (sourceRef.current === 'serial') {
      autoSerialBlockedRef.current = true
      localStorage.setItem(SERIAL_AUTO_CONNECT_KEY, 'blocked')
      setSerialHint('已手动断开 USB 串口自动连接')
    }
    setConnStatus('idle')
  }

  async function copyLogLines() {
    const text = lines.map(line => line.raw).join('\n')
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
        setTimeout(() => setCopyState('idle'), 1500)
      }
    }
  }

  useEffect(() => {
    async function handleReleaseRequest(event) {
      const requestId = event?.detail?.requestId
      autoSerialPausedForFlashRef.current = true

      let released = false
      if (sourceRef.current === 'serial' && streamRef.current) {
        const stream = streamRef.current
        streamRef.current = null
        try { await stream.stop() } catch {}
        setConnStatus('idle')
        setSerialHint('USB 烧录中，串口日志已临时断开')
        released = true
      }

      window.dispatchEvent(new CustomEvent(USB_LOG_RELEASED_EVENT, {
        detail: { requestId, released },
      }))
    }

    function handleFlashFinished() {
      autoSerialPausedForFlashRef.current = false
      if (!autoSerialBlockedRef.current) {
        setSerialHint('')
      }
    }

    window.addEventListener(USB_LOG_RELEASE_REQUEST_EVENT, handleReleaseRequest)
    window.addEventListener(USB_FLASH_FINISHED_EVENT, handleFlashFinished)
    return () => {
      window.removeEventListener(USB_LOG_RELEASE_REQUEST_EVENT, handleReleaseRequest)
      window.removeEventListener(USB_FLASH_FINISHED_EVENT, handleFlashFinished)
    }
  }, [])

  useEffect(() => {
    if (!isWebSerialSupported()) return undefined

    let cancelled = false
    let probing = false

    async function probe() {
      if (cancelled || probing || autoSerialBlockedRef.current) return
      if (autoSerialPausedForFlashRef.current) return
      if (Date.now() < autoSerialCooldownUntilRef.current) return
      if (streamRef.current || ['connecting', 'connected'].includes(statusRef.current)) return

      probing = true
      try {
        const ports = await getPairedSerialDebugPorts()
        if (!cancelled && ports.length > 0 && !autoSerialBlockedRef.current && !streamRef.current) {
          await connectSerialPort(ports[0], { automatic: true })
        }
      } catch {
        /* WebSerial can reject while permissions are changing; try again later. */
      } finally {
        probing = false
      }
    }

    probe()
    const id = window.setInterval(probe, SERIAL_AUTO_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connectSerialPort])

  /* Cleanup on unmount */
  useEffect(() => () => streamRef.current?.stop(), [])

  /* Filtered lines */
  const visible = lines.filter(l => {
    if (filter && filter !== 'all' && l.level !== filter) return false
    if (search && !l.raw.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const statusDot = {
    idle:         'offline',
    connecting:   'connecting',
    connected:    'online',
    disconnected: 'offline',
    error:        'error',
  }[connStatus]

  const counts = { E: 0, W: 0 }
  lines.forEach(l => { if (l.level === 'E') counts.E++; if (l.level === 'W') counts.W++ })

  return (
    <div className="log-panel">
      {/* Header */}
      <div className="log-header">
        <div className="log-title">
          <span className="log-icon">📟</span>
          <span>设备日志</span>
          {counts.E > 0 && <span className="badge error">{counts.E} ERR</span>}
          {counts.W > 0 && <span className="badge warn">{counts.W} WARN</span>}
        </div>
        <div className="log-header-right">
          <button
            className={`icon-btn ${copyState === 'ok' ? 'copy-ok' : copyState === 'error' ? 'copy-error' : ''}`}
            onClick={copyLogLines}
            disabled={lines.length === 0}
            title={copyState === 'ok' ? '已复制' : copyState === 'error' ? '复制失败' : '复制串口内容'}
          >
            {copyState === 'ok' ? '✓' : '⧉'}
          </button>
          <button className="icon-btn" onClick={() => setLines([])} title="清空日志">🗑</button>
          {onAnalyze && lines.length > 0 && (
            <button className="icon-btn analyze-btn"
              onClick={() => {
                const deviceEvidence = createDeviceEvidence({
                  source,
                  status: connStatus === 'error' ? 'failure' : 'observed',
                  lines: lines.map(l => l.raw),
                })
                onDeviceEvidence?.(deviceEvidence)
                onAnalyze(lines.map(l => l.raw).join('\n'), deviceEvidence)
              }}
              title="AI 分析日志">
              ✨
            </button>
          )}
        </div>
      </div>

      {/* Connection bar */}
      <div className="log-conn-bar">
        <div className="source-tabs">
          <button className={`src-tab ${source === 'wifi' ? 'active' : ''}`}
            onClick={() => setSource('wifi')}>WiFi</button>
          <button className={`src-tab ${source === 'serial' ? 'active' : ''}`}
            onClick={() => setSource('serial')}>USB 串口</button>
        </div>

        {source === 'wifi' && (
          <input className="log-ip-input" value={wifiIp}
            onChange={e => setWifiIp(e.target.value)}
            placeholder="192.168.1.88" />
        )}

        {source === 'serial' && serialHint && (
          <span className="serial-hint" title={serialHint}>{serialHint}</span>
        )}

        <div className={`conn-dot ${statusDot}`} title={connStatus} />

        {connStatus === 'connected' ? (
          <button className="log-conn-btn stop" onClick={disconnect}>断开</button>
        ) : (
          <button className="log-conn-btn"
            onClick={connect}
            disabled={source === 'wifi' && !wifiIp}>
            连接
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="log-filter-bar">
        {['all', 'E', 'W', 'I', 'D', 'V'].map(lv => (
          <button key={lv}
            className={`level-btn lv-${lv} ${filter === lv || (lv === 'all' && !filter) ? 'active' : ''}`}
            onClick={() => setFilter(lv === 'all' ? '' : lv)}>
            {lv === 'all' ? 'ALL' : lv}
          </button>
        ))}
        <input className="log-search" value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索..." />
      </div>

      {/* Log lines */}
      <div className="log-lines" ref={listRef} onScroll={handleScroll}>
        {visible.length === 0 && connStatus !== 'connected' && (
          <div className="log-empty">
            <div>📡</div>
            <p>连接设备后开始接收日志</p>
            <p className="log-empty-sub">支持 WiFi WebSocket 和 USB 串口</p>
          </div>
        )}
        {visible.map(l => (
          <div key={l.id} className={`log-line lv-${l.level}`}>
            <span className="log-badge lv-bg-${l.level}">{l.level}</span>
            {l.ms !== null && (
              <span className="log-ms">{(l.ms / 1000).toFixed(3)}s</span>
            )}
            {l.tag && <span className="log-tag">{l.tag}</span>}
            <span className="log-text" style={{ color: LEVEL_COLOR[l.level] }}>
              {l.text ?? l.raw}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {!autoScroll && (
        <button className="scroll-to-bottom" onClick={() => {
          setAutoScroll(true)
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
        }}>
          ↓ 滚动到底部
        </button>
      )}
    </div>
  )
}
