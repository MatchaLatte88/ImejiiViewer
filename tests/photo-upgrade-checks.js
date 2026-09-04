import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { parse } from 'exifr'
import { createCanvas, canvasToImageData } from '../src/lib/transform.js'
import { canvasToBlob } from '../src/lib/exportImage.js'
import { readPhotoMetadata, encodePhotoTiff, pngWithProfile } from '../src/lib/photoMetadata.js'
import { decodePhoto, readPhotoInfo } from '../src/lib/photoLoader.js'
import { prepareImageFile, inspectHeif } from '../src/lib/extendedFormats.js'
import { P3_PROFILE } from '../src/lib/colorProfiles.js'
import { createEdits, processPhoto } from '../src/lib/photoPipeline.js'
import { whiteBalanceFromSample } from '../src/lib/photoCurves.js'
import { normalizeLocalMasks, applyLocalLight } from '../src/lib/localLight.js'
import { saveDraft, loadDraft, listDrafts, deleteDraft, projectBlob, readProject, sourceFingerprint } from '../src/lib/drafts.js'
import { useLibraryStore } from '../src/stores/library.js'
import { useDraftStore } from '../src/stores/drafts.js'
import { useEditorStore } from '../src/stores/editor.js'
import { rainbowHeic } from './fixtures/heic.js'

const assert = (ok, detail) => { if (!ok) throw new Error(detail) }
const pixels = canvas => canvasToImageData(canvas).data
const equal = (a, b, tolerance = 0) => a.width === b.width && a.height === b.height && pixels(a).every((value, i) => Math.abs(value - pixels(b)[i]) <= tolerance)
const camera = { Make: 'Test camera', Model: 'Model A', DateTimeOriginal: '2026:09:04 12:34:56', ExposureTime: 1 / 125, FNumber: 2.8, ISO: 400, Artist: 'Frederik Morbe', Copyright: 'All rights reserved', GPSLatitude: [25, 2, 3], GPSLatitudeRef: 'N', GPSLongitude: [121, 3, 4], GPSLongitudeRef: 'E', Orientation: 6 }
// libheif regression fixture, LGPL-3.0, upstream commit 5a3d4f84431f1e2594c7ae3112d00a2b96a6edf0:
// https://github.com/strukturag/libheif/blob/5a3d4f84431f1e2594c7ae3112d00a2b96a6edf0/tests/data/conformance_window_padding.heic
// SHA-256 cf670bad6021268e85db1d9e2593a5be1aa7f2ee1e706af5e76ee7abf2a73ec6
const heicBase64 = 'AAAAGGZ0eXBoZWljAAAAAGhlaWNtaWYxAAAB4G1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAABA2lwcnAAAADiaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAUaXNwZQAAAAAAAAACAAAAAgAAAChjbGFwAAAAAQAAAAEAAAABAAAAAf/AAAAAgAAA/8AAAACAAAAAAAAJaXJvdAAAAAAQcGl4aQAAAAADCAgIAAAAcmh2Y0MBA3AAAACwAAAAAAAe8AD8/fj4AAALA6AAAQAXQAEMAf//A3AAAAMAsAAAAwAAAwAecCShAAEAJEIBAQNwAAADALAAAAMAAAMAHqAUIEHAoQQYh7kWVTcCAgYAgKIAAQAJRAHAYXLIRFNkAAAAGWlwbWEAAAAAAAAAAQABBoECBYaDhAAAACxpbG9jAAAAAEQAAAIAAQAAAAEAAAJUAAAAPAACAAAAAQAAAggAAABMAAAAAW1kYXQAAAAAAAAAmAAAAAZFeGlmAABNTQAqAAAACAADARoABQAAAAEAAAAyARsABQAAAAEAAAA6ASgAAwAAAAEAAgAAAAAAAAAAAGAAAAABAAAAYAAAAAEAAAA4KAGvo0kQ1LimwT9X7O+2d2mm9S1fbO4+QPr688zSSEYAO9f/aZ4z8qGOGueS4/enGGL2Y7p3BfQ='

