import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createArtifactDownloadUrl,
  healthPayload,
  listArtifacts,
  normalizeBoardTarget,
  sanitizeNordicFilePath,
  writeNordicProject,
} from '../backend/nordic-compiler-service/server.mjs'

assert.equal(sanitizeNordicFilePath('CMakeLists.txt'), 'CMakeLists.txt')
assert.equal(sanitizeNordicFilePath('prj.conf'), 'prj.conf')
assert.equal(sanitizeNordicFilePath('sysbuild.conf'), 'sysbuild.conf')
assert.equal(sanitizeNordicFilePath('README.md'), 'README.md')
assert.equal(sanitizeNordicFilePath('src/main.c'), 'src/main.c')
assert.equal(sanitizeNordicFilePath('boards/nrf52840dk_nrf52840.overlay'), 'boards/nrf52840dk_nrf52840.overlay')
assert.equal(sanitizeNordicFilePath('sysbuild/mcuboot/prj.conf'), 'sysbuild/mcuboot/prj.conf')
assert.throws(() => sanitizeNordicFilePath('../escape.c'), /Unsafe Nordic file path/)
assert.throws(() => sanitizeNordicFilePath('/tmp/escape.c'), /Unsafe Nordic file path/)
assert.throws(() => sanitizeNordicFilePath('west.yml'), /Unsafe Nordic file path/)

assert.equal(normalizeBoardTarget('nrf52840dk/nrf52840'), 'nrf52840dk/nrf52840')
assert.equal(normalizeBoardTarget('xiao_ble'), 'xiao_ble')
assert.equal(normalizeBoardTarget('xiao_ble/nrf52840/sense'), 'xiao_ble/nrf52840/sense')
assert.throws(() => normalizeBoardTarget('nrf52840dk/nrf52840; rm -rf /'), /Unsafe Nordic board target/)

const workspace = mkdtempSync(join(tmpdir(), 'nordic-compiler-service-'))
try {
  const payload = {
    boardTarget: 'xiao_ble',
    files: {
      'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20.0)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\nproject(test)\ntarget_sources(app PRIVATE src/main.c)\n',
      'prj.conf': 'CONFIG_GPIO=y\n',
      'sysbuild.conf': 'SB_CONFIG_BOOTLOADER_MCUBOOT=y\n',
      'src/main.c': '#include <zephyr/kernel.h>\nint main(void) { return 0; }\n',
    },
  }
  const project = writeNordicProject({ buildBase: workspace, ...payload })
  assert.equal(project.boardTarget, 'xiao_ble')
  assert.ok(project.writtenFiles.includes('CMakeLists.txt'))
  assert.ok(project.writtenFiles.includes('prj.conf'))
  assert.ok(project.writtenFiles.includes('sysbuild.conf'))
  assert.ok(project.writtenFiles.includes('src/main.c'))
  const missingMain = { ...payload.files }
  delete missingMain['src/main.c']
  assert.throws(
    () => writeNordicProject({ buildBase: workspace, files: missingMain }),
    /Missing required Nordic file/,
  )
} finally {
  rmSync(workspace, { recursive: true, force: true })
}

const artifactsWorkspace = mkdtempSync(join(tmpdir(), 'nordic-artifacts-'))
try {
  const buildDir = join(artifactsWorkspace, 'project-a', 'build')
  const zephyrDir = join(buildDir, 'zephyr')
  mkdtempSync(join(tmpdir(), 'nordic-unused-'))
  await import('node:fs').then(({ mkdirSync, writeFileSync }) => {
    mkdirSync(zephyrDir, { recursive: true })
    writeFileSync(join(zephyrDir, 'zephyr.signed.bin'), 'signed')
    writeFileSync(join(zephyrDir, 'zephyr.uf2'), 'uf2')
    writeFileSync(join(zephyrDir, 'merged.hex'), 'hex')
  })
  const artifacts = listArtifacts(buildDir, artifactsWorkspace)
  const dfuArtifact = artifacts.find(artifact => artifact.name === 'zephyr.signed.bin')
  assert.equal(dfuArtifact.role, 'dfu-image')
  assert.equal(dfuArtifact.dfu, true)
  assert.ok(dfuArtifact.url.includes('/nordic/artifact?path='))
  assert.equal(createArtifactDownloadUrl(dfuArtifact.relativePath), dfuArtifact.url)
  const uf2Artifact = artifacts.find(artifact => artifact.name === 'zephyr.uf2')
  assert.equal(uf2Artifact.role, 'uf2-image')
  assert.equal(uf2Artifact.uf2, true)
  assert.equal(uf2Artifact.dfu, false)
  assert.equal(artifacts.find(artifact => artifact.name === 'merged.hex').role, 'initial-flash')
} finally {
  rmSync(artifactsWorkspace, { recursive: true, force: true })
}

const health = healthPayload()
assert.equal(health.service, 'nordic-compiler')
assert.equal(health.toolchain, 'nRF Connect SDK + Zephyr')
assert.equal(health.buildTool, 'west')
assert.equal(health.defaultBoardTarget, 'xiao_ble')

console.log('nordic compiler service tests passed')
