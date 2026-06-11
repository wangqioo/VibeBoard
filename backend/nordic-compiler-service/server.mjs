import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.NORDIC_COMPILER_PORT || 8772)
const BUILD_BASE = process.env.NORDIC_BUILD_BASE || '/tmp/nordic-builds'
const SELF_TEST_MODE = process.env.NORDIC_SELF_TEST_MODE === '1'
const DEFAULT_BOARD_TARGET = 'nrf52840dk/nrf52840'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_FILE_BYTES = 512 * 1024

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      if (!body.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(body))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export function sanitizeNordicFilePath(path) {
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('..')) {
    throw new Error(`Unsafe Nordic file path: ${path || ''}`)
  }
  if (path === 'CMakeLists.txt' || path === 'prj.conf') return path
  if (/^src\/[A-Za-z0-9_./-]+\.(?:c|cpp|h|hpp|S|s)$/.test(path)) return path
  if (/^boards\/[A-Za-z0-9_./-]+\.overlay$/.test(path)) return path
  if (/^child_image\/[A-Za-z0-9_./-]+\.(?:conf|overlay)$/.test(path)) return path
  throw new Error(`Unsafe Nordic file path: ${path}`)
}

export function normalizeBoardTarget(value) {
  const target = String(value || DEFAULT_BOARD_TARGET).trim()
  if (!/^[A-Za-z0-9_/-]+$/.test(target)) {
    throw new Error(`Unsafe Nordic board target: ${target}`)
  }
  return target
}

export function writeNordicProject({ buildBase = BUILD_BASE, files = {}, boardTarget = DEFAULT_BOARD_TARGET } = {}) {
  const safeBoardTarget = normalizeBoardTarget(boardTarget)
  const projectId = randomUUID()
  const projectDir = join(buildBase, projectId)
  mkdirSync(projectDir, { recursive: true })
  const writtenFiles = []

  for (const [path, contents] of Object.entries(files || {})) {
    const safePath = sanitizeNordicFilePath(path)
    const text = String(contents ?? '')
    if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) {
      throw new Error(`Nordic file too large: ${safePath}`)
    }
    const absolutePath = join(projectDir, safePath)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, text)
    writtenFiles.push(safePath)
  }

  for (const required of ['CMakeLists.txt', 'prj.conf', 'src/main.c']) {
    if (!writtenFiles.includes(required)) {
      throw new Error(`Missing required Nordic file: ${required}`)
    }
  }

  return { projectId, projectDir, boardTarget: safeBoardTarget, writtenFiles: writtenFiles.sort() }
}

function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ZEPHYR_TOOLCHAIN_VARIANT: process.env.ZEPHYR_TOOLCHAIN_VARIANT || 'zephyr',
        ...options.env,
      },
      shell: false,
    })
    let log = ''
    child.stdout.on('data', chunk => {
      log += chunk
    })
    child.stderr.on('data', chunk => {
      log += chunk
    })
    child.on('error', error => {
      resolve({ code: -1, log: `${log}${error.message}` })
    })
    child.on('close', code => {
      resolve({ code, log })
    })
  })
}

function listArtifacts(buildDir) {
  const zephyrDir = join(buildDir, 'zephyr')
  if (!existsSync(zephyrDir)) return []
  return readdirSync(zephyrDir)
    .filter(name => /\.(?:hex|bin|elf)$/.test(name))
    .map(name => {
      const absolutePath = join(zephyrDir, name)
      return {
        name,
        relativePath: `build/zephyr/${name}`,
        size: statSync(absolutePath).size,
      }
    })
}

async function compileNordicProject({ files, boardTarget }) {
  const project = writeNordicProject({ files, boardTarget })
  if (SELF_TEST_MODE) {
    return {
      status: 'ok',
      boardTarget: project.boardTarget,
      projectId: project.projectId,
      writtenFiles: project.writtenFiles,
      artifacts: [],
      log: `nordic compiler self-test mode: west build -b ${project.boardTarget} .`,
    }
  }

  const result = await runCommand('west', ['build', '-b', project.boardTarget, '.', '-d', 'build'], {
    cwd: project.projectDir,
  })
  const artifacts = listArtifacts(join(project.projectDir, 'build'))
  return {
    status: result.code === 0 ? 'ok' : 'failure',
    boardTarget: project.boardTarget,
    projectId: project.projectId,
    writtenFiles: project.writtenFiles,
    artifacts,
    log: result.log,
  }
}

export function healthPayload() {
  const ncsHome = process.env.NCS_HOME || '/opt/ncs'
  const zephyrBase = process.env.ZEPHYR_BASE || join(ncsHome, 'zephyr')
  const hasWest = existsSync(join(ncsHome, '.venv/bin/west'))
  const hasZephyr = existsSync(zephyrBase)
  const hasSdk = existsSync(process.env.ZEPHYR_SDK_INSTALL_DIR || '/opt/zephyr-sdk-0.17.4')
  const toolchainReady = hasWest && hasZephyr && hasSdk
  return {
    service: 'nordic-compiler',
    status: SELF_TEST_MODE || toolchainReady ? 'ok' : 'toolchain-missing',
    toolchain: 'nRF Connect SDK + Zephyr',
    buildTool: 'west',
    defaultBoardTarget: DEFAULT_BOARD_TARGET,
    buildBase: BUILD_BASE,
    selfTestMode: SELF_TEST_MODE,
    checks: {
      west: hasWest,
      zephyr: hasZephyr,
      zephyrSdk: hasSdk,
    },
  }
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  try {
    if (req.method === 'GET' && url.pathname === '/nordic/health') {
      json(res, 200, healthPayload())
      return
    }
    if (req.method === 'POST' && url.pathname === '/nordic/compile') {
      const body = await readJson(req)
      const result = await compileNordicProject({
        files: body.files,
        boardTarget: body.boardTarget,
      })
      json(res, result.status === 'ok' ? 200 : 400, result)
      return
    }
    json(res, 404, { error: 'Not found' })
  } catch (error) {
    json(res, 400, { error: error.message })
  }
}

export function createServer() {
  return http.createServer(handle)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`nordic-compiler listening on http://0.0.0.0:${PORT}`)
  })
}
