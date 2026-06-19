import { createHash } from 'node:crypto'

function fileContentToString(content) {
  if (content == null) return ''
  return String(content)
}

function comparePaths(a, b) {
  if (a.path < b.path) return -1
  if (a.path > b.path) return 1
  return 0
}

export function createEvidencePackage({
  boardId,
  selectedSkills = [],
  manifest = null,
  projectFiles = {},
  buildEvidence = null,
  deviceEvidence = null,
  artifact = null,
  createdAt = new Date().toISOString(),
} = {}) {
  return {
    schemaVersion: 1,
    createdAt,
    boardId: boardId || null,
    selectedSkills: [...selectedSkills],
    manifest,
    projectFiles: Object.entries(projectFiles)
      .map(([path, content]) => {
        const fileContent = fileContentToString(content)
        return {
          path,
          bytes: Buffer.byteLength(fileContent, 'utf8'),
          sha256: createHash('sha256').update(fileContent).digest('hex'),
        }
      })
      .sort(comparePaths),
    buildEvidence,
    deviceEvidence,
    artifact,
  }
}
