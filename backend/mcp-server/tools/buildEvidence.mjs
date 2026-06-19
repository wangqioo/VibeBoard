import { resolve } from 'node:path'

import { readBuildEvidenceRecord } from './artifacts.mjs'
import { requireObject } from './validate.mjs'

function defaultArtifactDir() {
  return resolve(process.cwd(), 'outputs', 'mcp-artifacts')
}

export async function getBuildEvidenceTool(input = {}) {
  const params = requireObject(input)
  if (!params.projectId) throw new Error('projectId is required')

  const artifactDir = params.artifactDir || defaultArtifactDir()

  try {
    const record = await readBuildEvidenceRecord({
      artifactDir,
      projectId: params.projectId,
    })
    return {
      status: 'success',
      record,
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'not-found',
        record: null,
        message: `no build evidence found for projectId: ${params.projectId}`,
      }
    }
    throw error
  }
}
