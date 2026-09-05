import { createPinia, setActivePinia } from 'pinia'
import { drawStrokes, maskBounds, contextRegion, compositePixels } from '../src/plugins/ai-remove/mask.js'
import { prepareRemoval, composeRemoval } from '../src/plugins/ai-remove/pipeline.js'
import { createRemovalRuntime } from '../src/plugins/ai-remove/runtime.js'
import { createPhotoHost, pluginActivity } from '../src/plugins/host.js'
import { manifest } from '../src/plugins/ai-remove/manifest.js'
import { validatePlugin } from '../src/plugins/registry.js'
import { useLibraryStore } from '../src/stores/library.js'
import { loadDraft, deleteDraft, projectBlob, readProject } from '../src/lib/drafts.js'
import { readPhotoMetadata } from '../src/lib/photoMetadata.js'
import { canvasToBlob } from '../src/lib/exportImage.js'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function canvas(width, height) { const c = document.createElement('canvas'); c.width = width; c.height = height; return c }
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
export async function aiChecks(check) {
  await check('Plugin manifests reject incompatible APIs and undeclared capabilities', () => {
    for (const changed of [{ hostApi: 2 }, { id: '../bad' }, { capabilities: ['filesystem'] }]) {
      let failed = false
      try { validatePlugin({ manifest: { ...manifest, ...changed }, load: () => {} }) } catch { failed = true }
      assert(failed, 'invalid manifest accepted')
    }
  })
  await check('Mask paint/erase/undo replay is deterministic and bounded', () => {
    const c = canvas(100, 50), paint = { size: .3, points: [[.3, .5], [.7, .5]] }
    drawStrokes(c, [paint]); const before = pixels(c).slice()
    const bounds = maskBounds(before, 100, 50)
    assert(bounds.x <= 23 && bounds.width >= 54, 'brush projection mismatch')
    drawStrokes(c, [paint, { size: .5, points: [[.5, .5]], erase: true }])
    assert(pixels(c)[(25 * 100 + 50) * 4 + 3] === 0, 'eraser did not erase')
    drawStrokes(c, [paint]); assert(pixels(c).every((n, i) => n === before[i]), 'undo replay drift')
    drawStrokes(c, []); assert(maskBounds(pixels(c), 100, 50) === null, 'empty mask has bounds')
  })
  await check('Context regions respect corners and non-square image geometry', () => {
    for (const [width, height] of [[5000, 200], [200, 5000], [12, 7], [1024, 512]]) {
      const region = contextRegion({ x: 80, y: 80, width: 20, height: 20 }, 100, 100, width, height)
      assert(region.x >= 0 && region.y >= 0 && region.x + region.width <= width && region.y + region.height <= height, 'crop escapes source')
      assert(region.x + region.width >= width && region.y + region.height >= height, 'edge selection lost')
    }
  })
  await check('Composition leaves unmasked RGBA bytes and all alpha values untouched', () => {
    const source = new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 127, 90, 100, 110, 255])
    compositePixels(source, new Uint8ClampedArray(12).fill(200), new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255]))
    assert(source[0] === 10 && source[1] === 20 && source[2] === 30 && source[3] === 0 && source[7] === 127 && source[11] === 255, 'outside/alpha changed')
    assert(source[4] === 120 && source[8] === 200, 'incorrect blend')
  })
  await check('Full-resolution inpainting projection changes only the composition mask', () => {
    const source = canvas(900, 200), mask = canvas(900, 200), ctx = source.getContext('2d')
    ctx.fillStyle = '#643214'; ctx.fillRect(0, 0, 900, 200)
    mask.getContext('2d').fillRect(450, 90, 20, 20)
    const prepared = prepareRemoval(source, mask)
    assert(prepared.image.length === 512 * 512 * 3 && prepared.mask.some(n => n === 1), 'bad model tensors')
    assert(Math.abs(prepared.image[0] - 100 / 255) < .00001, 'input not normalized RGB')
    const result = composeRemoval(source, mask, new Float32Array(512 * 512 * 3).fill(200), prepared), before = pixels(source), after = pixels(result), alpha = pixels(mask)
    for (let i = 0; i < after.length; i += 4) if (!alpha[i + 3]) for (let c = 0; c < 4; c++) assert(after[i + c] === before[i + c], 'outside pixel changed at ' + i)
    assert(after[(100 * 900 + 460) * 4] === 200, 'output mistaken for normalized 0..1')
    let empty = false
    try { prepareRemoval(source, canvas(900, 200)) } catch { empty = true }
    assert(empty, 'empty mask accepted')
  })
  await check('Runtime cancels model loading before creating a worker and rejects concurrent jobs', async () => {
    let release, created = 0
    const runtime = createRemovalRuntime({ readModel: () => new Promise(resolve => { release = resolve }), workerFactory: () => { created++; throw new Error('should not run') } })
    const first = runtime.run({}).catch(error => error.name)
    const second = await runtime.run({}).catch(error => error.message)
    assert(second.includes('already running'), 'double start accepted')
    runtime.dispose(); release(new ArrayBuffer(1))
    assert(await first === 'AbortError', 'cancel did not reject'); await pause(10)
    assert(created === 0, 'late model load started a worker')
  })
  await check('Runtime ignores stale results, times out, and terminates owned workers', async () => {
    let terminated = 0, worker
    const runtime = createRemovalRuntime({ readModel: async () => new ArrayBuffer(1), timeout: 40, workerFactory: () => {
      worker = { terminate: () => { terminated++ }, postMessage: ({ id }) => { setTimeout(() => worker.onmessage({ data: { id: id + '-stale', output: new Float32Array(1) } }), 5) } }
      return worker
    } })
    const message = await runtime.run({ image: new Float32Array(1), mask: new Float32Array(1) }).catch(error => error.message)
    assert(message.includes('timed out') && terminated === 1, 'timeout/worker cleanup failed')
    runtime.dispose()
  })
  await check('Plugin host rejects stale snapshots and preserves durable variants without a plugin', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore()
    const source = canvas(48, 24); source.getContext('2d').fillRect(0, 0, 48, 24)
    const file = new File([await canvasToBlob(source, 'png', 1, { Make: 'Camera A', GPSLatitude: [25, 2, 3], GPSLatitudeRef: 'N' })], 'source.png', { type: 'image/png' })
    await library.addFiles([file]); await pause(200)
    const host = createPhotoHost(manifest)
    try {
      await host.capture(); library.rotateBy(90)
      let rejected = false
      try { await host.apply(source, {}) } catch { rejected = true }
      assert(rejected && library.items.length === 1, 'stale result applied')
      host.release(); library.undo(); await pause(200)
      const captured = await host.capture()
      const id = await host.apply(captured.canvas, { operation: 'object-removal' })
      host.release()
      const saved = await loadDraft(id)
      assert(saved.state.extensions['ai-remove'].modelSha256 === manifest.model.sha256, 'missing provenance')
      assert(library.hasSavedEdits(library.activeItem), 'neutral AI variant omitted from autosave')
      assert(library.items[0].file === file && library.items[0].edits.rotate === 0, 'source changed')
      const meta = await readPhotoMetadata(saved.file)
      assert(meta.Software === 'Imejii / AI object removal' && meta.Make === 'Camera A' && !meta.GPSLatitude, 'metadata/privacy incorrect')
      const project = await readProject(await projectBlob(saved.file, 'photo', saved.state))
      setActivePinia(createPinia()); const reopened = useLibraryStore()
      await reopened.restoreDraft(project)
      assert(reopened.activeItem.extensions['ai-remove'].operation === 'object-removal' && reopened.hasSavedEdits(reopened.activeItem), 'plugin-independent restore failed')
      await deleteDraft(id)
    } finally { host.release() }
    assert(!pluginActivity.active, 'host lock leaked')
  })
}
