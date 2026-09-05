// Real canvas, Pinia, codecs and IndexedDB. The provider is explicitly a fixture;
// these checks do not replace a real SDXL model/hardware acceptance run.
import { createPinia, setActivePinia } from 'pinia'
import { createCanvas, canvasToImageData } from '../src/lib/transform.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import { decodePhoto } from '../src/lib/photoLoader.js'
import { readPhotoMetadata } from '../src/lib/photoMetadata.js'
import { prepareInpaint, prepareOutpaint, composeInpaint, alphaFromGrayscale, INPAINT_CONTEXT } from '../src/plugins/sdxl-studio/pipeline.js'
import { grayscaleMask } from '../src/plugins/mask-transfer.js'
import { loadDraft, deleteDraft, readProject, studioProjectBlob, saveStudioDraft, sourceFingerprint } from '../src/lib/drafts.js'
import { interruptedDocument } from '../src/lib/studioDocument.js'
import { useStudioStore } from '../src/stores/studio.js'
import { usePluginStore } from '../src/stores/plugins.js'
import { useUiStore } from '../src/stores/ui.js'
import { useLibraryStore } from '../src/stores/library.js'
import { createPhotoHost } from '../src/plugins/host.js'
import { manifest as cutout } from '../src/plugins/ai-cutout/manifest.js'
const assert = (ok, message) => { if (!ok) throw new Error(message) }
const bytes = canvas => canvasToImageData(canvas).data
function source(width = 256, height = 128) {
  const c = createCanvas(width, height), ctx = c.getContext('2d')
  ctx.fillStyle = '#243a5c'; ctx.fillRect(0, 0, width, height)
  ctx.clearRect(0, 0, 3, 3); ctx.fillStyle = 'rgba(200, 30, 90, .5)'; ctx.fillRect(4, 0, 4, 4)
  return c
}
const imageFile = async (canvas, name = 'sdxl-fixture.png') => new File([await canvasToBlob(canvas, 'png')], name, { type: 'image/png' })
async function expectError(fn) { let failed = false; try { await fn() } catch { failed = true }; assert(failed, 'Invalid data accepted') }
function fresh() { setActivePinia(createPinia()); return useStudioStore() }
export async function sdxlChecks(check) {
  await check('SDXL opaque grayscale import reads luminance, preserves gray and refuses non-grayscale', () => {
    const m = createCanvas(3, 1), ctx = m.getContext('2d'), data = ctx.createImageData(3, 1)
    data.data.set([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]); ctx.putImageData(data, 0, 0)
    const converted = bytes(alphaFromGrayscale(m))
    assert(converted[3] === 0 && converted[7] === 128 && converted[11] === 255, 'PNG alpha caused full selection')
    ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 1, 1)
    let failed = false; try { alphaFromGrayscale(m) } catch { failed = true }; assert(failed, 'color mask accepted')
  })
  await check('SDXL non-square crops, padding and full-background masks preserve outside RGBA and source alpha', async () => {
    for (const [width, height, full] of [[900, 200, false], [200, 900, false], [71, 43, true]]) {
      const s = source(width, height), m = createCanvas(width, height), ctx = m.getContext('2d')
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(width / 2, height / 2, 10, 10)
      if (full) ctx.fillRect(0, 0, width, height)
      const prepared = await prepareInpaint(s, m), generated = createCanvas(1024, 1024)
      generated.getContext('2d').fillStyle = '#c8c8c8'; generated.getContext('2d').fillRect(0, 0, 1024, 1024)
      const result = composeInpaint(s, m, generated, prepared.geometry), a = bytes(s), b = bytes(result), mask = bytes(m)
      for (let i = 0; i < a.length; i += 4) {
        assert(a[i + 3] === b[i + 3], 'source alpha changed')
        if (!mask[i + 3]) for (let c = 0; c < 4; c++) assert(a[i + c] === b[i + c], 'outside pixel changed')
      }
      const modelMask = await decodePhoto(new File([prepared.mask], 'mask.png', { type: 'image/png' }))
      assert(modelMask.width === 1024 && modelMask.height === 1024, 'invalid inference dimensions')
      const fit = prepared.geometry.fit
      assert(fit.width === 1024 || fit.height === 1024, 'crop stretched or underfilled')
      if (fit.x || fit.y) assert(bytes(modelMask)[0] === 0, 'padding is selected')
    }
    await expectError(() => prepareInpaint(source(), createCanvas(256, 128)))
  })
  await check('SDXL gives small selections enough source context to preserve the scene', async () => {
    const s = source(1000, 600), m = createCanvas(1000, 600)
    m.getContext('2d').fillRect(480, 280, 20, 20)
    const prepared = await prepareInpaint(s, m), crop = prepared.geometry.crop
    assert(crop.width >= Math.ceil(s.width * INPAINT_CONTEXT) && crop.height >= Math.ceil(s.height * INPAINT_CONTEXT), 'small selection hid most scene context')
    assert(crop.x <= 480 && crop.y <= 280 && crop.x + crop.width >= 500 && crop.y + crop.height >= 300, 'context crop lost the selection')
  })
  await check('SDXL outpainting expands chosen edges and keeps the protected source interior byte-identical', async () => {
    const original = source(128, 64), prepared = await prepareOutpaint(original, { left: 64, right: 128, top: 32, bottom: 0, overlap: 16 })
    assert(prepared.outputWidth === 320 && prepared.outputHeight === 96, 'wrong outpaint canvas')
    const generated = createCanvas(1024, 1024); generated.getContext('2d').fillStyle = '#dca36a'; generated.getContext('2d').fillRect(0, 0, 1024, 1024)
    const result = composeInpaint(prepared.source, prepared.selection, generated, prepared.geometry)
    const a = bytes(original), b = bytes(result)
    for (let y = 16; y < original.height; y++) for (let x = 16; x < original.width - 16; x++) {
      const ai = (y * original.width + x) * 4, bi = ((y + 32) * result.width + x + 64) * 4
      for (let channel = 0; channel < 4; channel++) assert(a[ai + channel] === b[bi + channel], 'protected source interior changed')
    }
    await expectError(() => prepareOutpaint(original, { left: 0, right: 0, top: 0, bottom: 0, overlap: 16 }))
  })
  await check('Studio persists mask strokes, undo/redo, binary artifacts and portable multi-artifact project', async () => {
    const store = fresh(), s = source(), m = createCanvas(256, 128); m.getContext('2d').fillRect(0, 0, 256, 128)
    await store.newSource(s, 'session.png', m, { kind: 'subject-studio-before-composition', area: 'background' })
    const id = 'studio:' + store.document.id, before = bytes(store.mask())
    store.clearMask(); assert(bytes(store.mask()).every((n, i) => i % 4 !== 3 || !n), 'clear did not clear received selection')
    store.undo(); assert(bytes(store.mask()).every((n, i) => n === before[i]), 'undo did not restore selection')
    store.document.parameters.prompt = 'A quiet garden'; await store.flush()
    const entry = await loadDraft(id)
    assert(entry.artifacts.size === 2 && !entry.file && entry.state.redo.length === 1, 'artifacts mixed into original or undo lost')
    const project = await studioProjectBlob(entry.state, entry.artifacts), imported = await readProject(project)
    assert(await project.slice(0, 8).text() === 'IMEJII02' && imported.kind === 'studio', 'wrong project envelope')
    assert(imported.state.id !== entry.state.id && imported.artifacts.size === 2, 'import reused session identity')
    const restored = fresh(); await restored.restore(entry)
    assert(restored.document.parameters.prompt === 'A quiet garden' && restored.canRedo, 'session not restored')
    const legacy = structuredClone(entry.state); delete legacy.parameters.randomizeSeed; delete legacy.parameters.stylePreset; delete legacy.parameters.refinerEnabled; delete legacy.parameters.refiner
    const upgraded = interruptedDocument(legacy)
    assert(upgraded.parameters.randomizeSeed === true && upgraded.parameters.stylePreset === 'source-match' && upgraded.parameters.refinerEnabled === true && upgraded.parameters.refiner === '', 'legacy session did not receive quality defaults')
    restored.redo(); await restored.flush(); assert(bytes(restored.mask()).every((n, i) => i % 4 !== 3 || !n), 'redo changed after restart')
    const damaged = new Uint8Array(await project.arrayBuffer()); damaged[damaged.length - 1] ^= 1
    await expectError(() => readProject(new Blob([damaged])))
    await expectError(() => readProject(project.slice(0, project.size - 1)))
    await deleteDraft(id)
  })
  await check('Studio atomically rejects bad artifacts without replacing the saved session', async () => {
    const store = fresh(); await store.newSource(source(), 'atomic.png'); const id = 'studio:' + store.document.id
    const entry = await loadDraft(id), bad = new Map(entry.artifacts); bad.set(entry.state.source, new Blob(['damaged'], { type: 'image/png' }))
    await expectError(() => saveStudioDraft({ ...entry.state, revision: 99 }, bad))
    assert((await loadDraft(id)).state.revision === 0, 'failed save changed recipe')
    store.document.parameters.seed = -1
    await expectError(() => store.flush())
    assert(store.saveState === 'error' && store.dirty, 'invalid recipe left save UI stuck without error')
    store.document.parameters.seed = 0; await store.flush()
    assert(store.saveState === 'saved' && !store.dirty, 'corrected recipe could not be saved')
    await deleteDraft(id)
  })
  await check('Studio persists a community SDXL checkpoint and gates each model/workflow pair', async () => {
    const store = fresh(); await store.setOperation('text-to-image')
    const model = 'community\\dream-xl.safetensors'
    store.connection = { modelAvailable: true, models: ['sd_xl_base_1.0.safetensors', model], defaultModel: 'sd_xl_base_1.0.safetensors', validatedPairs: [] }
    store.document.parameters.model = model; await store.flush()
    assert(store.validationRequired, 'untested community checkpoint was treated as validated')
    store.connection = { ...store.connection, validatedPairs: [{ model, operation: 'text-to-image' }] }
    assert(!store.validationRequired, 'validated checkpoint/workflow pair stayed blocked')
    await store.setOperation('outpaint')
    assert(store.validationRequired, 'text validation leaked into outpainting')
    assert((await loadDraft('studio:' + store.document.id)).state.parameters.model === model, 'community checkpoint was not persisted')
    await deleteDraft('studio:' + store.document.id)
  })
  await check('Studio uses a new seed for every variant by default and can keep a fixed seed', async () => {
    const store = fresh(); await store.setOperation('text-to-image')
    store.document.parameters.prompt = 'A lantern beside a forest path'
    const generated = createCanvas(1024, 1024); generated.getContext('2d').fillRect(0, 0, 1024, 1024)
    const output = new Uint8Array(await (await canvasToBlob(generated, 'png')).arrayBuffer()), nativeApi = window.desktopApi, seeds = []
    window.desktopApi = { onAiStudioProgress: () => () => {}, aiStudioRun: async payload => {
      seeds.push(payload.parameters.seed)
      return { bytes: output, provider: 'TEST FIXTURE', providerVersion: 'test', model: payload.parameters.model, refiner: payload.parameters.refiner || null, operation: payload.operation, workflow: 'seed-test-only', validatedPairs: [{ model: payload.parameters.model, refiner: payload.parameters.refiner || undefined, operation: payload.operation }], modelSha256: null, elapsedMs: 0 }
    } }
    try {
      store.connection = { modelAvailable: true, models: [store.document.parameters.model, 'sd_xl_refiner_1.0.safetensors'], defaultModel: store.document.parameters.model, defaultRefiner: 'sd_xl_refiner_1.0.safetensors', validatedPairs: [] }
      assert(store.document.parameters.randomizeSeed === true, 'new sessions did not default to random seeds')
      await store.run(true); await store.run()
      assert(seeds.length === 2 && seeds[0] !== seeds[1], 'two variants reused the same automatic seed')
      assert(store.document.results[0].provenance.refiner === 'sd_xl_refiner_1.0.safetensors', 'automatic refiner was not submitted or recorded')
      assert(store.document.results[0].provenance.parameters.seed === seeds[0] && store.document.results[1].provenance.parameters.seed === seeds[1], 'automatic seeds were not recorded in provenance')
      store.document.parameters.randomizeSeed = false; store.document.parameters.seed = 123456
      await store.run(); await store.run()
      assert(seeds[2] === 123456 && seeds[3] === 123456, 'fixed seed changed between variants')
      await deleteDraft('studio:' + store.document.id)
    } finally { window.desktopApi = nativeApi }
  })
  await check('SDXL text-to-image creates a source-free durable variant with its own workflow contract', async () => {
    const store = fresh(); await store.setOperation('text-to-image')
    store.document.parameters.prompt = 'A quiet lake under a violet sky'; store.document.parameters.seed = 77; store.document.parameters.randomizeSeed = false
    const generated = createCanvas(1024, 1024); generated.getContext('2d').fillStyle = '#6c62a8'; generated.getContext('2d').fillRect(0, 0, 1024, 1024)
    const output = new Uint8Array(await (await canvasToBlob(generated, 'png')).arrayBuffer()), nativeApi = window.desktopApi
    let submitted
    window.desktopApi = { onAiStudioProgress: () => () => {}, aiStudioRun: async payload => { submitted = payload; return { bytes: output, provider: 'TEST FIXTURE', providerVersion: 'test', model: payload.parameters.model, operation: payload.operation, workflow: 'text-test-only', validatedPairs: [{ model: payload.parameters.model, operation: 'text-to-image' }], modelSha256: null, elapsedMs: 0 } } }
    try {
      store.connection = { modelAvailable: true, operations: [] }; await store.run(true)
      assert(submitted.operation === 'text-to-image' && !('image' in submitted) && !('mask' in submitted), 'text workflow received image inputs')
      assert(store.selectedResult.provenance.operation === 'text-to-image' && store.selectedResult.provenance.sourceSha256 === null && store.selectedResult.provenance.maskSha256 === null, 'text provenance pretends to have a source')
      const marked = await canvasToBlob(await store.resultCanvas(), 'png', 1, {}, { aiModified: 'text-to-image' })
      assert((await readPhotoMetadata(new File([marked], 'result.png', { type: 'image/png' }))).Software === 'Imejii / AI text-to-image', 'wrong text-to-image metadata')
      const saved = await loadDraft('studio:' + store.document.id)
      assert(saved.artifacts.size === 1 && saved.state.results.length === 1, 'text variant was not saved independently')
      await deleteDraft('studio:' + store.document.id)
    } finally { window.desktopApi = nativeApi }
  })
  await check('Studio restart marks active jobs interrupted; disabled plugin cannot route into Images/Logo', async () => {
    const store = fresh(); await store.newSource(source(), 'interrupted.png')
    const state = JSON.parse(JSON.stringify(store.document)); state.jobs = [{ id: crypto.randomUUID(), state: 'running' }]
    assert(interruptedDocument(state).jobs[0].state === 'interrupted', 'restart pretends inference resumed')
    const plugins = usePluginStore(), ui = useUiStore(); if (plugins.studioEnabled) plugins.toggle('sdxl-studio')
    ui.setMode('ai-studio'); assert(ui.mode === 'view', 'disabled plugin activated')
    plugins.toggle('sdxl-studio'); ui.setMode('ai-studio'); assert(ui.mode === 'ai-studio', 'enabled workspace unavailable')
    ui.setMode('logo'); ui.setMode('ai-studio'); assert(store.document.name === 'interrupted.png', 'mode change lost session')
    await deleteDraft('studio:' + store.document.id)
  })
  await check('Subject Studio host hands off corrected background selection and exact working snapshot without LaMa guard', async () => {
    const store = fresh(), library = useLibraryStore(), plugins = usePluginStore()
    if (!plugins.studioEnabled) plugins.toggle('sdxl-studio')
    await library.addFiles([await imageFile(source())]); const host = createPhotoHost(cutout)
    try {
      const captured = await host.capture(), m = createCanvas(captured.canvas.width, captured.canvas.height); m.getContext('2d').fillRect(0, 0, m.width, m.height)
      await host.openStudio(m, 'background')
      assert(store.document.sourceOrigin.area === 'background' && store.document.sourceOrigin.segmentation.model === cutout.model.id, 'segmentation provenance lost')
      const expected = bytes(captured.canvas)
      assert(bytes(store.source).every((n, i) => n === expected[i]), 'source changed during handoff')
      assert(bytes(store.mask()).filter((_, i) => i % 4 === 3).every(n => n === 255), 'background selection rejected or inverted')
    } finally { host.release(); await deleteDraft('studio:' + store.document.id); library.clearAll() }
  })
  await check('Studio fixture result uses immutable prompt/seed, explicit acceptance, durable provenance and inpaint EXIF', async () => {
    const store = fresh(), s = source(), m = createCanvas(256, 128); m.getContext('2d').fillRect(100, 40, 40, 40)
    await store.newSource(s, 'fixture.png', m); store.document.parameters.prompt = 'A vase'; store.document.parameters.seed = 1234; store.document.parameters.randomizeSeed = false
    const generated = createCanvas(1024, 1024); generated.getContext('2d').fillStyle = '#ddccbb'; generated.getContext('2d').fillRect(0, 0, 1024, 1024)
    const resultBytes = new Uint8Array(await (await canvasToBlob(generated, 'png')).arrayBuffer()), nativeApi = window.desktopApi
    let submitted
    window.desktopApi = { onAiStudioProgress: () => () => {}, aiStudioRun: async payload => { submitted = payload; return { bytes: resultBytes, provider: 'TEST FIXTURE', providerVersion: 'test', model: payload.parameters.model, workflow: 'test-only', parameters: payload.parameters, modelSha256: null, elapsedMs: 0 } } }
    try {
      store.connection = { modelAvailable: true, validationRequired: true }
      await store.run(true)
      assert(submitted.parameters.seed === 1234 && store.document.results.length === 1, store.error || 'No fixture variant')
      assert(useLibraryStore().items.length === 0, 'result applied automatically')
      const result = store.selectedResult, canvas = await store.resultCanvas()
      assert(result.provenance.parameters.prompt === 'A vase' && result.provenance.sourceSha256 === store.document.source, 'provenance lost')
      const marked = await canvasToBlob(canvas, 'png', 1, {}, { aiModified: 'inpaint' })
      assert((await readPhotoMetadata(new File([marked], 'result.png', { type: 'image/png' }))).Software === 'Imejii / AI inpainting', 'wrong AI operation metadata')
      await store.acceptResult(); assert(useLibraryStore().activeItem.extensions['sdxl-studio'].parameters.seed === 1234, 'acceptance lost recipe')
      const saved = await loadDraft('studio:' + store.document.id)
      assert(saved.artifacts.has(result.provenance.maskSha256) && saved.artifacts.has(result.artifact) && saved.state.results[0].accepted, 'variant or immutable input mask not persisted')
      assert(await sourceFingerprint(saved.artifacts.get(saved.state.source)) === saved.state.source, 'source altered')
      await deleteDraft('photo:' + result.id); await deleteDraft('studio:' + store.document.id); useLibraryStore().clearAll()
    } finally { window.desktopApi = nativeApi }
  })
  await check('Studio cancellation discards a late fixture result while retaining the session', async () => {
    const store = fresh(), m = createCanvas(256, 128); m.getContext('2d').fillRect(10, 10, 40, 40)
    await store.newSource(source(), 'cancel.png', m); store.document.parameters.prompt = 'A vase'; store.connection = { modelAvailable: true }
    const nativeApi = window.desktopApi; let deliver, canceled
    window.desktopApi = { onAiStudioProgress: () => () => {}, aiStudioRun: () => new Promise(resolve => { deliver = resolve }), aiStudioCancel: async id => { canceled = id } }
    try {
      const run = store.run(true)
      for (let i = 0; i < 200 && !deliver; i++) await new Promise(resolve => setTimeout(resolve, 5))
      assert(Boolean(deliver), 'provider never submitted')
      await store.cancel(); deliver({ bytes: new Uint8Array([1, 2, 3]) }); await run
      assert(canceled === store.currentJob.id && store.currentJob.state === 'canceled' && !store.document.results.length, 'late result accepted')
      await deleteDraft('studio:' + store.document.id)
    } finally { window.desktopApi = nativeApi }
  })
  await check('Cancel during result encoding cannot publish a variant after acceptance was canceled', async () => {
    const store = fresh(), m = createCanvas(256, 128); m.getContext('2d').fillRect(10, 10, 40, 40)
    await store.newSource(source(), 'cancel-encoding.png', m); store.document.parameters.prompt = 'A vase'; store.connection = { modelAvailable: true }
    const generated = createCanvas(1024, 1024), output = new Uint8Array(await (await canvasToBlob(generated, 'png')).arrayBuffer())
    const nativeApi = window.desktopApi, nativeToBlob = HTMLCanvasElement.prototype.toBlob
    let providerReturned = false, canceled = false
    window.desktopApi = { onAiStudioProgress: () => () => {}, aiStudioRun: async () => { providerReturned = true; return { bytes: output } }, aiStudioCancel: async () => {} }
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      if (providerReturned && !canceled) { canceled = true; void store.cancel() }
      return nativeToBlob.apply(this, args)
    }
    try {
      await store.run(true)
      assert(canceled && store.currentJob.state === 'canceled' && !store.document.results.length, 'encoded late result was accepted')
      await deleteDraft('studio:' + store.document.id)
    } finally { HTMLCanvasElement.prototype.toBlob = nativeToBlob; window.desktopApi = nativeApi }
  })
  await check('Grayscale interchange export still uses selected alpha at source resolution', () => {
    const m = createCanvas(4, 2); m.getContext('2d').fillStyle = 'rgba(255,255,255,.5)'; m.getContext('2d').fillRect(0, 0, 2, 2)
    const exported = grayscaleMask(m, 8, 4), pixels = bytes(exported)
    assert(exported.width === 8 && pixels[0] === 128 && pixels[3] === 255 && pixels[7 * 4] === 0, 'export contract changed')
  })
}
