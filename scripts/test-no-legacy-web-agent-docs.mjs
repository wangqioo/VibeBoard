import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const activeRoots = [
  'README.md',
  'CONTEXT.md',
  'AGENTS.md',
  'docs',
]

const ignoredPrefixes = [
  'docs/archive/',
  'docs/business/',
  'docs/superpowers/specs/2026-06-19-agent-mcp-hardware-console-design.md',
  'docs/superpowers/plans/2026-06-19-agent-mcp-hardware-console.md',
]

const forbidden = [
  /current[^.\n]*ChatPanel/i,
  /ChatPanel[^.\n]*current/i,
  /AI 工作流/,
  /browser-hosted AI chat as the primary/i,
  /natural-language hardware automation/i,
  /Strengthen the AI repair loop/i,
]

function walk(filePath) {
  const stat = fs.statSync(filePath)
  if (stat.isDirectory()) {
    return fs.readdirSync(filePath).flatMap(name => walk(path.join(filePath, name)))
  }
  return [filePath]
}

const files = activeRoots
  .flatMap(root => walk(path.join(repoRoot, root)))
  .filter(file => /\.(md|mdx|txt)$/.test(file))
  .filter(file => {
    const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/')
    return !ignoredPrefixes.some(prefix => rel.startsWith(prefix))
  })

const failures = []
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      failures.push(`${path.relative(repoRoot, file)} matches ${pattern}`)
    }
  }
}

if (failures.length) {
  console.error('Legacy web-agent guidance found in active docs:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Checked ${files.length} active docs for legacy web-agent guidance.`)
