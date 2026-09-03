// Regression checks use real browser decoders, canvas, Vue stores, and module workers.
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useLibraryStore } from '../src/stores/library.js'
import { useEditorStore } from '../src/stores/editor.js'
import { useUiStore } from '../src/stores/ui.js'
import { decodePhoto, readPhotoInfo } from '../src/lib/photoLoader.js'
import { loadImageFile } from '../src/lib/imageLoader.js'
import { createCanvas, canvasToImageData } from '../src/lib/transform.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import { createEdits, processPhoto, previewGeometry } from '../src/lib/photoPipeline.js'
import { createIcoBlob } from '../src/lib/ico.js'
import { cloneSettings, DEFAULT_SETTINGS, processImage } from '../src/lib/pipeline.js'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const assert = (condition, detail) => { if (!condition) throw new Error(detail) }
const dimensions = c => [c.width, c.height].join('x')
const bytes = c => canvasToImageData(c).data
const equalPixels = (a, b) => dimensions(a) === dimensions(b) && bytes(a).every((n, i) => n === bytes(b)[i])
function freshLibrary() { setActivePinia(createPinia()); return useLibraryStore() }
function fixture(width = 80, height = 40) {
  const c = createCanvas(width, height), ctx = c.getContext('2d')
  ctx.fillStyle = '#fa1414'; ctx.fillRect(0, 0, width / 2, height / 2)
  ctx.fillStyle = '#14e614'; ctx.fillRect(width / 2, 0, width / 2, height / 2)
  ctx.fillStyle = '#1414fa'; ctx.fillRect(0, height / 2, width / 2, height / 2)
  ctx.fillStyle = '#eeee14'; ctx.fillRect(width / 2, height / 2, width / 2, height / 2)
  return c
}
async function file(c, name = 'fixture.png', format = 'png') {
  return new File([await canvasToBlob(c, format)], name, { type: format === 'jpeg' ? 'image/jpeg' : 'image/png' })
}
function withExif(jpeg, orientation) {
  const app1 = new Uint8Array(36), v = new DataView(app1.buffer)
  app1.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0])
  v.setUint16(20, 0x112, true); v.setUint16(22, 3, true); v.setUint32(24, 1, true); v.setUint16(28, orientation, true)
  return new File([jpeg.slice(0, 2), app1, jpeg.slice(2)], 'orientation-' + orientation + '.jpg', { type: 'image/jpeg' })
}
async function delayedImages(fn) {
  const NativeImage = window.Image, nativeURL = URL.createObjectURL.bind(URL), names = new Map()
  URL.createObjectURL = blob => { const u = nativeURL(blob); names.set(u, blob.name); return u }
  window.Image = function () {
    const img = new NativeImage()
    Object.defineProperty(img, 'onload', { set(handler) { img.addEventListener('load', e => setTimeout(() => handler(e), names.get(img.src) === 'slow.png' ? 100 : 0), { once: true }) } })
    return img
  }
  try { await fn() } finally { window.Image = NativeImage; URL.createObjectURL = nativeURL }
}

