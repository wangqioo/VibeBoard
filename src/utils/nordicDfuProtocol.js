const FIRST_FRAME = 0x0609
const CONT_FRAME = 0x0414
const MAX_SERIAL_FRAME_BYTES = 127
const SERIAL_MARKER_BYTES = 2
const SERIAL_NEWLINE_BYTES = 1
const MAX_RAW_CHUNK_BYTES = Math.floor((MAX_SERIAL_FRAME_BYTES - SERIAL_MARKER_BYTES - SERIAL_NEWLINE_BYTES) / 4) * 3

const GROUP_IMAGE = 1
const GROUP_OS = 0
const ID_IMAGE_STATE = 0
const ID_IMAGE_UPLOAD = 1
const ID_OS_RESET = 5
const OP_WRITE = 2

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function crc16Itu(bytes) {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xffff
    }
  }
  return crc
}

export function encodeSerialPacket(packet) {
  const payload = toUint8Array(packet)
  const crc = crc16Itu(payload)
  const raw = new Uint8Array(2 + payload.length + 2)
  raw[0] = ((payload.length + 2) >> 8) & 0xff
  raw[1] = (payload.length + 2) & 0xff
  raw.set(payload, 2)
  raw[raw.length - 2] = (crc >> 8) & 0xff
  raw[raw.length - 1] = crc & 0xff

  const frames = []
  for (let offset = 0; offset < raw.length; offset += MAX_RAW_CHUNK_BYTES) {
    const chunk = raw.slice(offset, offset + MAX_RAW_CHUNK_BYTES)
    const encoded = base64Encode(chunk)
    const frame = new Uint8Array(SERIAL_MARKER_BYTES + encoded.length + SERIAL_NEWLINE_BYTES)
    const marker = offset === 0 ? FIRST_FRAME : CONT_FRAME
    frame[0] = (marker >> 8) & 0xff
    frame[1] = marker & 0xff
    frame.set(encoded, 2)
    frame[frame.length - 1] = 0x0a
    frames.push(frame)
  }
  return frames
}

export function decodeSerialFrames(frames) {
  let expectedLength = null
  let received = new Uint8Array(0)

  for (const frame of frames) {
    const bytes = toUint8Array(frame)
    if (bytes.length < 4) continue
    const marker = (bytes[0] << 8) | bytes[1]
    if (marker !== FIRST_FRAME && marker !== CONT_FRAME) continue
    const lineEnd = bytes[bytes.length - 1] === 0x0a ? bytes.length - 1 : bytes.length
    const decoded = base64Decode(bytes.slice(2, lineEnd))
    if (marker === FIRST_FRAME) {
      if (decoded.length < 2) throw new Error('Invalid MCUmgr serial frame')
      expectedLength = (decoded[0] << 8) | decoded[1]
      received = decoded.slice(2)
    } else {
      received = concatBytes(received, decoded)
    }
    if (expectedLength !== null && received.length >= expectedLength) break
  }

  if (expectedLength === null || received.length < expectedLength) {
    throw new Error('Incomplete MCUmgr serial packet')
  }
  const packetWithCrc = received.slice(0, expectedLength)
  if (packetWithCrc.length < 3) throw new Error('Invalid MCUmgr serial packet')
  const packet = packetWithCrc.slice(0, -2)
  const expectedCrc = (packetWithCrc[packetWithCrc.length - 2] << 8) | packetWithCrc[packetWithCrc.length - 1]
  if (crc16Itu(packet) !== expectedCrc) throw new Error('Invalid MCUmgr serial CRC')
  return packet
}

export function createSmpPacket({ op, group, id, sequence, payload = new Uint8Array(), flags = 0 }) {
  const body = toUint8Array(payload)
  const packet = new Uint8Array(8 + body.length)
  packet[0] = op
  packet[1] = flags
  packet[2] = (body.length >> 8) & 0xff
  packet[3] = body.length & 0xff
  packet[4] = (group >> 8) & 0xff
  packet[5] = group & 0xff
  packet[6] = sequence & 0xff
  packet[7] = id & 0xff
  packet.set(body, 8)
  return packet
}

export function parseSmpPacket(packet) {
  const bytes = toUint8Array(packet)
  if (bytes.length < 8) throw new Error('Invalid SMP packet')
  const length = (bytes[2] << 8) | bytes[3]
  if (bytes.length < 8 + length) throw new Error('Incomplete SMP payload')
  return {
    op: bytes[0],
    flags: bytes[1],
    length,
    group: (bytes[4] << 8) | bytes[5],
    sequence: bytes[6],
    id: bytes[7],
    payload: bytes.slice(8, 8 + length),
  }
}

export function createImageUploadPacket({ sequence, offset, data, imageLength, sha256 }) {
  return createSmpPacket({
    op: OP_WRITE,
    group: GROUP_IMAGE,
    id: ID_IMAGE_UPLOAD,
    sequence,
    payload: encodeImageUploadPayload({ offset, data, imageLength, sha256 }),
  })
}

export function createImageStatePacket({ sequence, hash }) {
  return createSmpPacket({
    op: OP_WRITE,
    group: GROUP_IMAGE,
    id: ID_IMAGE_STATE,
    sequence,
    payload: encodeImageStatePayload({ hash }),
  })
}

export function createImageConfirmPacket({ sequence, hash }) {
  return createSmpPacket({
    op: OP_WRITE,
    group: GROUP_IMAGE,
    id: ID_IMAGE_STATE,
    sequence,
    payload: encodeImageConfirmPayload({ hash }),
  })
}

