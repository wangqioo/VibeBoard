import { spawnSync } from 'node:child_process'

const [, , scriptPath, ...args] = process.argv

if (!scriptPath) {
  console.error('Usage: node scripts/run-python-test.mjs <script.py> [args...]')
  process.exit(2)
}

const candidates = [
  { command: 'python3', args: [scriptPath, ...args] },
  { command: 'python', args: [scriptPath, ...args] },
  { command: 'py', args: ['-3', scriptPath, ...args] },
]

let lastError = null

function writeOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
}

function findMissingModule(result) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const match = output.match(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/)
  return match?.[1] ?? null
}

function printDependencyHint(moduleName) {
  console.error('')
  console.error(`Missing Python package: ${moduleName}`)
  console.error('Install the local compiler-service test dependencies without using global packages:')
  console.error('  python3 -m venv .venv')
  console.error('  . .venv/bin/activate')
  console.error('  python -m pip install -r backend/compiler-service/requirements-dev.txt')
}

for (const candidate of candidates) {
  const result = spawnSync(candidate.command, candidate.args, {
    encoding: 'utf8',
    shell: false,
  })

  if (result.error) {
    lastError = result.error
    if (result.error.code === 'ENOENT') {
      continue
    }
    continue
  }

  writeOutput(result)
  const missingModule = findMissingModule(result)
  if (missingModule) {
    printDependencyHint(missingModule)
  }
  process.exit(result.status ?? 1)
}

console.error('Unable to find a Python 3 interpreter for test script.')
if (lastError) {
  console.error(lastError.message)
}
process.exit(127)
