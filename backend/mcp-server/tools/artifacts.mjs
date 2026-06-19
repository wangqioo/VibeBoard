import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function safeName(name, fallback) {
  return String(name || fallback).replace(/[^A-Za-z0-9_.-]/g, '_')
}

export function projectArtifactDir(artifactDir, projectId = 'project') {
  if (!artifactDir) throw new Error('artifactDir is required')
  return join(artifactDir, safeName(projectId, 'project'))
}

export async function writeBuildEvidenceRecord({
  artifactDir,
  projectId,
  status,
  buildEvidence,
  artifact = null,
  diagnostics = [],
  logs = [],
  compilePackage = null,
} = {}) {
  const projectDir = projectArtifactDir(artifactDir, projectId)
  await mkdir(projectDir, { recursive: true })

  const record = {
    schemaVersion: 1,
    projectId: projectId || 'project',
    status,
    buildEvidence,
    artifact,
    diagnostics,
    logs,
    compilePackage,
    updatedAt: new Date().toISOString(),
  }
  const path = join(projectDir, 'build-evidence.json')
  await writeFile(path, JSON.stringify(record, null, 2))
  return { ...record, path }
}

export async function readBuildEvidenceRecord({ artifactDir, projectId } = {}) {
  if (!projectId) throw new Error('projectId is required')
  const path = join(projectArtifactDir(artifactDir, projectId), 'build-evidence.json')
  const raw = await readFile(path, 'utf8')
  return { ...JSON.parse(raw), path }
}

export async function writeCompileArtifacts({
  artifactDir,
  projectId = 'project',
  firmware,
  flashFiles = [],
} = {}) {
  if (!firmware?.base64) throw new Error('firmware base64 is required')

  const projectDir = projectArtifactDir(artifactDir, projectId)
  await mkdir(projectDir, { recursive: true })

  const firmwareName = safeName(firmware.filename, 'firmware.bin')
  const firmwarePath = join(projectDir, firmwareName)
  const firmwareBytes = Buffer.from(firmware.base64, 'base64')
  await writeFile(firmwarePath, firmwareBytes)

  const writtenFlashFiles = []
  for (const file of flashFiles || []) {
    if (!file?.bin) continue

    const name = safeName(file.name, 'flash.bin')
    const filePath = join(projectDir, name)
    const bytes = Buffer.from(file.bin, 'base64')
    await writeFile(filePath, bytes)
    writtenFlashFiles.push({
      name,
      offset: file.offset || null,
      path: filePath,
      size: file.size || bytes.length,
    })
  }

  return {
    firmware: {
      filename: firmwareName,
      path: firmwarePath,
      size: firmware.size || firmwareBytes.length,
    },
    flashFiles: writtenFlashFiles,
  }
}

export async function writePreviewArtifact({
  artifactDir,
  projectId = 'project',
  screenshotPng,
  renderer = null,
  viewport = null,
} = {}) {
  if (!screenshotPng) return null

  const projectDir = projectArtifactDir(artifactDir, projectId)
  await mkdir(projectDir, { recursive: true })

  const path = join(projectDir, 'lvgl-preview.png')
  const bytes = Buffer.from(screenshotPng, 'base64')
  await writeFile(path, bytes)

  return {
    path,
    size: bytes.length,
    renderer,
    viewport,
  }
}
