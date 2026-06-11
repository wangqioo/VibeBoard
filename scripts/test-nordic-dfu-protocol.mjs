import assert from 'node:assert/strict'
import {
  createSmpPacket,
  decodeCborMap,
  decodeSerialFrames,
  encodeImageConfirmPayload,
  encodeImageStatePayload,
  encodeImageUploadPayload,
  encodeOsResetPayload,
  encodeSerialPacket,
  parseSmpPacket,
  selectNordicDfuArtifact,
  selectNordicUf2Artifact,
} from '../src/utils/nordicDfuProtocol.js'

const payload = new Uint8Array(260).map((_, index) => index & 0xff)
const frames = encodeSerialPacket(payload)
assert.ok(frames.length > 1)
assert.equal(frames[0][0], 0x06)
assert.equal(frames[0][1], 0x09)
assert.equal(frames[1][0], 0x04)
assert.equal(frames[1][1], 0x14)
assert.ok(frames.every(frame => frame.length <= 127))
assert.deepEqual(decodeSerialFrames(frames), payload)

const smp = createSmpPacket({
  op: 2,
  group: 1,
  id: 1,
  sequence: 7,
  payload: new Uint8Array([0xa0]),
})
assert.deepEqual([...smp.slice(0, 8)], [2, 0, 0, 1, 0, 1, 7, 1])
assert.deepEqual(parseSmpPacket(smp), {
  op: 2,
  flags: 0,
  length: 1,
  group: 1,
  sequence: 7,
  id: 1,
  payload: new Uint8Array([0xa0]),
})

const sha = new Uint8Array(32).fill(0x42)
const upload = decodeCborMap(encodeImageUploadPayload({
  offset: 0,
  data: new Uint8Array([1, 2, 3]),
  imageLength: 3,
  sha256: sha,
}))
assert.equal(upload.off, 0)
assert.equal(upload.len, 3)
assert.deepEqual(upload.data, new Uint8Array([1, 2, 3]))
assert.deepEqual(upload.sha, sha)

const state = decodeCborMap(encodeImageStatePayload({ hash: sha }))
assert.deepEqual(state.hash, sha)
assert.equal(state.confirm, false)

const confirm = decodeCborMap(encodeImageConfirmPayload({ hash: sha }))
assert.deepEqual(confirm.hash, sha)
assert.equal(confirm.confirm, true)

const reset = decodeCborMap(encodeOsResetPayload())
assert.deepEqual(reset, {})

const artifacts = [
  { name: 'zephyr.bin', relativePath: 'a/build/zephyr/zephyr.bin' },
  { name: 'zephyr.signed.bin', relativePath: 'a/build/zephyr/zephyr.signed.bin', dfu: true },
  { name: 'merged.hex', relativePath: 'a/build/zephyr/merged.hex' },
]
assert.equal(selectNordicDfuArtifact(artifacts).name, 'zephyr.signed.bin')
assert.equal(selectNordicDfuArtifact([]), null)

const uf2Artifacts = [
  { name: 'zephyr.uf2', relativePath: 'a/build/mcuboot/zephyr/zephyr.uf2', uf2: true },
  { name: 'zephyr.uf2', relativePath: 'a/build/a/zephyr/zephyr.uf2', uf2: true },
]
assert.equal(selectNordicUf2Artifact(uf2Artifacts).relativePath, 'a/build/a/zephyr/zephyr.uf2')
assert.equal(selectNordicUf2Artifact([]), null)

console.log('nordic dfu protocol tests passed')
