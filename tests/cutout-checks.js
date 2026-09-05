import { createPinia, setActivePinia } from 'pinia'
import { canvas, prepareCutout, createMatte, refineMatte, composeCutout, INPUT_SIZE, MAX_STROKES, MAX_POINTS } from '../src/plugins/ai-cutout/pipeline.js'
import { createCutoutRuntime } from '../src/plugins/ai-cutout/runtime.js'
import { manifest } from '../src/plugins/ai-cutout/manifest.js'
import { manifest as removal } from '../src/plugins/ai-remove/manifest.js'
import { createPhotoHost, pluginActivity } from '../src/plugins/host.js'
import { plugins } from '../src/plugins/registry.js'
import { useLibraryStore } from '../src/stores/library.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import { loadDraft, deleteDraft, projectBlob, readProject } from '../src/lib/drafts.js'
import { readPhotoMetadata } from '../src/lib/photoMetadata.js'

const assert = (ok, message) => { if (!ok) throw new Error(message) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
export async function cutoutChecks(check) {
  await check('Cutout is a separate lazy plugin with its own pinned model and capabilities', async () => {
    assert(plugins.filter(entry => entry.manifest.id === manifest.id).length === 1 && plugins.some(entry => entry.manifest.id === removal.id), 'cutout/removal not registered uniquely')
    assert(manifest.model.id !== removal.model.id && manifest.model.sha256.length === 64 && manifest.capabilities.includes('model.birefnet-lite-v1'), 'model separation missing')
    assert((await plugins.find(p => p.manifest.id === manifest.id).load()).default, 'lazy UI import failed')
  })
  await check('Cutout input is RGB NCHW, ImageNet-normalized, and alpha-flattened only for inference', () => {
    const source = canvas(5, 9), ctx = source.getContext('2d')
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 5, 9)
    const { image } = prepareCutout(source), area = INPUT_SIZE ** 2
    assert(image.length === area * 3 && Math.abs(image[0] - (1 - .485) / .229) < .00001, 'wrong red normalization')
    assert(Math.abs(image[area] + .456 / .224) < .00001 && Math.abs(image[area * 2] + .406 / .225) < .00001, 'wrong channel order')
    ctx.clearRect(0, 0, 5, 9)
    const transparent = prepareCutout(source).image
    assert(Math.abs(transparent[0] - image[0]) < .00001 && pixels(source).every(n => n === 0), 'inference destroyed source alpha')
    let rejected = false
    try { prepareCutout({ width: 6000, height: 5000 }) } catch { rejected = true }
    assert(rejected, 'oversize source accepted')
  })
  await check('BiRefNet logits use stable sigmoid including constant and extreme predictions', () => {
    const values = new Float32Array(INPUT_SIZE ** 2), source = canvas(10, 5)
    assert(pixels(createMatte(values, source))[3] === 128, 'zero logits are not half opacity')
    values.fill(-1000); assert(pixels(createMatte(values, source))[3] === 0, 'negative logits not transparent')
    values.fill(1000); assert(pixels(createMatte(values, source))[3] === 255, 'positive logits not opaque')
    for (const bad of [new Float32Array(10), values.fill(NaN), new Uint8Array(INPUT_SIZE ** 2)]) {
      let failed = false; try { createMatte(bad, source) } catch { failed = true }; assert(failed, 'invalid model output accepted')
    }
    const wide = createMatte(new Float32Array(INPUT_SIZE ** 2), { width: 5000, height: 200 })
    assert(wide.width === 2048 && wide.height === 82, 'panorama mask geometry incorrect')
  })
  await check('Soft mask bias and feather preserve intermediate alpha without thresholding', () => {
    const base = canvas(40, 20), ctx = base.getContext('2d')
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(0, 0, 40, 20)
    const low = pixels(refineMatte(base, { balance: -25 }))[3], neutral = pixels(refineMatte(base))[3], high = pixels(refineMatte(base, { balance: 25 }))[3]
    assert(0 < low && low < neutral && neutral < high && high < 255, 'edges turned binary or bias inverted')
    ctx.clearRect(0, 0, 40, 20); ctx.fillStyle = '#fff'; ctx.fillRect(10, 5, 20, 10)
    const feathered = pixels(refineMatte(base, { feather: 2 }))
    assert(feathered[(10 * 40 + 9) * 4 + 3] > 0, 'soft edge not expanded')
    ctx.fillRect(0, 0, 40, 20)
    const borderAlpha = pixels(refineMatte(base, { feather: 3 }))[3]
    assert(borderAlpha === 255, 'feather invented a transparent frame: ' + borderAlpha)
  })
  await check('Manual restore/remove replay supports holes, deterministic undo and bounded data', () => {
    const base = canvas(100, 50), ctx = base.getContext('2d'); ctx.fillRect(0, 0, 100, 50)
    // A mask is white RGB + alpha; source colors must never come from the mask.
    const remove = { erase: true, size: .25, points: [[.5, .5]] }, restore = { erase: false, size: .1, points: [[.5, .5]] }
    const a = pixels(refineMatte(base, {}, [remove])), b = pixels(refineMatte(base, {}, [remove, restore]))
    const center = (25 * 100 + 50) * 4 + 3
    assert(a[center] === 0 && b[center] === 255, 'correction polarity wrong')
    assert(pixels(refineMatte(base, {}, [remove])).every((n, i) => n === a[i]), 'undo replay not deterministic')
    for (const strokes of [Array(MAX_STROKES + 1).fill(remove), [{ ...remove, points: Array(MAX_POINTS + 1).fill([.5, .5]) }], [{ ...remove, size: NaN }], [{ ...remove, points: [[-1, 0]] }]]) {
      let rejected = false; try { refineMatte(base, {}, strokes) } catch { rejected = true }; assert(rejected, 'invalid correction accepted')
    }
  })
  await check('Cutout multiplies existing alpha, preserves opaque colors and source dimensions', () => {
    const source = canvas(4, 1), ctx = source.getContext('2d')
    ctx.putImageData(new ImageData(new Uint8ClampedArray([220, 80, 30, 255, 40, 80, 100, 128, 10, 20, 30, 0, 60, 70, 80, 255]), 4, 1), 0, 0)
    const before = pixels(source).slice(), mask = canvas(4, 1), mctx = mask.getContext('2d')
    mctx.fillStyle = '#fff'; mctx.fillRect(0, 0, 3, 1)
    const output = composeCutout(source, mask), p = pixels(output)
    assert(output.width === 4 && output.height === 1 && p[3] === 255 && p[7] === 128 && p[11] === 0 && p[15] === 0, 'source transparency/dimensions lost')
    assert(p[0] === 220 && p[1] === 80 && p[2] === 30 && pixels(source).every((n, i) => n === before[i]), 'source RGB was recolored')
  })
  await check('Cutout native bridge bounds concurrent jobs, filters progress and ignores canceled results', async () => {
    let handler, complete, requests = [], cancellations = [], released = 0
    const runtime = createCutoutRuntime({ api: {
      onAiCutoutProgress: callback => { handler = callback; return () => { released++ } },
      aiCutoutRun: request => { requests.push(request); return new Promise(resolve => { complete = resolve }) },
      aiCutoutCancel: async id => { cancellations.push(id) },
    } })
    const phases = [], first = runtime.run({ image: new Float32Array(3) }, phase => phases.push(phase)).catch(e => e.name)
    await pause(0)
    handler({ id: 'stale', phase: 'wrong' }); handler({ id: requests[0].id, phase: 'correct' })
    assert(phases.join(',') === 'correct', 'unrelated progress delivered')
    assert(await runtime.run({ image: new Float32Array(3) }).then(() => false, () => true), 'concurrent job accepted')
    runtime.dispose(); complete(new Float32Array(1))
    assert(await first === 'AbortError' && released === 1 && cancellations[0] === requests[0].id, 'canceled job was not released')
    const second = runtime.run({ image: new Float32Array(3) }); await pause(0); complete(new Float32Array([2]))
    assert((await second)[0] === 2 && released === 2 && requests[0].id !== requests[1].id && !requests[0].model, 'retry/result was stale or exposed model bytes')
    runtime.dispose()
  })
  await check('Cutout variants retain transparency, correct provenance and camera metadata across project restore', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore(), source = canvas(24, 12)
    source.getContext('2d').fillRect(0, 0, 24, 12)
    const file = new File([await canvasToBlob(source, 'png', 1, { Make: 'Camera B', GPSLatitude: [25, 2, 3], GPSLatitudeRef: 'N' })], 'portrait.png', { type: 'image/png' })
    await library.addFiles([file]); await pause(200)
    const host = createPhotoHost(manifest), other = createPhotoHost(removal)
    let id
    try {
      const captured = await host.capture()
      let blocked = false; try { await other.capture() } catch { blocked = true }
      assert(blocked && pluginActivity.active, 'two workspaces opened')
      const matte = canvas(24, 12); matte.getContext('2d').fillRect(0, 0, 12, 12)
      id = await host.apply(composeCutout(captured.canvas, matte), { operation: 'background-removal', edge: { balance: 0, feather: 0 } }); host.release()
      const saved = await loadDraft(id), meta = await readPhotoMetadata(saved.file)
      assert(saved.file.name.endsWith('-cutout.png') && saved.state.extensions['ai-cutout'].modelSha256 === manifest.model.sha256, 'wrong suffix/provenance')
      assert(meta.Software === 'Imejii / AI background removal' && meta.Make === 'Camera B' && !meta.GPSLatitude, 'metadata or GPS privacy incorrect')
      const image = await createImageBitmap(saved.file), decoded = canvas(image.width, image.height)
      decoded.getContext('2d').drawImage(image, 0, 0); image.close()
      const p = pixels(decoded); assert(p[3] === 255 && p[23 * 4 + 3] === 0, 'PNG transparency flattened')
      const reexported = await readPhotoMetadata(await canvasToBlob(decoded, 'png', 1, meta))
      assert(reexported.Software === meta.Software, 're-export lost AI provenance')
      assert(library.items[0].file === file && library.hasSavedEdits(library.activeItem), 'source changed or cutout not durable')
      const project = await readProject(await projectBlob(saved.file, 'photo', saved.state))
      setActivePinia(createPinia()); const reopened = useLibraryStore(); await reopened.restoreDraft(project)
      assert(reopened.activeItem.extensions['ai-cutout'].operation === 'background-removal', 'project restore lost cutout')
    } finally { host.release(); other.release(); if (id) await deleteDraft(id) }
    assert(!pluginActivity.active, 'workspace lock leaked')
  })
}
