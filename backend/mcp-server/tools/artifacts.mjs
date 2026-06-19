import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

function safeName(name, fallback) {
  return String(name || fallback).replace(/[^A-Za-z0-9_.-]/g, '_')
}

export async function writeCompileArtifacts({
  artifactDir,
  projectId = 'project',
  firmware,
  flashFiles = [],
} = {}) {
  if (!artifactDir) throw new Error('artifactDir is required')
  if (!firmware?.base64) throw new Error('firmware base64 is required')

  const projectDir = join(artifactDir, safeName(projectId, 'project'))
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
