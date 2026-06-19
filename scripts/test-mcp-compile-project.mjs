import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readWorkspaceProjectFiles,
} from '../backend/mcp-server/tools/workspaceFiles.mjs'
import {
  writeCompileArtifacts,
} from '../backend/mcp-server/tools/artifacts.mjs'
import {
  compileProjectWithService,
} from '../backend/mcp-server/tools/compilerClient.mjs'
import {
  compileProjectTool,
} from '../backend/mcp-server/tools/compileProject.mjs'
import {
  listCapabilities,
} from '../backend/mcp-server/tools/capabilities.mjs'
import {
  dispatchTool,
} from '../backend/mcp-server/server.mjs'

const workspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-workspace-'))
await mkdir(join(workspace, 'main', 'nested'), { recursive: true })
await mkdir(join(workspace, 'components', 'hack'), { recursive: true })
await mkdir(join(workspace, 'spiffs', 'startup'), { recursive: true })
await writeFile(join(workspace, 'main', 'main.c'), 'void app_main(void) {}')
await writeFile(join(workspace, 'main', 'nested', 'ui.c'), 'void ui(void) {}')
await writeFile(join(workspace, 'main', 'nested', 'driver.hpp'), '#pragma once')
await writeFile(join(workspace, 'main', 'nested', 'boot.S'), 'nop')
await writeFile(join(workspace, 'main', 'notes.txt'), 'ignore me')
await writeFile(join(workspace, 'components', 'hack', 'hack.c'), 'void hack(void) {}')
await writeFile(join(workspace, 'spiffs', 'startup', 'init.cpp'), 'void init() {}')
await writeFile(join(workspace, 'CMakeLists.txt'), 'ignore system file')

const files = await readWorkspaceProjectFiles({ workspacePath: workspace })
assert.deepEqual(Object.keys(files).sort(), [
  'components/hack/hack.c',
  'main/main.c',
  'main/nested/boot.S',
  'main/nested/driver.hpp',
  'main/nested/ui.c',
  'spiffs/startup/init.cpp',
])
assert.equal(files['main/main.c'], 'void app_main(void) {}')
assert.equal(files['main/notes.txt'], undefined)
assert.equal(files['CMakeLists.txt'], undefined)

await assert.rejects(
  () => readWorkspaceProjectFiles({ workspacePath: '' }),
  /workspacePath is required/,
)

await assert.rejects(
  () => readWorkspaceProjectFiles({ workspacePath: join(workspace, 'main', 'main.c') }),
  /workspacePath is not a directory/,
)

function sseResponse(chunks, ok = true, status = 200) {
  return {
    ok,
    status,
    body: new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder()
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    async json() {
      return { error: 'json error' }
    },
  }
}

const fakeFetch = async (url, request) => {
  assert.equal(url, 'http://compiler.local/compile')
  assert.equal(request.method, 'POST')
  const payload = JSON.parse(request.body)
  assert.equal(typeof payload.projectId, 'string')
  assert.equal(payload.projectId.length > 0, true)
  const mainSource = payload.projectFiles['main/main.c'] || payload.projectFiles['main/main.cpp']
  assert.equal(typeof mainSource, 'string')
  if (payload.code !== undefined) assert.equal(mainSource, payload.code)
  if (payload.code !== undefined) assert.equal(typeof payload.code, 'string')
  assert.equal((payload.code || mainSource).includes('app_main'), true)
  return sseResponse([
    'data: {"log":"building"}\n\n',
    'data: {"done":true,"bin":"ZmlybXdhcmU=","size":8,"filename":"firmware.bin","buildId":"build-1","command":"idf.py build","flashFiles":[{"name":"bootloader.bin","offset":"0x1000","bin":"Ym9vdA==","size":4}]}\n\n',
  ])
}

