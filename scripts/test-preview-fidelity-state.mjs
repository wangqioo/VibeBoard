import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = await mkdtemp(join(tmpdir(), 'vibeboard-preview-fidelity-'))

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

await copyModule('src/utils/preview.js')

const {
  PREVIEW_STATUS,
  createPreviewFidelityState,
} = await import(pathToFileURL(join(tmp, 'src/utils/preview.js')).href)

const componentSource = await readFile(new URL('../src/components/DigitalTwinPreview.jsx', import.meta.url), 'utf8')

const noContract = createPreviewFidelityState({
  hasSemanticPreview: true,
  canRenderLvgl: false,
  serviceStatus: null,
  lvglPreview: null,
  lvglPreviewState: PREVIEW_STATUS.IDLE,
})

assert.deepEqual(noContract.map(item => item.id), ['semantic', 'service', 'real-lvgl'])
assert.equal(noContract[0].label, '语义预览')
assert.equal(noContract[0].state, 'available')
assert.equal(noContract[0].detail, '不是固件证明')
assert.equal(noContract[1].state, 'unknown')
assert.equal(noContract[2].state, 'unavailable')
assert.equal(noContract[2].detail, '缺少 LVGL 预览入口')

const ready = createPreviewFidelityState({
  hasSemanticPreview: true,
  canRenderLvgl: true,
  serviceStatus: { realPreviewReady: true },
  lvglPreview: { renderer: 'real-lvgl-8.3-headless', screenshotPng: 'abc' },
  lvglPreviewState: PREVIEW_STATUS.SUCCESS,
})

assert.equal(ready[1].state, 'available')
assert.equal(ready[1].detail, '服务可达')
assert.equal(ready[2].state, 'available')
assert.equal(ready[2].detail, '真实 LVGL framebuffer')

const fallbackRenderer = createPreviewFidelityState({
  hasSemanticPreview: true,
  canRenderLvgl: true,
  serviceStatus: { realPreviewReady: false },
  lvglPreview: { renderer: 'intent-lvgl-preview', screenshotPng: 'abc' },
  lvglPreviewState: PREVIEW_STATUS.SUCCESS,
})

assert.equal(fallbackRenderer[1].state, 'degraded')
assert.equal(fallbackRenderer[1].detail, '仅 fallback renderer')
assert.equal(fallbackRenderer[2].state, 'degraded')
assert.equal(fallbackRenderer[2].detail, '仍是意图渲染')

assert.match(componentSource, /checkLvglPreviewStatus/)
assert.match(componentSource, /createPreviewFidelityState/)
assert.match(componentSource, /previewFidelity/)
assert.match(componentSource, /dt-fidelity/)
assert.match(componentSource, /onPreviewContextChange\(\{[\s\S]*previewFidelity/)

console.log('preview fidelity state tests passed')