globalThis.runImejiiAudit = async () => {
  const results = []
  async function check(name, fn) {
    try { const detail = await fn(); results.push({ name, status: 'PASS', ...(detail ? { detail } : {}) }) }
    catch (error) { results.push({ name, status: 'FAIL', detail: error.message }) }
  }
  const original = fixture(), png = await file(original), jpeg = new Uint8Array(await (await canvasToBlob(original, 'jpeg')).arrayBuffer())
  await check('PNG identity, photo pipeline', () => assert(equalPixels(original, processPhoto(original, createEdits())), 'neutral pipeline changes pixels'))
  await check('PNG identity, logo pipeline', () => assert(equalPixels(original, processImage(canvasToImageData(original), cloneSettings(DEFAULT_SETTINGS))), 'neutral logo pipeline changes pixels'))
  for (const format of ['png', 'jpeg', 'webp']) {
    await check(format + ' encoder returns requested MIME and decodable pixels', async () => {
      const blob = await canvasToBlob(original, format)
      assert(blob.type === 'image/' + format, blob.type)
      const c = await decodePhoto(new File([blob], 'image.' + format, { type: blob.type }))
      assert(dimensions(c) === '80x40', dimensions(c))
    })
  }
  await check('ICO directory and embedded PNG signatures', async () => {
    const data = new Uint8Array(await (await createIcoBlob(original)).arrayBuffer()), v = new DataView(data.buffer)
    assert(v.getUint16(2, true) === 1 && v.getUint16(4, true) === 7, 'ICO header mismatch')
    for (let i = 0; i < 7; i++) {
      const o = v.getUint32(6 + 16 * i + 12, true)
      assert(data[o] === 137 && data[o + 1] === 80 && data[o + 2] === 78 && data[o + 3] === 71, 'invalid embedded PNG')
    }
  })
  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    await check('EXIF orientation ' + orientation + ' matches native decoded JPEG', async () => {
      const f = withExif(jpeg, orientation), info = await readPhotoInfo(f)
      assert(info.width === (orientation >= 5 ? 40 : 80) && info.height === (orientation >= 5 ? 80 : 40), 'metadata dimensions must be oriented exactly once')
      const native = await decodePhoto(f, { orientation: 1 })
      const actual = await decodePhoto(f, { orientation: info.orientation })
      assert(equalPixels(native, actual), 'native=' + dimensions(native) + ', app=' + dimensions(actual) + '; pixels/dimensions differ (double orientation)')
    })
  }
  await check('Undo availability reacts after an edit', async () => {
    const s = freshLibrary(); await s.addFiles([png]); const before = s.canUndo
    s.rotateBy(90); await nextTick(); await pause(420)
    assert(before === false && s.canUndo === true, 'canUndo remains ' + s.canUndo + ' after history commit')
  })
  await check('Undo survives immediate image switching', async () => {
    const s = freshLibrary(); await s.addFiles([png, await file(original, 'second.png')]); const [a, b] = s.items
    s.rotateBy(90); await nextTick(); await s.select(b.id); await s.select(a.id); s.undo()
    assert(s.activeItem.edits.rotate === 0, 'rotation remains ' + s.activeItem.edits.rotate + ' after undo')
  })
  await check('Apply to all can be undone on the receiving image', async () => {
    const s = freshLibrary(); await s.addFiles([png, await file(original, 'second.png')]); const b = s.items[1]
    s.patchEdits({ blur: 2 }); s.applyEditsToAll(); await s.select(b.id); s.undo()
    assert(s.activeItem.edits.blur === 0, 'receiving image has blur=' + s.activeItem.edits.blur + ' with no undo snapshot')
  })
  await check('The latest selection wins asynchronous decoding', async () => {
    const s = freshLibrary(); await s.addFiles([await file(fixture(80, 40), 'slow.png'), await file(fixture(30, 20), 'fast.png')])
    await s.select(s.items[1].id)
    await delayedImages(async () => { const a = s.select(s.items[0].id); const b = s.select(s.items[1].id); await Promise.all([a, b]) })
    assert(s.activeItem.width === s.sourceCanvas.width, 'active=' + s.activeItem.name + ' (' + s.activeItem.width + 'px), source=' + s.sourceCanvas.width + 'px')
  })
  await check('Horizontal flip after 90-degree rotation uses the displayed axis', () => {
    const rotated = processPhoto(original, createEdits({ rotate: 90 }))
    const expected = processPhoto(rotated, createEdits({ flipH: true }))
    const actual = processPhoto(original, createEdits({ rotate: 90, flipH: true }))
    assert(equalPixels(expected, actual), 'horizontal flip after rotation flips along the source axis')
  })
  await check('Batch preview respects disabled per-image edits', async () => {
    const s = freshLibrary(); await s.addFiles([png]); s.patchEdits({ crop: { x: 0, y: 0, width: 0.5, height: 0.5 } }); s.batch.applyEdits = false
    assert(dimensions(s.batchTargetSize(s.activeItem)) === '80x40', 'shown=' + dimensions(s.batchTargetSize(s.activeItem)) + ', untouched export=80x40')
  })
  await check('Batch-generated filenames stay unique after collision suffixes', async () => {
    globalThis.auditWrites.length = 0
    const s = freshLibrary(); await s.addFiles([await file(original, 'a.png'), await file(original, 'a-3.png'), await file(original, 'a.jpg')]); s.batch.format = 'png'; await s.runBatch()
    const names = globalThis.auditWrites.map(x => x.name)
    assert(names.length === 3 && new Set(names.map(n => n.toLowerCase())).size === names.length, 'output names=' + names.join(', '))
  })
  await check('Batch captures settings before asynchronous rendering', async () => {
    globalThis.auditWrites.length = 0
    const s = freshLibrary(); await s.addFiles([await file(original, 'slow.png')]); s.batch.format = 'png'
    await delayedImages(async () => { const p = s.runBatch(); s.batch.format = 'jpeg'; await p })
    const saved = globalThis.auditWrites[0], data = new Uint8Array(saved.buffer)
    assert(!(saved.name.endsWith('.png') && data[0] === 255 && data[1] === 216), 'output=' + saved.name + ', contents=JPEG')
  })
  await check('Favicon bundle PNG filenames contain PNG data even if JPEG was selected', async () => {
    setActivePinia(createPinia()); const s = useEditorStore(); await s.loadFile(png); globalThis.auditWrites.length = 0
    await s.exportPreset('favicon', { format: 'jpeg' })
    const first = globalThis.auditWrites.find(x => x.name.endsWith('.png')), data = new Uint8Array(first.buffer)
    assert(data[0] === 137 && data[1] === 80, first.name + ' starts with ' + data.slice(0, 3).join(',') + ' (JPEG)')
  })
  await check('Folder navigation preserves edited images when returning from editor to viewer', async () => {
    const s = freshLibrary(), f = await file(original, 'a.png'); f.desktopId = 'fixture-a'; await s.addFiles([f]); const id = s.activeId
    useUiStore().setMode('images'); s.rotateBy(90); await nextTick(); await pause(400)
    globalThis.auditFolderFile = { name: 'b.png', type: 'image/png', id: 'fixture-b', buffer: await png.arrayBuffer() }
    useUiStore().setMode('view'); await s.step(1)
    assert(s.activeItem.name === 'b.png', 'folder did not advance')
    assert(s.items.some(x => x.id === id && x.edits.rotate === 90), 'edited item and its history were removed when browsing the folder')
  })
  await check('Photo geometry calculations match canvas dimensions', () => {
    for (const rotate of [0, 90, 180, 270]) for (const straighten of [-45, -10, 0, 10, 45]) {
      const edits = createEdits({ rotate, straighten, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })
      assert(dimensions(previewGeometry(80, 40, edits)) === dimensions(processPhoto(original, edits)), 'geometry mismatch')
    }
  })
  await check('Logo loader applies its documented 4096px working limit', async () => {
    const loaded = await loadImageFile(await file(fixture(4200, 40)))
    assert(loaded.width === 4096 && loaded.scaled, 'working limit not enforced')
  })

  await check('JPEG transparency uses a white matte', async () => {
    const c = createCanvas(8, 8)
    const decoded = await decodePhoto(await file(c, 'transparent.jpg', 'jpeg'))
    assert([...bytes(decoded).slice(0, 4)].every(v => v > 250), 'transparent JPEG is not white')
  })
  await check('Undo is immediately available before the debounce fires', async () => {
    const s = freshLibrary(); await s.addFiles([png]); s.rotateBy(90)
    assert(s.canUndo, 'pending edit not reflected in Undo')
    s.undo(); assert(s.activeItem.edits.rotate === 0, 'immediate undo lost')
    assert(s.canRedo, 'redo unavailable'); s.redo()
    assert(s.activeItem.edits.rotate === 90, 'redo lost')
  })
  await check('Rotation preserves a previously applied display-axis flip', async () => {
    const s = freshLibrary(); await s.addFiles([png]); s.flip('h'); s.rotateBy(90)
    const expected = processPhoto(processPhoto(original, createEdits({ flipH: true })), createEdits({ rotate: 90 }))
    assert(equalPixels(expected, processPhoto(original, s.activeItem.edits)), 'rotate after flip changes meaning')
  })
  await check('Batch snapshot survives collection mutation and watermark changes', async () => {
    const s = freshLibrary(); await s.addFiles([await file(original, 'slow.png'), await file(original, 'second.png')])
    s.batch.format = 'png'; auditWrites.length = 0
    await delayedImages(async () => {
      const pending = s.runBatch()
      s.items[1].edits.rotate = 90
      s.watermark.enabled = true; s.watermark.text = 'CHANGED'
      s.items.splice(1)
      await pending
    })
    assert(auditWrites.length === 2, 'live collection changed export count')
    const exported = await decodePhoto(new File([auditWrites[1].buffer], 'export.png', { type: 'image/png' }))
    assert(equalPixels(original, exported), 'live edits or watermark changed export pixels')
  })
  await check('Cancel batch stops writes and closes its export session', async () => {
    const s = freshLibrary(); await s.addFiles([await file(original, 'slow.png'), png])
    auditWrites.length = 0
    await delayedImages(async () => { const p = s.runBatch(); s.cancelBatch(); await p })
    assert(auditWrites.length === 0 && !s.batchProgress, 'canceled export kept writing')
    assert(auditFinished > 0, 'export session was not closed')
  })
  await check('Clear collection invalidates a pending decode', async () => {
    const s = freshLibrary(); await s.addFiles([await file(original, 'slow.png'), png]); await s.select(s.items[1].id)
    await delayedImages(async () => { const p = s.select(s.items[0].id); await s.clearAll(); await p })
    assert(s.activeId === null && !s.sourceCanvas && !s.isDecoding, 'late decode resurrected cleared image')
  })
  await check('Logo replacement cancellation keeps its source and edits', async () => {
    setActivePinia(createPinia()); const s = useEditorStore(); await s.loadFile(png)
    s.settings.adjustments.brightness = 10; auditConfirm = false
    try {
      const loaded = await s.loadFile(await file(original, 'new.png'))
      assert(loaded === false && s.sourceFile === png && s.settings.adjustments.brightness === 10, 'discard cancellation lost state')
    } finally { auditConfirm = true }
  })
  await check('Failed export resets the shared busy state', async () => {
    const s = freshLibrary(); await s.addFiles([png]); auditFailSave = true
    try { await s.saveActiveAs(); assert(!s.exportBusy && useUiStore().notice.type === 'error', 'error not handled centrally') }
    finally { auditFailSave = false }
  })
  await check('Multiple simultaneous saves produce one dialog', async () => {
    const s = freshLibrary(); await s.addFiles([png]); auditSaveCalls = 0
    await Promise.all([s.saveActiveAs(), s.saveActiveAs()])
    assert(auditSaveCalls === 1, 'duplicate dialogs: ' + auditSaveCalls)
  })
  await check('Oversized PNG header is rejected before decoding', async () => {
    const data = new Uint8Array(24), view = new DataView(data.buffer)
    view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(16, 20000); view.setUint32(20, 20000)
    let rejected = false
    try { await readPhotoInfo(new File([data], 'huge.png', { type: 'image/png' })) }
    catch (e) { rejected = /safety limit/.test(e.message) }
    assert(rejected, 'oversized file reached the decoder')
  })
  await check('Canvas allocation is bounded', () => {
    let rejected = false
    try { createCanvas(100000, 100000) } catch { rejected = true }
    assert(rejected, 'unbounded canvas accepted')
  })
  await check('Native file metadata and partial selection successes survive', async () => {
    const { pickImages, toFiles } = await import('../src/lib/desktop.js')
    const result = await pickImages()
    assert(result.files.length === 1 && result.error === 'one failed', 'partial success lost')
    const [f] = toFiles([{ name: 'dated.png', type: 'image/png', buffer: await png.arrayBuffer(), lastModified: 100000 }])
    assert(f.lastModified === 100000, 'mtime lost')
  })
  await check('Case-insensitive, reserved and nested suffix names stay safe', async () => {
    const { exportName, uniqueExportName } = await import('../src/lib/exportNames.js')
    const used = new Set()
    const names = ['a.png', 'A.png', 'a-2.png', 'a.png'].map(name => uniqueExportName(name, used))
    assert(new Set(names.map(n => n.toLowerCase())).size === 4, names.join(', '))
    assert(exportName('{name}', { name: 'CON.png' }, 0, original, 'png') === '_CON.png', 'reserved DOS name')
    assert(!exportName('../{name}', { name: 'bad?.png' }, 0, original, 'png').includes('/'), 'path escaped')
  })
  await check('Cancel single-photo export does not save and releases busy state', async () => {
    const s = freshLibrary(); await s.addFiles([await file(original, 'slow.png')]); auditSaveCalls = 0
    await delayedImages(async () => { const pending = s.saveActiveAs(); s.cancelExport(); await pending })
    assert(!s.exportBusy && auditSaveCalls === 0, 'canceled single export saved a file')
  })
  await check('Cancel logo worker export does not save', async () => {
    setActivePinia(createPinia()); const s = useEditorStore(); await s.loadFile(png); auditSaveCalls = 0
    const pending = s.exportSingle({ format: 'png' }); s.cancelExport(); await pending
    assert(!s.exportBusy && auditSaveCalls === 0, 'canceled logo export saved a file')
  })
  await check('12MP and 24MP pixel processing runs off the UI thread', async () => {
    const { processPhotoAsync } = await import('../src/lib/photoProcessing.js')
    const timings = []
    for (const [width, height] of [[4000, 3000], [6000, 4000]]) {
      const source = createCanvas(width, height)
      source.getContext('2d').fillRect(0, 0, width, height)
      let ticks = 0
      const heartbeat = setInterval(() => ticks++, 10)
      const start = performance.now()
      try {
        const output = await processPhotoAsync(source, createEdits({ blur: 3, adjustments: { brightness: 10 } }))
        assert(output.width === width && output.height === height && ticks > 0, 'UI heartbeat stopped')
        timings.push({ megapixels: width * height / 1e6, ms: Math.round(performance.now() - start), uiTicks: ticks })
        source.width = output.width = 1
      } finally { clearInterval(heartbeat) }
    }
    return timings
  })
  await check('1,000-thumbnail collection is bounded and the next import is rejected', async () => {
    const s = freshLibrary()
    const small = await file(fixture(16, 8), 'tiny.png')
    const start = performance.now()
    const ids = await s.addFiles(Array.from({ length: 1000 }, () => small))
    assert(ids.length === 1000 && s.items.length === 1000, 'large collection import lost entries')
    assert((await s.addFiles([small])).length === 0 && s.items.length === 1000, 'collection limit missing')
    await s.clearAll()
    return { ms: Math.round(performance.now() - start) }
  })
  return { userAgent: navigator.userAgent, results }
}
