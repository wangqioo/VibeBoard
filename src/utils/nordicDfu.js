import {
  createImageStatePacket,
  createImageUploadPacket,
  createOsResetPacket,
  decodeSerialFrames,
  decodeSmpResponse,
  encodeSerialPacket,
} from './nordicDfuProtocol'

const DEFAULT_BAUD_RATE = 115200
const DEFAULT_CHUNK_SIZE = 384
const RESPONSE_TIMEOUT_MS = 8000

export function isNordicDfuSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.serial)
}

export function nordicDfuUnavailableReason() {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Web Serial 需要 HTTPS 或 localhost'
  }
  if (!isNordicDfuSupported()) {
    return '当前浏览器不支持 Web Serial，请使用 Chrome/Edge'
  }
  return ''
}

export async function flashNordicOverSerial({
  artifact,
  downloadArtifact,
  baudRate = DEFAULT_BAUD_RATE,
  chunkSize = DEFAULT_CHUNK_SIZE,
  onLog = () => {},
  onProgress = () => {},
} = {}) {
  const unavailable = nordicDfuUnavailableReason()
  if (unavailable) throw new Error(unavailable)
  if (!artifact) throw new Error('请选择 zephyr.signed.bin DFU artifact')
  if (typeof downloadArtifact !== 'function') throw new Error('缺少 Nordic artifact 下载函数')

  onLog(`下载 ${artifact.name || artifact.relativePath}...`)
  const image = await downloadArtifact(artifact)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', image))
  onLog(`镜像大小 ${(image.length / 1024).toFixed(1)} KB`)

  const port = await navigator.serial.requestPort()
  await port.open({ baudRate })
  onLog(`串口已打开 ${baudRate} baud`)

  const client = new McuMgrSerialClient(port, onLog)
  try {
    let offset = 0
    while (offset < image.length) {
      const data = image.slice(offset, Math.min(offset + chunkSize, image.length))
      const response = await client.send(createImageUploadPacket({
        sequence: client.nextSequence(),
        offset,
        data,
        imageLength: image.length,
        sha256: hash,
      }))
      const nextOffset = Number(response.map.off)
      if (!Number.isFinite(nextOffset) || nextOffset <= offset) {
        throw new Error(`设备返回了无效 DFU offset: ${response.map.off}`)
      }
      offset = nextOffset
      onProgress(Math.min(100, Math.round((offset / image.length) * 100)))
    }

    onLog('镜像上传完成，标记为 test boot...')
    await client.send(createImageStatePacket({ sequence: client.nextSequence(), hash }))
    onLog('请求重启，生成的固件启动后会自确认。')
    await client.send(createOsResetPacket({ sequence: client.nextSequence() }))
    onProgress(100)
    onLog('DFU 完成，设备正在重启。')
    return { status: 'ok', size: image.length }
  } finally {
    await client.close()
  }
}

class McuMgrSerialClient {
  constructor(port, onLog) {
    this.port = port
    this.onLog = onLog
    this.sequence = 0
    this.reader = port.readable.getReader()
    this.writer = port.writable.getWriter()
    this.pendingFrames = []
    this.lineBuffer = new Uint8Array(0)
  }

  nextSequence() {
    const value = this.sequence
    this.sequence = (this.sequence + 1) & 0xff
    return value
  }

  async send(packet) {
    for (const frame of encodeSerialPacket(packet)) {
      await this.writer.write(frame)
    }
    return this.readResponse()
  }

  async readResponse() {
    const deadline = Date.now() + RESPONSE_TIMEOUT_MS
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const result = await timeout(this.reader.read(), remaining)
      if (result?.done) throw new Error('串口已关闭')
      if (!result?.value) continue
      const { frames, remainder } = splitFrames(concatBytes(this.lineBuffer, result.value))
      this.lineBuffer = remainder
      for (const frame of frames) {
        this.pendingFrames.push(frame)
        try {
          const packet = decodeSerialFrames(this.pendingFrames)
          this.pendingFrames = []
          return decodeSmpResponse(packet)
        } catch (error) {
          if (!/Incomplete MCUmgr serial packet/.test(error.message)) {
            this.pendingFrames = []
            this.onLog?.(error.message)
          }
        }
      }
    }
    throw new Error('等待 MCUmgr 响应超时')
  }

  async close() {
    try {
      this.reader.releaseLock()
    } catch {
      // Reader may already be released after a port error.
    }
    try {
      this.writer.releaseLock()
    } catch {
      // Writer may already be released after a port error.
    }
    try {
      await this.port.close()
    } catch {
      // Some boards reset immediately after DFU; closing can race with disconnect.
    }
  }
}

function splitFrames(bytes) {
  const frames = []
  let start = 0
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue
    frames.push(bytes.slice(start, index + 1))
    start = index + 1
  }
  return { frames, remainder: bytes.slice(start) }
}

async function timeout(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('等待 MCUmgr 响应超时')), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function concatBytes(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
