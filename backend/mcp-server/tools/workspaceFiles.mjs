import { readdir, readFile, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

const ALLOWED_ROOTS = new Set(['main', 'components', 'spiffs'])
const ALLOWED_EXTENSIONS = /\.(c|cc|cpp|cxx|h|hpp|s)$/i

function toPosix(path) {
  return path.split(sep).join('/')
}

function assertInsideWorkspace(workspaceRoot, candidate) {
  const rel = relative(workspaceRoot, candidate)
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) {
    throw new Error(`path escapes workspace: ${candidate}`)
  }
}

function isAllowedProjectFile(relPath) {
  const posix = toPosix(relPath)
  const [root] = posix.split('/')
  return ALLOWED_ROOTS.has(root) && ALLOWED_EXTENSIONS.test(posix)
}

async function walkFiles(dir, workspaceRoot, output) {
  assertInsideWorkspace(workspaceRoot, dir)

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name)
    assertInsideWorkspace(workspaceRoot, fullPath)

    if (entry.isDirectory()) {
      await walkFiles(fullPath, workspaceRoot, output)
      continue
    }

    if (!entry.isFile()) continue

    const rel = toPosix(relative(workspaceRoot, fullPath))
    if (!isAllowedProjectFile(rel)) continue

    output[rel] = await readFile(fullPath, 'utf8')
  }
}

export async function readWorkspaceProjectFiles({ workspacePath } = {}) {
  if (!workspacePath) throw new Error('workspacePath is required')

  const workspaceRoot = resolve(workspacePath)
  const info = await stat(workspaceRoot).catch(() => null)
  if (!info?.isDirectory()) {
    throw new Error(`workspacePath is not a directory: ${workspacePath}`)
  }

  const files = {}
  await walkFiles(workspaceRoot, workspaceRoot, files)
  return files
}
