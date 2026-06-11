import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  healthPayload,
  normalizeBoardTarget,
  sanitizeNordicFilePath,
  writeNordicProject,
} from '../backend/nordic-compiler-service/server.mjs'

assert.equal(sanitizeNordicFilePath('CMakeLists.txt'), 'CMakeLists.txt')
assert.equal(sanitizeNordicFilePath('prj.conf'), 'prj.conf')
assert.equal(sanitizeNordicFilePath('src/main.c'), 'src/main.c')
assert.equal(sanitizeNordicFilePath('boards/nrf52840dk_nrf52840.overlay'), 'boards/nrf52840dk_nrf52840.overlay')
assert.throws(() => sanitizeNordicFilePath('../escape.c'), /Unsafe Nordic file path/)
assert.throws(() => sanitizeNordicFilePath('/tmp/escape.c'), /Unsafe Nordic file path/)
assert.throws(() => sanitizeNordicFilePath('west.yml'), /Unsafe Nordic file path/)

assert.equal(normalizeBoardTarget('nrf52840dk/nrf52840'), 'nrf52840dk/nrf52840')
assert.throws(() => normalizeBoardTarget('nrf52840dk/nrf52840; rm -rf /'), /Unsafe Nordic board target/)

const workspace = mkdtempSync(join(tmpdir(), 'nordic-compiler-service-'))
try {
  const payload = {
    boardTarget: 'nrf52840dk/nrf52840',
    files: {
      'CMakeLists.txt': 'cmake_minimum_required(VERSION 3.20.0)\nfind_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})\nproject(test)\ntarget_sources(app PRIVATE src/main.c)\n',
      'prj.conf': 'CONFIG_GPIO=y\n',
      'src/main.c': '#include <zephyr/kernel.h>\nint main(void) { return 0; }\n',
    },
  }
  const project = writeNordicProject({ buildBase: workspace, ...payload })
  assert.equal(project.boardTarget, 'nrf52840dk/nrf52840')
  assert.ok(project.writtenFiles.includes('CMakeLists.txt'))
  assert.ok(project.writtenFiles.includes('prj.conf'))
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

const health = healthPayload()
assert.equal(health.service, 'nordic-compiler')
assert.equal(health.toolchain, 'nRF Connect SDK + Zephyr')
assert.equal(health.buildTool, 'west')
assert.equal(health.defaultBoardTarget, 'nrf52840dk/nrf52840')

console.log('nordic compiler service tests passed')