export function createOsResetPacket({ sequence }) {
  return createSmpPacket({
    op: OP_WRITE,
    group: GROUP_OS,
    id: ID_OS_RESET,
    sequence,
    payload: encodeOsResetPayload(),
  })
}

export function encodeImageUploadPayload({ offset, data, imageLength, sha256 }) {
  const entries = [
    ['off', offset],
    ['data', toUint8Array(data)],
  ]
  if (offset === 0) {
    entries.push(['len', imageLength], ['sha', toUint8Array(sha256)])
  }
  return encodeCborMapEntries(entries)
}

export function encodeImageStatePayload({ hash }) {
  return encodeCborMapEntries([
    ['hash', toUint8Array(hash)],
    ['confirm', false],
  ])
}

export function encodeImageConfirmPayload({ hash }) {
  return encodeCborMapEntries([
    ['hash', toUint8Array(hash)],
    ['confirm', true],
  ])
}

export function encodeOsResetPayload() {
  return encodeCborMapEntries([])
}

export function decodeSmpResponse(packet) {
  const parsed = parseSmpPacket(packet)
  const map = decodeCborMap(parsed.payload)
  if (typeof map.rc === 'number' && map.rc !== 0) {
    throw new Error(`MCUmgr command failed: rc=${map.rc}`)
  }
  if (map.err && typeof map.err === 'object') {
    const message = map.err.message || map.err.msg || JSON.stringify(map.err)
    throw new Error(`MCUmgr command failed: ${message}`)
  }
  return { ...parsed, map }
}

export function selectNordicDfuArtifact(artifacts = []) {
  const candidates = Array.isArray(artifacts) ? artifacts : []
  return (
    candidates.find(artifact => artifact?.dfu === true && /zephyr\.signed\.bin$/.test(artifact.name || artifact.relativePath || '')) ||
    candidates.find(artifact => /zephyr\.signed\.bin$|app_update\.bin$/.test(artifact?.name || artifact?.relativePath || '')) ||
    null
  )
}

function encodeCborMapEntries(entries) {
  return concatBytes(encodeCborHeader(5, entries.length), ...entries.flatMap(([key, value]) => [
    encodeText(key),
    encodeCborValue(value),
  ]))
}

function encodeCborValue(value) {
  if (value instanceof Uint8Array) {
    return concatBytes(encodeCborHeader(2, value.length), value)
  }
  if (typeof value === 'string') return encodeText(value)
  if (typeof value === 'number') return encodeCborHeader(0, value)
  if (typeof value === 'boolean') return new Uint8Array([value ? 0xf5 : 0xf4])
  if (value && typeof value === 'object') {
    return encodeCborMapEntries(Object.entries(value))
  }
  throw new Error(`Unsupported CBOR value: ${String(value)}`)
}

function encodeText(value) {
  const bytes = textEncoder.encode(value)
  return concatBytes(encodeCborHeader(3, bytes.length), bytes)
}

function encodeCborHeader(major, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('CBOR only supports non-negative safe integers here')
  if (value < 24) return new Uint8Array([(major << 5) | value])
  if (value <= 0xff) return new Uint8Array([(major << 5) | 24, value])
  if (value <= 0xffff) return new Uint8Array([(major << 5) | 25, (value >> 8) & 0xff, value & 0xff])
  return new Uint8Array([
    (major << 5) | 26,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ])
}

export function decodeCborMap(bytes) {
  const reader = new CborReader(toUint8Array(bytes))
  const value = reader.read()
  if (!value || typeof value !== 'object' || value instanceof Uint8Array || Array.isArray(value)) {
    throw new Error('Expected CBOR map')
  }
  return value
}

class CborReader {
  constructor(bytes) {
    this.bytes = bytes
    this.offset = 0
  }

  read() {
    const initial = this.readByte()
    const major = initial >> 5
    const info = initial & 0x1f
    const length = this.readArgument(info)
    if (major === 0) return length
    if (major === 1) return -1 - length
    if (major === 2) return this.readBytes(length)
    if (major === 3) return textDecoder.decode(this.readBytes(length))
    if (major === 4) return Array.from({ length }, () => this.read())
    if (major === 5) {
      const map = {}
      for (let index = 0; index < length; index += 1) {
        const key = this.read()
        map[key] = this.read()
      }
      return map
    }
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
    }
    throw new Error(`Unsupported CBOR major=${major} info=${info}`)
  }

  readArgument(info) {
    if (info < 24) return info
    if (info === 24) return this.readByte()
    if (info === 25) return (this.readByte() << 8) | this.readByte()
    if (info === 26) {
      return ((this.readByte() << 24) >>> 0) + (this.readByte() << 16) + (this.readByte() << 8) + this.readByte()
    }
    throw new Error(`Unsupported CBOR length info=${info}`)
  }

  readByte() {
    if (this.offset >= this.bytes.length) throw new Error('Unexpected end of CBOR')
    return this.bytes[this.offset++]
  }

  readBytes(length) {
    if (this.offset + length > this.bytes.length) throw new Error('Unexpected end of CBOR')
    const value = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return value
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

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array(value || [])
}

function base64Encode(bytes) {
  if (typeof btoa === 'function') {
    const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
    return textEncoder.encode(btoa(binary))
  }
  return textEncoder.encode(Buffer.from(bytes).toString('base64'))
}

function base64Decode(bytes) {
  const text = textDecoder.decode(bytes).trim()
  if (typeof atob === 'function') {
    const binary = atob(text)
    return Uint8Array.from(binary, char => char.charCodeAt(0))
  }
  return new Uint8Array(Buffer.from(text, 'base64'))
}
