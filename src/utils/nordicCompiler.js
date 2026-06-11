export async function checkNordicCompilerHealth() {
  const response = await fetch('/nordic/health')
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error || `Nordic compiler health failed: HTTP ${response.status}`)
  }
  return payload
}

export async function compileNordicProject({ files, boardTarget }) {
  const response = await fetch('/nordic/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files, boardTarget }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const summary = summarizeNordicBuildFailure(payload.log || payload.error || '')
    const error = new Error(payload.error || summary.title || `Nordic build failed: HTTP ${response.status}`)
    error.result = payload
    error.summary = summary
    throw error
  }
  return payload
}

export async function downloadNordicArtifact(artifact) {
  const url = artifact?.url || (artifact?.relativePath
    ? `/nordic/artifact?path=${encodeURIComponent(artifact.relativePath)}`
    : '')
  if (!url) {
    throw new Error('Nordic artifact missing download URL')
  }
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Nordic artifact download failed: HTTP ${response.status}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function saveNordicArtifact(artifact) {
  const bytes = await downloadNordicArtifact(artifact)
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const filename = artifact?.name || 'nordic-artifact.bin'
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return { size: bytes.length, name: filename }
}

export function stripAnsi(value) {
  return String(value || '').replace(/\x1b\[[0-9;:]*[A-Za-z]/g, '')
}

export function summarizeNordicBuildFailure(log) {
  const lines = stripAnsi(log)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const gccLineIndex = lines.findIndex(line => /:\d+:\d+:\s+(fatal error|error):\s+/.test(line))
  if (gccLineIndex !== -1) {
    const line = lines[gccLineIndex]
    const match = line.match(/([^/\s][^:]*|\/[^:]+):(\d+):\d+:\s+(?:fatal error|error):\s+(.+)/)
    const file = shortenBuildPath(match?.[1] || '')
    const lineNumber = Number(match?.[2] || 0) || null
    const detail = cleanCompilerDetail(match?.[3] || line)
    return {
      title: `${file || 'C source'}${lineNumber ? `:${lineNumber}` : ''}: ${detail}`,
      category: 'c-compile',
      file,
      line: lineNumber,
      detail,
      suggestion: '检查生成模板或刷新前端静态包；这类错误通常是 Zephyr API 或模板代码不兼容。',
      excerpt: lines.slice(gccLineIndex, gccLineIndex + 3).join('\n'),
    }
  }

  const kconfigWarningIndex = lines.findIndex(line => /^warning: .+was assigned the value/i.test(line))
  const kconfigAbortIndex = lines.findIndex(line => /Aborting due to Kconfig warnings/i.test(line))
  if (kconfigWarningIndex !== -1 || kconfigAbortIndex !== -1) {
    const warningLine = lines[kconfigWarningIndex] || lines[kconfigAbortIndex]
    const detail = warningLine.replace(/^warning:\s*/i, '')
    const normalizedDetail = detail.replace(/\s+\(defined at [^)]+\)/, '')
    return {
      title: `Kconfig 配置不满足：${normalizedDetail}`,
      category: 'kconfig',
      file: '',
      line: null,
      detail,
      suggestion: '检查 prj.conf/sysbuild.conf 中的依赖配置，尤其是 FLASH、MCUmgr、MCUboot、board capability。',
      excerpt: lines.slice(Math.max(0, kconfigWarningIndex), Math.min(lines.length, (kconfigAbortIndex === -1 ? kconfigWarningIndex : kconfigAbortIndex) + 1)).join('\n'),
    }
  }

  const cmakeIndex = lines.findIndex(line => /^CMake Error at /.test(line))
  if (cmakeIndex !== -1) {
    const location = lines[cmakeIndex].replace(/^CMake Error at\s+/, '').replace(/\s+\(message\):$/, '')
    return {
      title: `CMake 配置失败：${location}`,
      category: 'cmake',
      file: '',
      line: null,
      detail: lines[cmakeIndex + 1] || lines[cmakeIndex],
      suggestion: '查看 CMake/Kconfig 附近日志，通常是工程配置、依赖或 toolchain 环境问题。',
      excerpt: lines.slice(cmakeIndex, cmakeIndex + 4).join('\n'),
    }
  }

  const failedIndex = lines.findIndex(line => /FAILED:|ninja: build stopped|FATAL ERROR:/i.test(line))
  if (failedIndex !== -1) {
    return {
      title: lines[failedIndex],
      category: 'build-tool',
      file: '',
      line: null,
      detail: lines[failedIndex],
      suggestion: '查看完整日志中 FAILED 附近的第一条 compiler、CMake 或 Kconfig 错误。',
      excerpt: lines.slice(failedIndex, failedIndex + 8).join('\n'),
    }
  }

  return {
    title: 'Nordic 构建失败，查看完整日志',
    category: 'unknown',
    file: '',
    line: null,
    detail: '',
    suggestion: '保留完整日志，用 first error、CMake Error、Kconfig warning 继续定位。',
    excerpt: lines.slice(-20).join('\n'),
  }
}

function shortenBuildPath(path) {
  const normalized = String(path || '').replace(/\\/g, '/')
  const srcIndex = normalized.lastIndexOf('/src/')
  if (srcIndex !== -1) return normalized.slice(srcIndex + 1)
  const projectIndex = normalized.lastIndexOf('/CMakeLists.txt')
  if (projectIndex !== -1) return 'CMakeLists.txt'
  return normalized.split('/').slice(-2).join('/')
}

function cleanCompilerDetail(detail) {
  return String(detail || '')
    .replace(/\s+\(first use in this function\).*/, '')
    .replace(/; did you mean .*/, '')
    .trim()
}
