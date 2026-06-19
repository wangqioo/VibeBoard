import { resolve } from 'node:path'

import {
  writeBuildEvidenceRecord,
  writeCompileArtifacts,
} from './artifacts.mjs'
import { compileProjectWithService } from './compilerClient.mjs'
import { requireObject } from './validate.mjs'
import { readWorkspaceProjectFiles } from './workspaceFiles.mjs'

const SUPPORTED_BOARD_IDS = new Set(['szpi_esp32s3'])
const SAFE_SKILL_ID = /^[A-Za-z0-9_-]{1,64}$/

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

function detectMainFile(projectFiles) {
  if (/\bapp_main\s*\(/.test(projectFiles['main/main.cpp'] || '')) return 'main.cpp'
  if (/\bapp_main\s*\(/.test(projectFiles['main/main.c'] || '')) return 'main.c'
  if (projectFiles['main/main.c'] !== undefined) return 'main.c'
  if (projectFiles['main/main.cpp'] !== undefined) return 'main.cpp'
  return null
}

function normalizeSelectedSkills(value) {
  if (!Array.isArray(value)) return []

  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => SAFE_SKILL_ID.test(item))
}

function invalidCompilePackage({ error, diagnostics, mainFile = null, selectedSkills = [] }) {
  return {
    status: 'failure',
    artifact: null,
    buildEvidence: {
      status: 'failure',
      category: 'compile-package-invalid',
      error,
    },
    diagnostics,
    logs: [],
    compilePackage: {
      mainFile,
      selectedSkills,
    },
  }
}

async function persistBuildEvidence({
  artifactDir,
  projectId,
  result,
}) {
  await writeBuildEvidenceRecord({
    artifactDir,
    projectId,
    status: result.status,
    buildEvidence: result.buildEvidence,
    artifact: result.artifact,
    diagnostics: result.diagnostics,
    logs: result.logs,
    compilePackage: result.compilePackage,
  })
}

export async function compileProjectTool(input = {}, adapters = {}) {
  const params = requireObject(input)
  if (!params.workspacePath) throw new Error('workspacePath is required')
  if (!params.boardId) throw new Error('boardId is required')

  const selectedSkills = normalizeSelectedSkills(params.selectedSkills)
  const projectId = params.projectId || params.boardId || 'project'
  const artifactDir = adapters.artifactDir || params.artifactDir || defaultArtifactDir()

  if (!SUPPORTED_BOARD_IDS.has(params.boardId)) {
    const result = invalidCompilePackage({
      error: `unsupported boardId: ${params.boardId}`,
      diagnostics: [{
        category: 'unsupported-board',
        message: `unsupported boardId: ${params.boardId}`,
      }],
      selectedSkills,
    })
    await persistBuildEvidence({ artifactDir, projectId, result })
    return result
  }

  const projectFiles = await readWorkspaceProjectFiles({ workspacePath: params.workspacePath })
  const mainFile = detectMainFile(projectFiles)

  if (!mainFile) {
    const result = invalidCompilePackage({
      error: 'missing entry file: main/main.c or main/main.cpp',
      diagnostics: [{
        category: 'missing-entry-file',
        message: 'missing entry file: main/main.c or main/main.cpp',
      }],
      selectedSkills,
    })
    await persistBuildEvidence({ artifactDir, projectId, result })
    return result
  }

  const compileResult = await compileProjectWithService({
    compilerUrl: adapters.compilerUrl || params.compilerUrl,
    payload: {
      projectId,
      code: projectFiles[`main/${mainFile}`],
      projectFiles: {
        ...projectFiles,
        __mainFile: mainFile,
        __selectedSkills: selectedSkills,
      },
    },
    fetchImpl: adapters.fetchImpl,
  })

  if (compileResult.status !== 'success') {
    const result = {
      status: 'failure',
      artifact: null,
      buildEvidence: compileResult.buildEvidence,
      diagnostics: [],
      logs: compileResult.logs,
      compilePackage: {
        mainFile,
        selectedSkills,
      },
    }
    await persistBuildEvidence({ artifactDir, projectId, result })
    return result
  }

  const artifact = await writeCompileArtifacts({
    artifactDir,
    projectId,
    firmware: compileResult.firmware,
    flashFiles: compileResult.flashFiles,
  })

  const result = {
    status: 'success',
    artifact,
    buildEvidence: compileResult.buildEvidence,
    diagnostics: [],
    logs: compileResult.logs,
    compilePackage: {
      mainFile,
      selectedSkills,
    },
  }
  await persistBuildEvidence({ artifactDir, projectId, result })
  return result
}
