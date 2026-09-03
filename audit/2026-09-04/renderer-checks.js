// Audit-only checks, bundled against the unchanged application modules.
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useLibraryStore } from '../../src/stores/library.js'
import { useEditorStore } from '../../src/stores/editor.js'
import { useUiStore } from '../../src/stores/ui.js'
import { decodePhoto, readPhotoInfo } from '../../src/lib/photoLoader.js'
import { loadImageFile } from '../../src/lib/imageLoader.js'
import { createCanvas, canvasToImageData } from '../../src/lib/transform.js'
import { canvasToBlob } from '../../src/lib/exportImage.js'
import { createEdits, processPhoto, previewGeometry } from '../../src/lib/photoPipeline.js'
import { createIcoBlob } from '../../src/lib/ico.js'
import { cloneSettings, DEFAULT_SETTINGS, processImage } from '../../src/lib/pipeline.js'

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
    assert(new Set(names).size === names.length, 'output names=' + names.join(', '))
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
    const s = freshLibrary(), f = await file(original, 'a.png'); f.desktopPath = 'D:\\audit-fixtures\\a.png'; await s.addFiles([f]); const id = s.activeId
    useUiStore().setMode('images'); s.rotateBy(90); await nextTick(); await pause(400)
    globalThis.auditFolderFile = { name: 'b.png', type: 'image/png', path: 'D:\\audit-fixtures\\b.png', buffer: await png.arrayBuffer() }
    useUiStore().setMode('view'); s.step(1); await pause(150)
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
  return { userAgent: navigator.userAgent, results }
}
