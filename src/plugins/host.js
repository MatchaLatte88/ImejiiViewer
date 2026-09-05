import { reactive } from 'vue'
import { useLibraryStore } from '../stores/library.js'
import { canvasToBlob, slugify } from '../lib/exportImage.js'
import { saveDraft } from '../lib/drafts.js'
import { createCanvas } from '../lib/transform.js'
import { saveBlob } from '../lib/desktop.js'
import { createZip } from '../lib/download.js'
import { grayscaleMask } from './mask-transfer.js'
import { manifest as removalManifest } from './ai-remove/manifest.js'
import { usePluginStore } from '../stores/plugins.js'
import { useStudioStore } from '../stores/studio.js'
const receiveSnapshot = new WeakMap()

// Core-owned lock also covers keyboard/menu/import commands and close protection.
export const pluginActivity = reactive({ active: false, dirty: false })
export function createPhotoHost(manifest) {
  const library = useLibraryStore()
  let snapshot = null, controller = null
  let owned = false
  let applying = false, pendingVariant = null
  function allowed(capability) {
    if (!manifest.capabilities.includes(capability)) throw new Error('Plugin capability not granted.')
  }
  async function capture() {
    allowed('photo.snapshot')
    if (pluginActivity.active) throw new Error('Another plugin workspace is open.')
    if (!library.activeItem || library.isDecoding || library.isRendering || library.exportBusy || library.isImporting || library.batchProgress) throw new Error('Wait for the current image operation to finish.')
    library.slideshow.active = false
    library.cancelCrop()
    library.eyedropperMode = false
    library.showOriginal = false
    pluginActivity.active = true
    owned = true
    controller = new AbortController()
    try {
      const signal = controller.signal
      const captured = await library.capturePluginPhoto(signal)
      signal.throwIfAborted()
      snapshot = captured
      return Object.freeze({ canvas: snapshot.canvas, name: snapshot.name })
    } catch (error) { release(); throw error }
  }
  async function apply(canvas, details) {
    allowed('photo.variant')
    if (applying) throw new Error('A variant is already being saved.')
    if (!snapshot || !pluginActivity.active || !library.isPluginSnapshotCurrent(snapshot)) throw new Error('The source image changed. Start a new plugin session.')
    if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width < 1 || canvas.height < 1 || canvas.width * canvas.height > 24000000 || Math.max(canvas.width, canvas.height) > 16384) throw new Error('Invalid result dimensions.')
    if ((canvas.width !== snapshot.canvas.width || canvas.height !== snapshot.canvas.height) && !manifest.capabilities.includes('photo.compose')) throw new Error('Invalid result dimensions.')
    applying = true
    try {
      const extensions = {
        [manifest.id]: { ...details, version: manifest.version, model: manifest.model.id, modelSha256: manifest.model.sha256,
          sourceDraftId: snapshot.draftId, sourceName: snapshot.name, sourceEdits: snapshot.edits,
          createdAt: new Date().toISOString() },
      }
      if (JSON.stringify(extensions).length > 512000) throw new Error('The mask is too detailed to save. Simplify it and try again.')
      const composition = manifest.capabilities.includes('photo.compose') && details.operation === 'subject-composition'
      const blob = await canvasToBlob(canvas, 'png', 1, snapshot.metadata, { ...snapshot.metadataOptions, aiModified: composition ? 'subject-composition' : manifest.operation || true })
      if (!library.isPluginSnapshotCurrent(snapshot)) throw new Error('The source image changed. No result was applied.')
      const suffix = composition ? 'studio' : /^[a-z-]{1,24}$/.test(manifest.resultSuffix || '') ? manifest.resultSuffix : 'edited'
      const file = new File([blob], slugify(snapshot.name) + '-' + suffix + '.png', { type: 'image/png' })
      library.assertCanAddPluginFile(file)
      // Persist BEFORE adding a new library item; storage failure leaves preview retryable.
      const state = { edits: library.freshPhotoEdits(), extensions }
      // If the collection restore fails after persistence, retry this exact draft
      // rather than accumulating duplicate saved variants on every Apply click.
      const draftId = pendingVariant?.canvas === canvas ? pendingVariant.id : 'photo:' + crypto.randomUUID()
      pendingVariant = { id: draftId, canvas }
      await saveDraft(file, 'photo', state, draftId)
      if (!await library.restoreDraft({ id: draftId, file, state })) throw new Error('Variant is saved but was not opened.')
      pluginActivity.dirty = false
      return draftId
    } finally { applying = false }
  }
  function currentMask(mask) {
    if (applying || !owned || !snapshot || !library.isPluginSnapshotCurrent(snapshot)) throw new Error('The source changed or another operation is active.')
    if (!Number.isInteger(mask?.width) || !Number.isInteger(mask?.height) || mask.width < 1 || mask.height < 1 || Math.max(mask.width, mask.height) > 2048 || Math.abs(mask.width / mask.height - snapshot.canvas.width / snapshot.canvas.height) > 2 / mask.height) throw new Error('Selection does not match the source photo.')
  }
  function handoff(target, mask, provenance) {
    allowed('photo.mask-handoff'); currentMask(mask)
    if (target !== 'ai-remove') throw new Error('Unsupported mask recipient.')
    if (!['subject', 'background'].includes(provenance?.area)) throw new Error('Unknown mask selection.')
    const pixels = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data
    let selected = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) selected++
    if (!selected) throw new Error('The selection is empty. Refine the mask first.')
    if (selected / (mask.width * mask.height) > .65) throw new Error('LaMa needs background context. Select less than 65% of the image, or export the mask for SDXL.')
    const copy = createCanvas(mask.width, mask.height); copy.getContext('2d').drawImage(mask, 0, 0)
    const recipient = createPhotoHost(removalManifest)
    receiveSnapshot.get(recipient)(snapshot)
    const source = Object.freeze({ canvas: snapshot.canvas, name: snapshot.name, initialMask: copy, maskProvenance: { plugin: manifest.id, model: manifest.model.id, modelSha256: manifest.model.sha256, area: provenance.area } })
    snapshot = null; owned = false; pendingVariant = null; controller = null
    pluginActivity.dirty = true
    return { host: recipient, source }
  }
  async function exportMask(mask, area, bundle = false) {
    allowed('photo.mask-export'); currentMask(mask)
    if (!['subject', 'background'].includes(area)) throw new Error('Unknown mask selection.')
    applying = true
    let raster
    try {
      raster = grayscaleMask(mask, snapshot.canvas.width, snapshot.canvas.height)
      const maskBlob = await canvasToBlob(raster, 'png', 1, {})
      let blob = maskBlob
      if (bundle) {
        const source = await canvasToBlob(snapshot.canvas, 'png', 1, snapshot.metadata, snapshot.metadataOptions)
        if (source.size + maskBlob.size > 120 * 1024 ** 2) throw new Error('The image/mask bundle is too large. Use a smaller source.')
        blob = await createZip([
          { name: 'image.png', blob: source }, { name: 'mask.png', blob: maskBlob },
          { name: 'selection.json', text: JSON.stringify({ version: 1, width: raster.width, height: raster.height, selection: area, polarity: 'white-repaint-black-preserve', source: 'image.png', mask: 'mask.png', sourceName: snapshot.name, model: manifest.model.id, modelSha256: manifest.model.sha256 }, null, 2) },
          { name: 'README.txt', text: 'Imejii selection interchange v1\nimage.png: original working photo, before Subject Studio composition.\nmask.png: matching opaque grayscale mask; white=repaint, black=preserve, gray=soft boundary.\nFor SDXL inpainting, load both images and check your backend mask polarity. Resize image and mask together.\nThis archive contains data only, no executable workflow and no generated background.\n' },
        ])
      }
      if (blob.size > 128 * 1024 ** 2) throw new Error('Mask export exceeds the file size limit.')
      return await saveBlob(blob, slugify(snapshot.name) + '-' + area + (bundle ? '-inpaint.zip' : '-mask.png'))
    } finally { applying = false; if (raster) raster.width = raster.height = 1 }
  }
  async function openStudio(mask, area) {
    allowed('photo.mask-handoff'); currentMask(mask)
    if (!['subject', 'background'].includes(area)) throw new Error('Unknown mask selection.')
    if (!usePluginStore().studioEnabled) throw new Error('Enable AI Studio in Plugins first. Your selection stays here.')
    applying = true
    try {
      await useStudioStore().newSource(snapshot.canvas, snapshot.name, mask, { kind: 'subject-studio-before-composition', area, sourceDraftId: snapshot.draftId, edits: snapshot.edits,
        segmentation: { model: manifest.model.id, modelSha256: manifest.model.sha256 } })
    } finally { applying = false }
  }
  function release() {
    controller?.abort(); controller = null; snapshot = null; pendingVariant = null
    if (!owned) return
    owned = false
    pluginActivity.active = false; pluginActivity.dirty = false
  }
  const api = Object.freeze({ capture, apply, release, handoff, exportMask, openStudio, setDirty: value => { if (owned) pluginActivity.dirty = Boolean(value) } })
  receiveSnapshot.set(api, captured => { snapshot = captured; owned = true })
  return api
}
