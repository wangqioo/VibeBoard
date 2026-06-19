import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  readWorkspaceProjectFiles,
} from '../backend/mcp-server/tools/workspaceFiles.mjs'

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

console.log('MCP compile project tests passed.')
