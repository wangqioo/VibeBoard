import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-acceptance-checks-'))

async function copyModule(relPath) {
  const source = new URL(`../${relPath}`, import.meta.url)
  const target = join(tmp, relPath)
  await mkdir(dirname(target), { recursive: true })
  let code = await readFile(source, 'utf8')
  code = code.replaceAll(/from '(\.[^']+)'/g, (match, spec) => {
    if (spec.endsWith('.js')) return match
    return `from '${spec}.js'`
  })
  await writeFile(target, code)
  return target
}

await copyModule('src/domain/workflow/outcome.js')
await copyModule('src/domain/workflow/failureCategories.js')
await copyModule('src/domain/evidence/devicePatterns.js')
await copyModule('src/domain/evidence/deviceEvidence.js')
await copyModule('src/domain/evidence/buildEvidence.js')
await copyModule('src/domain/workflow/acceptanceChecks.js')

const { WORKFLOW_STATUS } = await import(pathToFileURL(join(tmp, 'src/domain/workflow/outcome.js')).href)
const { createBuildEvidence } = await import(pathToFileURL(join(tmp, 'src/domain/evidence/buildEvidence.js')).href)
const { createDeviceEvidence } = await import(pathToFileURL(join(tmp, 'src/domain/evidence/deviceEvidence.js')).href)
const {
  ACCEPTANCE_CHECK_STATUS,
  evaluateAcceptanceChecks,
} = await import(pathToFileURL(join(tmp, 'src/domain/workflow/acceptanceChecks.js')).href)

const manifest = {
  acceptanceChecks: [
    'serial log contains READY',
    'WiFi connects',
    'LCD shows status',
  ],
}

const buildEvidence = createBuildEvidence({
  status: WORKFLOW_STATUS.SUCCESS,
  size: 128000,
  logLines: ['build complete'],
})

const deviceEvidence = createDeviceEvidence({
  lines: [
    'I (2030) app: READY',
    'I (5000) wifi: got ip: 192.168.1.53',
  ],
})

const result = evaluateAcceptanceChecks({ manifest, buildEvidence, deviceEvidence })
assert.equal(result.status, ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION)
assert.equal(result.checks[0].status, ACCEPTANCE_CHECK_STATUS.PASSES)
assert.equal(result.checks[1].status, ACCEPTANCE_CHECK_STATUS.PASSES)
assert.equal(result.checks[2].status, ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION)
assert.match(result.summary, /2\/3/)

const failedBuild = evaluateAcceptanceChecks({
  manifest,
  buildEvidence: createBuildEvidence({
    status: WORKFLOW_STATUS.FAILURE,
    error: 'fatal error: app.h: No such file or directory',
    logLines: ['main/main.c:1:10: fatal error: app.h: No such file or directory'],
  }),
})
assert.equal(failedBuild.status, ACCEPTANCE_CHECK_STATUS.FAILED)
assert.equal(failedBuild.checks.every(check => check.status === ACCEPTANCE_CHECK_STATUS.FAILED), true)
assert.match(failedBuild.summary, /Build failed/)

const runtimeFailure = evaluateAcceptanceChecks({
  manifest,
  buildEvidence,
  deviceEvidence: createDeviceEvidence({
    lines: ['Guru Meditation Error: Core  1 panic'],
  }),
})
assert.equal(runtimeFailure.status, ACCEPTANCE_CHECK_STATUS.FAILED)
assert.equal(runtimeFailure.failureCategory, 'runtime-failed')
assert.match(runtimeFailure.summary, /runtime symptom/)

const emptyManifest = evaluateAcceptanceChecks({ manifest: {}, buildEvidence, deviceEvidence })
assert.equal(emptyManifest.status, ACCEPTANCE_CHECK_STATUS.NEEDS_OBSERVATION)
assert.equal(emptyManifest.checks.length, 0)
assert.match(emptyManifest.summary, /No acceptance checks/)

console.log('acceptance checks tests passed')