async function webpExif(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer)
  for (let at = 12; at + 8 < bytes.length;) {
    const size = view.getUint32(at + 4, true)
    if (String.fromCharCode(...bytes.slice(at, at + 4)) === 'EXIF') return parse(bytes.slice(at + 8, at + 8 + size), { translateValues: false, reviveValues: false })
    at += 8 + size + size % 2
  }
  throw new Error('Missing WebP EXIF')
}
export async function photoUpgradeChecks(check) {
  const source = createCanvas(32, 16), ctx = source.getContext('2d')
  ctx.fillStyle = '#b46464'; ctx.fillRect(0, 0, 16, 16)
  ctx.fillStyle = '#6496c8'; ctx.fillRect(16, 0, 16, 16)
  const file = new File([await canvasToBlob(source)], 'photo.png', { type: 'image/png' })
  for (const format of ['png', 'jpeg', 'webp', 'tiff']) {
    await check(format + ' preserves allow-listed metadata, removes GPS and normalizes orientation', async () => {
      const blob = await canvasToBlob(source, format, 1, camera)
      const raw = format === 'webp' ? await webpExif(blob) : await readPhotoMetadata(new File([blob], 'metadata.' + format, { type: blob.type }))
      const reimported = await readPhotoMetadata(new File([blob], 'roundtrip.' + format, { type: blob.type }))
      assert(reimported.Make === camera.Make, 'metadata lost when reopening')
      assert(raw.Make === camera.Make && raw.Artist === camera.Artist && raw.ISO === 400 && raw.DateTimeOriginal === camera.DateTimeOriginal, JSON.stringify(raw))
      assert(raw.Orientation === 1 && raw.ExifImageWidth === 32 && raw.ExifImageHeight === 16 && !raw.GPSLatitude, 'stale dimensions/orientation or GPS retained: ' + JSON.stringify(raw))
      const decoded = await decodePhoto(new File([blob], 'output.' + (format === 'tiff' ? 'tif' : format), { type: blob.type }))
      assert(decoded.width === 32 && decoded.height === 16, 'invalid output pixels')
      if (['png', 'tiff'].includes(format)) assert(equal(source, decoded, 1), 'lossless export changes color')
    })
  }
  await check('GPS is explicitly opt-in; stripping camera does not discard an explicit creator', async () => {
    const withGps = await readPhotoMetadata(new File([await canvasToBlob(source, 'jpeg', 1, camera, { keepGps: true })], 'gps.jpg', { type: 'image/jpeg' }))
    assert(withGps.GPSLatitude?.[0] === 25 && withGps.GPSLongitude?.[0] === 121, 'GPS was not copied')
    const stripped = await readPhotoMetadata(new File([await canvasToBlob(source, 'png', 1, camera, { keepCamera: false, artist: 'New creator' })], 'stripped.png', { type: 'image/png' }))
    assert(!stripped.Make && !stripped.DateTimeOriginal && !stripped.GPSLatitude && stripped.Artist === 'New creator', 'privacy fields incorrect')
  })
  await check('Tagged Display P3 is converted to sRGB once and export keeps the converted colors', async () => {
    const blob = await pngWithProfile(await canvasToBlob(source), P3_PROFILE)
    const converted = await decodePhoto(new File([blob], 'p3.png', { type: 'image/png' }))
    assert(!equal(source, converted, 2), 'P3 tag was ignored')
    const decoded = await decodePhoto(new File([await canvasToBlob(converted)], 'srgb.png', { type: 'image/png' }))
    assert(equal(converted, decoded, 1), 'ICC applied twice on export')
    return { input: [...pixels(source).slice(0, 3)], srgb: [...pixels(converted).slice(0, 3)] }
  })
  for (const orientation of [2, 5, 6, 8]) await check('TIFF orientation ' + orientation + ' is applied exactly once', async () => {
    const tiff = encodePhotoTiff({}, {}, 32, 16, pixels(source)), view = new DataView(tiff.buffer)
    for (let i = 0; i < view.getUint16(8, true); i++) { const at = 10 + i * 12; if (view.getUint16(at, true) === 274) view.setUint16(at + 8, orientation, true) }
    const input = new File([tiff], 'oriented.tif', { type: 'image/tiff' }), info = await readPhotoInfo(input), output = await decodePhoto(input)
    assert(info.width === (orientation >= 5 ? 16 : 32) && info.height === (orientation >= 5 ? 32 : 16), 'wrong TIFF dimensions')
    assert(output.width === info.width && output.height === info.height, 'inconsistent decode')
  })
  await check('Real HEIC decodes in a dedicated CSP-safe worker without uploading', async () => {
    const file = new File([Uint8Array.from(atob(rainbowHeic), c => c.charCodeAt(0))], 'sample.heic', { type: 'image/heic' })
    const result = await prepareImageFile(file), decoded = await decodePhoto(file)
    assert(result.file.type === 'image/png' && result.warnings.length && decoded.width > 0 && decoded.height > 0, 'HEIC conversion failed')
    return { width: decoded.width, height: decoded.height }
  })
  await check('Malformed HEIC and oversized TIFF are rejected', async () => {
    let rejected = 0
    try { inspectHeif(new ArrayBuffer(32)) } catch { rejected++ }
    // The padding conformance fixture has valid headers even when this decoder
    // version cannot decode its unusual clean-aperture layout.
    inspectHeif(Uint8Array.from(atob(heicBase64), c => c.charCodeAt(0)).buffer)
    const tiff = encodePhotoTiff({}, {}, 50000, 50000, new Uint8Array(4))
    try { await prepareImageFile(new File([tiff], 'oversized.tif', { type: 'image/tiff' })) } catch { rejected++ }
    assert(rejected === 2, 'unsafe input reached decode')
  })
  await check('TIFF 16-bit input reduces predictably and associated alpha is unpremultiplied', async () => {
    function changeTag(tiff, id, value) {
      const view = new DataView(tiff.buffer)
      for (let i = 0; i < view.getUint16(8, true); i++) {
        const at = 10 + i * 12
        if (view.getUint16(at, true) === id) {
          const count = view.getUint32(at + 4, true), type = view.getUint16(at + 2, true)
          const start = count * (type === 3 ? 2 : 4) > 4 ? view.getUint32(at + 8, true) : at + 8
          for (let n = 0; n < count; n++) type === 3 ? view.setUint16(start + n * 2, value, true) : view.setUint32(start + n * 4, value, true)
        }
      }
    }
    const high = encodePhotoTiff({}, {}, 1, 1, new Uint8Array([0, 128, 0, 64, 0, 32, 255, 255]))
    changeTag(high, 258, 16)
    const file = new File([high], '16bit.tif', { type: 'image/tiff' }), info = await readPhotoInfo(file), decoded = await decodePhoto(file)
    assert(info.warnings.some(warning => warning.includes('16-bit')) && Math.abs(pixels(decoded)[0] - 128) <= 1, '16-bit conversion/warning missing')
    const alpha = encodePhotoTiff({}, {}, 1, 1, new Uint8Array([50, 25, 10, 128])); changeTag(alpha, 338, 1)
    const output = await decodePhoto(new File([alpha], 'alpha.tif', { type: 'image/tiff' }))
    assert(Math.abs(pixels(output)[0] - 100) <= 2 && pixels(output)[3] === 128, 'associated alpha treated as straight')
  })
  await check('Deflate TIFF is decoded, but expansion beyond declared dimensions is rejected', async () => {
    async function compressedFile(data) {
      const tiff = encodePhotoTiff({}, {}, 1, 1, new Uint8Array([20, 40, 60, 255])), view = new DataView(tiff.buffer)
      const compressed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer())
      let offset
      for (let i = 0; i < view.getUint16(8, true); i++) {
        const at = 10 + i * 12, tag = view.getUint16(at, true)
        if (tag === 273) offset = view.getUint32(at + 8, true)
        if (tag === 259) view.setUint16(at + 8, 8, true)
        if (tag === 279) view.setUint32(at + 8, compressed.length, true)
      }
      return new File([tiff.slice(0, offset), compressed], 'deflate.tif', { type: 'image/tiff' })
    }
    const output = await decodePhoto(await compressedFile(new Uint8Array([20, 40, 60, 255])))
    assert(Math.abs(pixels(output)[0] - 20) <= 1, 'valid Deflate TIFF failed')
    let rejected = false
    try { await decodePhoto(await compressedFile(new Uint8Array(100000))) } catch (error) { rejected = error.message.includes('exceeds its dimensions') }
    assert(rejected, 'Deflate expansion limit missing')
  })
  await check('Neutral tone controls preserve pixels; shadows, highlights and curve change their regions', () => {
    const ramp = createCanvas(256, 1), image = ramp.getContext('2d').createImageData(256, 1)
    for (let n = 0; n < 256; n++) image.data.set([n, n, n, 255], n * 4)
    ramp.getContext('2d').putImageData(image, 0, 0)
    assert(equal(ramp, processPhoto(ramp, createEdits())), 'neutral change')
    const adjusted = pixels(processPhoto(ramp, createEdits({ adjustments: { shadows: 35, highlights: -35 } })))
    assert(adjusted[32 * 4] > 32 && adjusted[224 * 4] < 224, 'tone weights incorrect')
    assert(pixels(processPhoto(ramp, createEdits({ curve: [0, 80, 170, 210, 255] })))[128 * 4] === 170, 'curve midpoint wrong')
    const gains = whiteBalanceFromSample({ r: 120, g: 100, b: 80 })
    assert(Math.abs(120 * gains.whiteBalanceR - 80 * gains.whiteBalanceB) < 1, 'white balance not neutral')
  })
  await check('Local masks preserve alpha/source and stay attached through geometry', () => {
    const image = new ImageData(new Uint8ClampedArray(pixels(source)), 32, 16)
    const masks = normalizeLocalMasks([{ type: 'radial', x: 25, y: 50, radius: 25, exposure: -1 }])
    applyLocalLight(image, masks)
    assert(image.data[(8 * 32 + 8) * 4] < pixels(source)[(8 * 32 + 8) * 4], 'mask center unchanged')
    assert(image.data[0] === pixels(source)[0] && image.data[3] === 255, 'mask escaped bounds or changed alpha')
    const masked = processPhoto(source, createEdits({ localMasks: masks }))
    const expected = processPhoto(masked, createEdits({ rotate: 90, crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } }))
    const actual = processPhoto(source, createEdits({ localMasks: masks, rotate: 90, crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 } }))
    assert(equal(expected, actual), 'mask moved after transform')
  })
  await check('Drafts retain original bytes, independent variants and pending undo across fresh stores', async () => {
    setActivePinia(createPinia()); let library = useLibraryStore()
    await library.addFiles([file]); library.rotateBy(90); await nextTick()
    const id = await saveDraft(file, 'photo', library.draftState(library.activeId), 'photo:test-a')
    const second = await saveDraft(file, 'photo', { edits: createEdits({ blur: 2 }) }, 'photo:test-b')
    const loaded = await loadDraft(id)
    assert(await sourceFingerprint(loaded.file) === await sourceFingerprint(file), 'original changed')
    setActivePinia(createPinia()); library = useLibraryStore(); await library.restoreDraft(loaded)
    assert(library.activeItem.edits.rotate === 90 && library.canUndo, 'restored edits/history missing')
    library.undo(); assert(library.activeItem.edits.rotate === 0, 'restored pending undo wrong')
    await deleteDraft(id)
    assert((await loadDraft(second)).state.edits.blur === 2, 'deleting sibling removed shared original')
    await deleteDraft(second)
  })
  await check('Portable photo and logo projects round-trip and detect damaged originals', async () => {
    const settings = createEdits({ adjustments: { highlights: -25 }, localMasks: [{ exposure: 1 }] })
    const blob = await projectBlob(file, 'photo', { edits: settings })
    const restored = await readProject(blob)
    assert(JSON.stringify(restored.state.edits) === JSON.stringify(settings), 'project recipe changed')
    setActivePinia(createPinia()); const editor = useEditorStore(); await editor.loadFile(file); editor.settings.adjustments.contrast = 25; await nextTick()
    const logo = await readProject(await projectBlob(file, 'logo', editor.draftState()))
    setActivePinia(createPinia()); const reopened = useEditorStore(); await reopened.restoreDraft(logo)
    assert(reopened.settings.adjustments.contrast === 25 && reopened.canUndo, 'logo restore failed')
    const damaged = new Uint8Array(await blob.arrayBuffer()); damaged[damaged.length - 1] ^= 1
    let rejected = false; try { await readProject(new Blob([damaged])) } catch { rejected = true }
    assert(rejected, 'checksum damage accepted')
  })
  await check('Autosave flush drains concurrent changes and guards quota failures', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore(), drafts = useDraftStore()
    await drafts.start(); await library.addFiles([file]); library.rotateBy(90); await nextTick()
    const first = drafts.flush(); library.patchEdits({ sharpen: 12 }); await nextTick(); await drafts.flush(); await first
    assert(drafts.status === 'saved' && !drafts.hasUnsavedWork, 'flush did not drain current edits')
    assert((await loadDraft(library.activeItem.draftId)).state.edits.sharpen === 12, 'saved obsolete snapshot')
    const nativePut = IDBObjectStore.prototype.put
    try {
      IDBObjectStore.prototype.put = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError') }
      library.patchEdits({ sharpen: 15 }); await nextTick(); await drafts.flush()
      assert(drafts.status === 'error' && drafts.hasUnsavedWork, 'save failure not visible/protected')
    } finally { IDBObjectStore.prototype.put = nativePut }
    await drafts.flush(); assert(drafts.status === 'saved', 'save retry failed'); drafts.dispose()
    for (const entry of await listDrafts()) await deleteDraft(entry.id)
  })
  await check('Imported recipes are bounded, normalized and cannot request huge effects', () => {
    const edit = createEdits({ rotate: 17, blur: 1e9, colorShifts: 'bad', resize: { mode: 'percent', value: Infinity }, adjustments: { gamma: -999, whiteBalanceR: null }, localMasks: Array.from({ length: 100 }, () => ({ exposure: Infinity })) })
    assert(edit.blur === 20 && edit.rotate === 0 && edit.colorShifts.length === 0 && edit.localMasks.length === 8 && edit.adjustments.gamma === 10 && edit.resize.value === 100, 'unsafe recipe accepted')
  })
  await check('White-balance pipette samples the original and is repeatable after existing edits', async () => {
    setActivePinia(createPinia()); const library = useLibraryStore(); await library.addFiles([file])
    library.patchEdits({ adjustments: { ...library.activeItem.edits.adjustments, temperature: 50, tint: 20 } })
    library.eyedropperMode = 'white-balance'; await nextTick(); library.pickColorShift(4, 8); await nextTick()
    const first = JSON.stringify(library.activeItem.edits.adjustments)
    library.eyedropperMode = 'white-balance'; await nextTick(); library.pickColorShift(4, 8)
    assert(first === JSON.stringify(library.activeItem.edits.adjustments), 'repeated sample drifts')
    const c = pixels(processPhoto(source, library.activeItem.edits))
    assert(Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3)) <= 1, 'white balance does not neutralize sample')
  })
}
