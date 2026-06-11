import { getHuangshanCapabilityContract } from './capabilityContracts.js'

const UI_ONLY_CAPABILITIES = new Set(['status'])
const PLACEHOLDER_CAPABILITIES = new Set([])

export function createHuangshanTruthReport({
  config = {},
  buildEvidence = null,
  serialLogLines = [],
} = {}) {
  const components = Array.isArray(config.components) ? config.components : []
  const buildPassed = buildEvidence?.status === 'success'
  const artifactNames = new Set((buildEvidence?.artifactSummary?.artifacts || []).map(item => item.name))
  const artifactsReady = artifactNames.has('main.bin') && artifactNames.has('sftool_param.json')
  const serialText = serialLogLines.join('\n')
  const items = components
    .filter(component => component.enabled !== false)
    .map(component => createTruthItem({ component, buildPassed, artifactsReady, serialText }))

  return {
    buildPassed,
    artifactsReady,
    verifiedCount: items.filter(item => item.canClaimVerified).length,
    realCount: items.filter(item => item.implementation === 'real').length,
    placeholderCount: items.filter(item => item.implementation === 'placeholder').length,
    uiOnlyCount: items.filter(item => item.implementation === 'ui-only').length,
    items,
  }
}

function createTruthItem({ component, buildPassed, artifactsReady, serialText }) {
  const contract = getHuangshanCapabilityContract(component.capability)
  const evidencePatterns = contract?.evidencePatterns || []
  const serialVerified = evidencePatterns.length > 0 &&
    evidencePatterns.some(pattern => serialText.includes(pattern))
  const implementation = implementationForCapability(component.capability, evidencePatterns)

  return {
    id: component.id || `${component.type}-${component.label}`,
    label: component.label || component.type,
    capability: component.capability || 'status',
    implementation,
    dataSource: contract?.label || 'UI state',
    exampleReferences: contract?.exampleReferences || [],
    evidencePatterns,
    buildPassed,
    artifactsReady,
    serialVerified,
    canClaimReal: implementation === 'real' && buildPassed && artifactsReady,
    canClaimVerified: implementation === 'real' && buildPassed && artifactsReady && serialVerified,
  }
}

function implementationForCapability(capability, evidencePatterns) {
  if (PLACEHOLDER_CAPABILITIES.has(capability)) return 'placeholder'
  if (UI_ONLY_CAPABILITIES.has(capability)) return 'ui-only'
  return evidencePatterns.length > 0 ? 'real' : 'ui-only'
}
