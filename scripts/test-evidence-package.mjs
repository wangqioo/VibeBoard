import assert from 'node:assert/strict'
import { createEvidencePackage } from '../src/domain/evidence/evidencePackage.js'

const pkg = createEvidencePackage({
  boardId: 'szpi_esp32s3',
  selectedSkills: ['lvgl', 'wifi'],
  manifest: { programName: 'wifi_screen' },
  projectFiles: {
    'main/main.c': 'int app_main(void) { return 0; }',
    'README.md': 'large prose should not be embedded',
  },
  buildEvidence: { status: 'failure', errorCategory: 'compile-error' },
  deviceEvidence: { status: 'needs-observation', logs: ['boot'] },
  artifact: { firmware: { size: 1234, filename: 'firmware.bin' } },
})

assert.equal(pkg.schemaVersion, 1)
assert.equal(typeof pkg.createdAt, 'string')
assert.ok(!Number.isNaN(Date.parse(pkg.createdAt)))
assert.equal(pkg.boardId, 'szpi_esp32s3')
assert.deepEqual(pkg.selectedSkills, ['lvgl', 'wifi'])
assert.equal(pkg.manifest.programName, 'wifi_screen')
assert.deepEqual(
  pkg.projectFiles.map(file => file.path),
  ['README.md', 'main/main.c'],
)
assert.equal(pkg.projectFiles.length, 2)
assert.equal(pkg.projectFiles[0].path, 'README.md')
assert.equal(pkg.projectFiles[0].bytes, 34)
assert.equal(typeof pkg.projectFiles[0].sha256, 'string')
assert.match(pkg.projectFiles[0].sha256, /^[a-f0-9]{64}$/)
assert.equal(pkg.projectFiles[0].content, undefined)
assert.equal(pkg.buildEvidence.errorCategory, 'compile-error')
assert.equal(pkg.deviceEvidence.logs[0], 'boot')
assert.equal(pkg.artifact.firmware.size, 1234)

console.log('Evidence package helper tests passed.')
