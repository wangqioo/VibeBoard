import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-python-runner-'))
const missingModuleTest = join(tmp, 'missing_module.py')
const assertionFailureTest = join(tmp, 'assertion_failure.py')

await writeFile(missingModuleTest, 'import definitely_missing_vibeboard_package\n')
await writeFile(assertionFailureTest, 'raise AssertionError("real python failure")\n')

function runRunner(scriptPath) {
  return spawnSync(process.execPath, ['scripts/run-python-test.mjs', scriptPath], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  })
}

const result = runRunner(missingModuleTest)

const output = `${result.stdout}\n${result.stderr}`

assert.notEqual(result.status, 0, 'missing Python modules must fail the test run')
assert.match(output, /Missing Python package: definitely_missing_vibeboard_package/)
assert.match(output, /python3 -m venv \.venv/)
assert.match(output, /pip install -r backend\/compiler-service\/requirements-dev\.txt/)

const assertionResult = runRunner(assertionFailureTest)
const assertionOutput = `${assertionResult.stdout}\n${assertionResult.stderr}`

assert.notEqual(assertionResult.status, 0, 'real Python failures must stay failing')
assert.match(assertionOutput, /AssertionError: real python failure/)
assert.doesNotMatch(assertionOutput, /Missing Python package:/)

console.log('run-python-test runner tests passed')
