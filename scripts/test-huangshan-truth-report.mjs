import assert from 'node:assert/strict'
import { createHuangshanTruthReport } from '../src/domain/huangshan/truthReport.js'

const config = {
  components: [
    { id: 'light', type: 'metric', capability: 'ambient_light', label: 'Light', value: 'LTR303' },
    { id: 'motion', type: 'metric', capability: 'imu', label: 'Accel', value: 'LSM6DSL' },
    { id: 'tf', type: 'metric', capability: 'tf_card', label: 'TF', value: 'sd0' },
    { id: 'ble', type: 'bluetooth', capability: 'bluetooth', label: 'BLE', value: 'status' },
    { id: 'motor', type: 'action', capability: 'motor', label: 'Motor', value: 'pulse' },
    { id: 'status', type: 'status', capability: 'status', label: 'Status', value: 'Ready' },
  ],
}

const draft = createHuangshanTruthReport({ config })
assert.equal(draft.realCount, 5)
assert.equal(draft.placeholderCount, 0)
assert.equal(draft.uiOnlyCount, 1)
assert.equal(draft.items.find(item => item.id === 'light').canClaimReal, false)
assert.equal(draft.items.find(item => item.id === 'ble').implementation, 'real')
assert.equal(draft.items.find(item => item.id === 'motor').implementation, 'real')

const built = createHuangshanTruthReport({
  config,
  buildEvidence: successEvidence(),
})
assert.equal(built.items.find(item => item.id === 'light').canClaimReal, true)
assert.equal(built.items.find(item => item.id === 'light').canClaimVerified, false)

const verified = createHuangshanTruthReport({
  config,
  buildEvidence: successEvidence(),
  serialLogLines: ['[app] light: 123 lux', '[app] acce: 1,2,3', 'mount fs on flash to root success', 'BLE advertising enabled', 'vibrator_write return 12'],
})
assert.equal(verified.verifiedCount, 5)
assert.equal(verified.items.find(item => item.id === 'light').canClaimVerified, true)
assert.equal(verified.items.find(item => item.id === 'ble').canClaimVerified, true)
assert.equal(verified.items.find(item => item.id === 'motor').canClaimVerified, true)

console.log('huangshan truth report tests passed')

function successEvidence() {
  return {
    status: 'success',
    artifactSummary: {
      artifacts: [
        { name: 'main.bin' },
        { name: 'sftool_param.json' },
      ],
    },
  }
}