const compileResult = await compileProjectWithService({
  compilerUrl: 'http://compiler.local',
  payload: {
    projectId: 'project-1',
    projectFiles: { 'main/main.c': 'void app_main(void) {}' },
  },
  fetchImpl: fakeFetch,
})
assert.equal(compileResult.status, 'success')
assert.equal(compileResult.firmware.filename, 'firmware.bin')
assert.equal(compileResult.firmware.base64, 'ZmlybXdhcmU=')
assert.equal(compileResult.buildEvidence.status, 'success')
assert.equal(compileResult.buildEvidence.buildId, 'build-1')
assert.deepEqual(compileResult.logs, ['building'])

const artifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-artifacts-'))
const artifact = await writeCompileArtifacts({
  artifactDir,
  projectId: 'project-1',
  firmware: compileResult.firmware,
  flashFiles: compileResult.flashFiles,
})
assert.equal(artifact.firmware.size, 8)
assert.match(artifact.firmware.path, /firmware\.bin$/)
assert.equal(artifact.flashFiles[0].name, 'bootloader.bin')

const failedCompile = await compileProjectWithService({
  compilerUrl: 'http://compiler.local/',
  payload: { projectId: 'project-2', projectFiles: {} },
  fetchImpl: async () => sseResponse([
    'data: {"log":"error: bad source"}\n\n',
    'data: {"done":true,"error":"compile failed"}\n\n',
  ]),
})
assert.equal(failedCompile.status, 'failure')
assert.equal(failedCompile.buildEvidence.status, 'failure')
assert.equal(failedCompile.buildEvidence.error, 'compile failed')

const httpFailedCompile = await compileProjectWithService({
  compilerUrl: 'http://compiler.local',
  payload: { projectId: 'project-3', projectFiles: {} },
  fetchImpl: async () => sseResponse([], false, 500),
})
assert.equal(httpFailedCompile.status, 'failure')
assert.equal(httpFailedCompile.buildEvidence.status, 'failure')
assert.equal(httpFailedCompile.buildEvidence.error, 'json error')

const incompleteCompile = await compileProjectWithService({
  compilerUrl: 'http://compiler.local',
  payload: { projectId: 'project-4', projectFiles: {} },
  fetchImpl: async () => sseResponse([
    'data: {"log":"still building"}\n\n',
  ]),
})
assert.equal(incompleteCompile.status, 'failure')
assert.equal(incompleteCompile.buildEvidence.status, 'failure')
assert.equal(
  incompleteCompile.buildEvidence.error,
  'compiler stream ended before done event',
)

const unsafeArtifact = await writeCompileArtifacts({
  artifactDir,
  projectId: 'project:one/two',
  firmware: {
    base64: 'ZmlybXdhcmU=',
    filename: 'firmware unsafe/name.bin',
    size: 8,
  },
  flashFiles: [{
    name: 'boot loader@1.bin',
    offset: '0x1000',
    bin: 'Ym9vdA==',
    size: 4,
  }],
})
assert.match(unsafeArtifact.firmware.path, /project_one_two\/firmware_unsafe_name\.bin$/)
assert.equal(unsafeArtifact.flashFiles[0].name, 'boot_loader_1.bin')
assert.deepEqual(await readFile(unsafeArtifact.firmware.path), Buffer.from('firmware'))

const toolArtifactDir = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-tool-artifacts-'))
const toolResult = await compileProjectTool({
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  projectId: 'tool-project',
  selectedSkills: ['display', 'bad/value', 'wifi_6', '', 'toolong'.repeat(11), 42],
}, {
  compilerUrl: 'http://compiler.local',
  artifactDir: toolArtifactDir,
  fetchImpl: fakeFetch,
})
assert.equal(toolResult.status, 'success')
assert.equal(toolResult.artifact.firmware.size, 8)
assert.match(toolResult.artifact.firmware.path, /firmware\.bin$/)
assert.deepEqual(toolResult.diagnostics, [])
assert.deepEqual(toolResult.logs, ['building'])
assert.deepEqual(toolResult.compilePackage, {
  mainFile: 'main.c',
  selectedSkills: ['display', 'wifi_6'],
})

const cppWorkspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-cpp-workspace-'))
await mkdir(join(cppWorkspace, 'main'), { recursive: true })
await writeFile(join(cppWorkspace, 'main', 'main.c'), 'void legacy(void) {}')
await writeFile(join(cppWorkspace, 'main', 'main.cpp'), 'extern "C" void app_main(void) {}')
const cppPayloads = []
const cppResult = await compileProjectTool({
  workspacePath: cppWorkspace,
  boardId: 'szpi_esp32s3',
}, {
  artifactDir: await mkdtemp(join(tmpdir(), 'vibeboard-mcp-cpp-artifacts-')),
  compilerUrl: 'http://compiler.local',
  fetchImpl: async (url, request) => {
    assert.equal(url, 'http://compiler.local/compile')
    assert.equal(request.method, 'POST')
    const payload = JSON.parse(request.body)
    cppPayloads.push(payload)
    assert.equal(payload.projectId, 'szpi_esp32s3')
    assert.equal(payload.code, 'extern "C" void app_main(void) {}')
    assert.equal(payload.projectFiles.__mainFile, 'main.cpp')
    assert.deepEqual(payload.projectFiles.__selectedSkills, [])
    return sseResponse([
      'data: {"done":true,"bin":"ZmlybXdhcmU=","size":8,"filename":"firmware.bin"}\n\n',
    ])
  },
})
assert.equal(cppResult.status, 'success')
assert.equal(cppPayloads.length, 1)
assert.equal(cppResult.compilePackage.mainFile, 'main.cpp')

const missingMainWorkspace = await mkdtemp(join(tmpdir(), 'vibeboard-mcp-no-main-'))
await mkdir(join(missingMainWorkspace, 'components', 'demo'), { recursive: true })
await writeFile(join(missingMainWorkspace, 'components', 'demo', 'demo.c'), 'void demo(void) {}')
const missingMainResult = await compileProjectTool({
  workspacePath: missingMainWorkspace,
  boardId: 'szpi_esp32s3',
})
assert.equal(missingMainResult.status, 'failure')
assert.equal(missingMainResult.artifact, null)
assert.equal(missingMainResult.buildEvidence.status, 'failure')
assert.equal(missingMainResult.buildEvidence.category, 'compile-package-invalid')

const unsupportedBoardResult = await compileProjectTool({
  workspacePath: workspace,
  boardId: 'unsupported',
})
assert.equal(unsupportedBoardResult.status, 'failure')
assert.equal(unsupportedBoardResult.artifact, null)
assert.equal(unsupportedBoardResult.buildEvidence.category, 'compile-package-invalid')

await assert.rejects(
  () => compileProjectTool(null),
  /input must be an object/,
)
await assert.rejects(
  () => compileProjectTool({ boardId: 'szpi_esp32s3' }),
  /workspacePath is required/,
)
await assert.rejects(
  () => compileProjectTool({ workspacePath: workspace }),
  /boardId is required/,
)

const compileCapability = listCapabilities().tools.find(tool => tool.name === 'vibeboard.compile_project')
assert.equal(compileCapability.status, 'available')
assert.deepEqual(compileCapability.transports, ['stdio'])

const dispatched = await dispatchTool('vibeboard.compile_project', {
  workspacePath: workspace,
  boardId: 'szpi_esp32s3',
  projectId: 'dispatch-project',
}, {
  compilerUrl: 'http://compiler.local',
  artifactDir: await mkdtemp(join(tmpdir(), 'vibeboard-mcp-dispatch-artifacts-')),
  fetchImpl: fakeFetch,
})
assert.equal(dispatched.status, 'success')
assert.equal(dispatched.result.status, 'success')
assert.equal(dispatched.result.compilePackage.mainFile, 'main.c')

console.log('MCP compile project tests passed.')
