import assert from 'node:assert/strict'
import { createEvidencePackage, createEvidenceReportMarkdown } from '../src/domain/evidence/evidencePackage.js'

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
  flashEvidence: {
    status: 'verified',
    port: '/dev/cu.usbserial-1110',
    artifacts: [{
      name: 'main.bin',
      address: '0x12020000',
      size: 2608744,
      expectedSha256: 'e313669960f70d46140f69fa69c7e28f4fbde81293c8403f9175212cd32c364c',
      actualSha256: 'e313669960f70d46140f69fa69c7e28f4fbde81293c8403f9175212cd32c364c',
      matched: true,
    }],
  },
  previewEvidence: { renderer: 'real-lvgl', cache: { hit: false } },
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
assert.equal(pkg.flashEvidence.status, 'verified')
assert.equal(pkg.previewEvidence.renderer, 'real-lvgl')
assert.equal(pkg.artifact.firmware.size, 1234)

const report = createEvidenceReportMarkdown(pkg)
assert.match(report, /# VibeBoard Evidence Report/)
assert.match(report, /Board: `szpi_esp32s3`/)
assert.match(report, /## Project Files/)
assert.match(report, /README\.md/)
assert.match(report, /main\/main\.c/)
assert.match(report, /## Build Evidence/)
assert.match(report, /Status: `failure`/)
assert.match(report, /## Device Evidence/)
assert.match(report, /Status: `needs-observation`/)
assert.match(report, /## Flash Evidence/)
assert.match(report, /Port: `\/dev\/cu\.usbserial-1110`/)
assert.match(report, /main\.bin/)
assert.match(report, /0x12020000/)
assert.match(report, /matched/)
assert.match(report, /## Preview Evidence/)
assert.match(report, /real-lvgl/)
assert.doesNotMatch(report, /large prose should not be embedded/)

console.log('Evidence package helper tests passed.')
