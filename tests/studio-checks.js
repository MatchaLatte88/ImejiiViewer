import { createPinia, setActivePinia } from 'pinia'
import { createCanvas, canvasToImageData, findContentBounds } from '../src/lib/transform.js'
import { studioSettings, studioPreset, studioGeometry, suggestSubjectCrop, spreadAlpha, renderStudio } from '../src/plugins/ai-cutout/studio.js'
import { renderStudioAsync } from '../src/plugins/ai-cutout/studio-runtime.js'
import { selectionMask, grayscaleMask } from '../src/plugins/mask-transfer.js'
import { drawStrokes } from '../src/plugins/ai-remove/mask.js'
import { createPhotoHost, pluginActivity } from '../src/plugins/host.js'
import { manifest } from '../src/plugins/ai-cutout/manifest.js'
import { manifest as removal } from '../src/plugins/ai-remove/manifest.js'
import { useLibraryStore } from '../src/stores/library.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import { loadDraft, deleteDraft, projectBlob, readProject } from '../src/lib/drafts.js'
import { readPhotoMetadata } from '../src/lib/photoMetadata.js'

const assert = (ok, message) => { if (!ok) throw new Error(message) }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const bytes = c => canvasToImageData(c).data
const pixel = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data]
const rejects = async fn => { try { await fn(); return false } catch { return true } }
function filled(w, h, color) { const c = createCanvas(w, h), ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); return c }
function fixture() {
  const source = filled(100, 80, '#1450c8'), mask = createCanvas(100, 80)
  source.getContext('2d').fillStyle = '#e62814'; source.getContext('2d').fillRect(30, 20, 40, 40)
  mask.getContext('2d').fillRect(30, 20, 40, 40)
  return { source, mask }
}
export async function studioChecks(check) {
  await check('Studio settings sanitize malformed, non-finite and out-of-range values', () => {
    const s = studioSettings({ subject: null, surroundings: { exposure: Infinity }, background: { kind: 'remote', color: 'url(x)', blur: 999 }, frame: { size: 999999 }, placement: { scale: -5 } })
    assert(s.subject.exposure === 0 && s.surroundings.exposure === 0 && s.background.kind === 'transparent' && s.background.color === '#ffffff' && s.background.blur === 30 && s.frame.size === 2048 && s.placement.scale === 20, 'invalid settings escaped normalization')
    assert(studioSettings(null).frame.mode === 'original', 'null recipe rejected')
  })
  await check('Neutral original background preserves source RGB and alpha without mutating inputs', () => {
    const { source, mask } = fixture(), ctx = source.getContext('2d')
    ctx.clearRect(0, 0, 10, 10); ctx.fillStyle = 'rgba(40,80,120,.5)'; ctx.fillRect(0, 0, 10, 10)
    const before = bytes(source).slice(), beforeMask = bytes(mask).slice()
    const output = renderStudio(source, mask, studioPreset('photo')).canvas
    assert(bytes(output).every((v, i) => v === before[i]), 'neutral photo changed')
    assert(bytes(source).every((v, i) => v === before[i]) && bytes(mask).every((v, i) => v === beforeMask[i]), 'source or mask mutated')
  })
  await check('Subject and background exposure and looks remain region-selective', () => {
    const { source, mask } = fixture(), s = studioPreset('photo'); s.subject.exposure = -1; s.surroundings.look = 'bw'
    const output = renderStudio(source, mask, s).canvas, fg = pixel(output, 50, 40), bg = pixel(output, 0, 0)
    assert(fg[0] === 115 && fg[1] === 20 && fg[2] === 10, 'subject exposure is not -1 EV')
    assert(bg[0] === bg[1] && bg[1] === bg[2], 'background not grayscale')
  })
  await check('Original-background blur excludes subject colors and retains source alpha', () => {
    const { source, mask } = fixture(), s = studioPreset('portrait'); s.subject.sharpen = 0; s.background.blur = 30
    const output = renderStudio(source, mask, s).canvas, bg = pixel(output, 29, 40), fg = pixel(output, 30, 40)
    assert(bg[0] <= 21 && bg[2] >= 199 && fg[0] === 230, 'foreground red bled into background blur')
    assert(bytes(output).filter((_, i) => i % 4 === 3).every(a => a === 255), 'blur altered alpha')
  })
  await check('Transparent and solid backgrounds honor soft subject alpha', () => {
    const source = filled(10, 10, 'rgba(200,80,40,.5)'), mask = filled(10, 10, 'rgba(255,255,255,.5)')
    const cutout = renderStudio(source, mask, studioSettings()).canvas
    assert(Math.abs(pixel(cutout, 5, 5)[3] - 64) <= 1, 'alpha was replaced instead of multiplied')
    const output = renderStudio(source, mask, studioSettings({ background: { kind: 'color', color: '#ffffff' } })).canvas
    assert(pixel(output, 5, 5)[3] === 255 && pixel(output, 5, 5)[0] > 230, 'solid background not composited')
  })
  await check('Gradient and image cover/contain backgrounds render as configured', async () => {
    const source = filled(100, 80, '#000'), mask = createCanvas(100, 80), image = filled(200, 40, '#00ff00')
    const s = studioSettings({ background: { kind: 'gradient', color: '#000000', color2: '#ffffff', angle: 0 } })
    const gradient = renderStudio(source, mask, s).canvas
    assert(pixel(gradient, 0, 40)[0] < 5 && pixel(gradient, 99, 40)[0] > 250, 'gradient direction/color incorrect')
    s.background.kind = 'image'; s.background.color = '#ff0000'
    assert(await rejects(() => renderStudio(source, mask, s)), 'missing background image accepted')
    const cover = renderStudio(source, mask, s, image).canvas; assert(pixel(cover, 0, 0)[1] === 255, 'cover left empty edges')
    s.background.fit = 'contain'
    const contain = renderStudio(source, mask, s, image).canvas
    assert(pixel(contain, 0, 0)[0] === 255 && pixel(contain, 50, 40)[1] === 255, 'contain did not letterbox with canvas color')
  })
  await check('Subject-aware crop contains the subject, fits image edges and reports impossible ratios', () => {
    const bounds = { x: .3, y: .25, width: .4, height: .5 }
    const crop = suggestSubjectCrop(bounds, 100, 80, '1:1', 10)
    assert(!crop.clipped && crop.x >= 0 && crop.y >= 0 && Math.abs(crop.width * 100 - crop.height * 80) < .01, 'square crop incorrect')
    const edge = suggestSubjectCrop({ x: 0, y: 0, width: .2, height: .2 }, 100, 80)
    assert(edge.x === 0 && edge.y === 0, 'crop escaped source')
    assert(suggestSubjectCrop({ x: 0, y: 0, width: 1, height: 1 }, 100, 80, '16:9').clipped, 'clipping warning absent')
    const g = studioGeometry(100, 80, bounds, { frame: { mode: 'crop', ratio: 'free', padding: 0 } })
    assert(g.width === 40 && g.height === 40, 'subject bounds not used')
  })
  await check('Product framing centers the subject with margins and detects upscaling', () => {
    const { source, mask } = fixture(), s = studioPreset('product'); s.frame.size = 1024; s.sticker.opacity = 0; s.background.kind = 'transparent'
    const result = renderStudio(source, mask, s), bounds = findContentBounds(canvasToImageData(result.canvas), 8)
    assert(result.canvas.width === 1024 && result.canvas.height === 1024 && result.geometry.upscaled, 'product geometry/upscale warning wrong')
    assert(Math.abs(bounds.x - 102) < 2 && Math.abs(bounds.y - 102) < 2 && Math.abs(bounds.width - 820) < 3, 'margin or centering incorrect')
  })
  await check('Invalid mask shape, empty framing and oversized output are rejected', async () => {
    const { source, mask } = fixture()
    assert(await rejects(() => renderStudio(source, createCanvas(5, 100), {})), 'mismatched mask accepted')
    assert(await rejects(() => renderStudio(source, createCanvas(100, 80), studioPreset('product'))), 'empty product framing accepted')
    assert(await rejects(() => studioGeometry(6000, 5000, null, {})), 'oversize source accepted')
    assert(await rejects(() => renderStudio(source, mask, { background: { kind: 'original' }, frame: { mode: 'product' } })), 'original background distorted into product')
  })
  await check('Fast alpha dilation matches a brute-force maximum filter at all borders', () => {
    const w = 13, h = 7, a = Uint8ClampedArray.from({ length: w * h }, (_, i) => (i * 79 + 17) % 256)
    for (const radius of [0, 1, 3, 30]) {
      const out = spreadAlpha(a, w, h, radius)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let expected = 0
        for (let dy = Math.max(0, y - radius); dy <= Math.min(h - 1, y + radius); dy++) for (let dx = Math.max(0, x - radius); dx <= Math.min(w - 1, x + radius); dx++) expected = Math.max(expected, a[dy * w + dx])
        assert(out[y * w + x] === expected, 'dilation mismatch')
      }
    }
  })
  await check('Sticker outline, shadow and placement preserve transparent output', () => {
    const { source, mask } = fixture(), s = studioSettings({ sticker: { width: 20, opacity: 60, softness: 10, x: 30, y: 30 } })
    const output = renderStudio(source, mask, s).canvas
    assert(pixel(output, 29, 40)[0] > 240 && pixel(output, 29, 40)[3] > 240, 'white outline absent')
    assert(pixel(output, 73, 63)[3] > 0 && pixel(output, 0, 0)[3] === 0, 'shadow missing or flattened backdrop')
    s.placement.x = 20; const moved = renderStudio(source, mask, s).canvas
    assert(pixel(moved, 32, 40)[3] === 0 && pixel(moved, 60, 40)[0] === 230, 'subject did not move')
    s.placement.opacity = 50; s.sticker.opacity = 0
    assert(Math.abs(pixel(renderStudio(source, mask, s).canvas, 60, 40)[3] - 128) <= 1, 'subject opacity missing')
  })
  await check('Module-worker composition matches the shared renderer and supports cancellation', async () => {
    const { source, mask } = fixture(), s = studioPreset('splash')
    const sync = renderStudio(source, mask, s), worker = await renderStudioAsync(source, mask, s)
    const workerBytes = bytes(worker.canvas)
    assert(bytes(sync.canvas).every((v, i) => v === workerBytes[i]), 'worker pixels differ')
    const abort = new AbortController(), pending = renderStudioAsync(source, mask, s, null, {}, abort.signal).catch(e => e.name)
    abort.abort(); assert(await pending === 'AbortError', 'composition cancellation failed')
    const preview = await renderStudioAsync(source, mask, studioPreset('product'), null, { previewLimit: 200 })
    assert(preview.canvas.width === 200 && preview.geometry.width === 2048, 'preview lost export dimensions')
  })
  await check('Subject/background selection and opaque grayscale export use explicit matching polarity', () => {
    const { source, mask } = fixture(), fg = selectionMask(source, mask, 'subject'), bg = selectionMask(source, mask, 'background')
    assert(pixel(fg, 50, 40)[3] === 255 && pixel(bg, 50, 40)[3] === 0 && pixel(bg, 0, 0)[3] === 255, 'selection inverse wrong')
    const png = grayscaleMask(fg, 200, 160)
    assert(pixel(png, 100, 80).every(v => v === 255) && pixel(png, 0, 0).join(',') === '0,0,0,255', 'mask not opaque grayscale')
    const dilated = selectionMask(source, mask, 'subject', { forRemoval: true })
    assert(pixel(dilated, 28, 40)[3] === 255 && pixel(dilated, 27, 40)[3] === 0, 'handoff safety edge not dilated')
  })
  await check('24 MP input composes a 4096 px product in the actual module worker', async () => {
    const source = filled(6000, 4000, '#c85028'), mask = createCanvas(1500, 1000)
    mask.getContext('2d').fillRect(375, 250, 750, 500)
    const settings = studioPreset('product'); settings.frame.size = 4096
    let output
    try {
      output = await renderStudioAsync(source, mask, settings)
      assert(output.canvas.width === 4096 && output.canvas.height === 4096, 'maximum product output size wrong')
      assert(pixel(output.canvas, 2048, 2048).join(',') === '200,80,40,255', 'large composition changed subject colors')
      assert(pixel(output.canvas, 0, 0).join(',') === '255,255,255,255', 'large composition missing backdrop')
    } finally { source.width = source.height = mask.width = mask.height = 1; if (output) output.canvas.width = output.canvas.height = 1 }
  })
  await check('Transferred masks remain erasable and survive stroke Undo replay', () => {
    const { mask } = fixture(), output = createCanvas(100, 80), erase = { erase: true, size: .15, points: [[.5, .5]] }
    drawStrokes(output, [erase], mask); assert(pixel(output, 50, 40)[3] === 0 && pixel(mask, 50, 40)[3] === 255, 'seed was destroyed or not erased')
    drawStrokes(output, [], mask); assert(pixel(output, 50, 40)[3] === 255, 'undo did not restore seed')
  })
  await check('Composed variants persist geometry, style provenance, camera metadata and projects', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore(), { source, mask } = fixture()
    const file = new File([await canvasToBlob(source, 'png', 1, { Make: 'Studio Camera' })], 'studio.png', { type: 'image/png' })
    await library.addFiles([file]); await pause(200)
    const host = createPhotoHost(manifest); let id
    try {
      const captured = await host.capture(), settings = studioPreset('product'); settings.frame.size = 1024
      const output = renderStudio(captured.canvas, mask, settings)
      id = await host.apply(output.canvas, { operation: 'subject-composition', studio: settings, geometry: output.geometry }); host.release()
      const saved = await loadDraft(id), meta = await readPhotoMetadata(saved.file)
      assert(saved.file.name.endsWith('-studio.png') && meta.Software === 'Imejii / AI subject composition' && meta.Make === 'Studio Camera', 'studio metadata wrong')
      assert(library.items[0].file === file && library.activeItem.width === 1024, 'original changed or output size lost')
      const reexport = await readPhotoMetadata(await canvasToBlob(output.canvas, 'png', 1, meta)); assert(reexport.Software === meta.Software, 'studio marker lost on re-export')
      const project = await readProject(await projectBlob(saved.file, 'photo', saved.state))
      assert(project.state.extensions['ai-cutout'].studio.frame.mode === 'product', 'project lost style provenance')
    } finally { host.release(); if (id) await deleteDraft(id) }
  })
  await check('Mask handoff atomically transfers host ownership and retains LaMa dimension/coverage guards', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore(), { source, mask } = fixture()
    await library.addFiles([new File([await canvasToBlob(source)], 'handoff.png', { type: 'image/png' })]); await pause(200)
    const host = createPhotoHost(manifest), unrelated = createPhotoHost(removal); let recipient
    try {
      const captured = await host.capture()
      assert(await rejects(() => host.handoff('ai-remove', filled(100, 80, '#fff'), { area: 'subject' })), '65% guard missing')
      assert(await rejects(() => host.handoff('unknown', mask, { area: 'subject' })), 'unknown recipient accepted')
      recipient = host.handoff('ai-remove', mask, { area: 'subject' })
      host.release(); host.setDirty(false)
      assert(pluginActivity.active && pluginActivity.dirty && recipient.source.canvas === captured.canvas, 'handoff released workspace lock or recaptured wrong image')
      assert(await rejects(() => unrelated.capture()), 'second workspace captured during handoff')
      assert(await rejects(() => recipient.host.apply(createCanvas(5, 5), {})), 'LaMa accepted changed geometry')
      assert(await rejects(() => host.handoff('ai-remove', mask, { area: 'subject' })), 'old owner handed off twice')
      mask.width = 1; assert(recipient.source.initialMask.width === 100, 'handoff did not own mask copy')
    } finally { host.release(); unrelated.release(); recipient?.host.release() }
    assert(!pluginActivity.active, 'recipient close leaked lock')
  })
}
