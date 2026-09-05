import { computed, markRaw, reactive, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { decodePhoto, readPhotoInfo } from '../lib/photoLoader.js'
import {
  DEFAULT_EDITS,
  computeAutoAdjustments,
  computeHistogram,
  createEdits,
  flipCropRect,
  hasEdits,
  previewGeometry,
  processPhoto,
  resolveTargetSize,
  rotateCropRect,
} from '../lib/photoPipeline.js'
import { DEFAULT_ADJUSTMENTS } from '../lib/adjustments.js'
import { whiteBalanceFromSample } from '../lib/photoCurves.js'
import { createColorShift } from '../lib/colorShifts.js'
import { hexToRgb, rgbToHex } from '../lib/color.js'
import { sampleColorAt } from '../lib/imageLoader.js'
import { canvasToImageData } from '../lib/transform.js'
import { EXPORT_FORMATS, canvasToBlob, slugify } from '../lib/exportImage.js'
import { applyWatermark } from '../lib/watermark.js'
import { DEFAULT_METADATA } from '../lib/photoMetadata.js'
import { isDesktop, listFolderImages, readImagesById, saveBlob, beginFileSet, confirmDiscard } from '../lib/desktop.js'
import { processPhotoAsync } from '../lib/photoProcessing.js'
import { exportName, uniqueExportName } from '../lib/exportNames.js'
import { useUiStore } from './ui.js'

function pluginExtensions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const serialized = JSON.stringify(value)
  if (serialized.length > 512000) throw new Error('Plugin metadata is too large.')
  return JSON.parse(serialized)
}

/** Kantenlaenge, mit der das aktive Bild fuer die Ansicht dekodiert wird. */
const VIEW_MAX_SIZE = 2600
const HISTORY_LIMIT = 30

let nextId = 1

export const useLibraryStore = defineStore('library', () => {
  const ui = useUiStore()

  const items = ref([]) // { id, file, name, size, width, height, orientation, exif, thumbnail, edits }
  const activeId = ref(null)

  const sourceCanvas = shallowRef(null) // dekodiertes Original des aktiven Bildes
  const previewCanvas = shallowRef(null) // Ergebnis nach allen Bearbeitungen
  const renderVersion = ref(0)

  const isImporting = ref(false)
  const isDecoding = ref(false)
  const isRendering = ref(false)
  const batchProgress = ref(null) // { done, total, label }

  // --- Ansicht -----------------------------------------------------------
  const zoom = ref(1)
  const fitToView = ref(true)
  const showOriginal = ref(false)
  const isFullscreen = ref(false)
  const slideshow = ref({ active: false, interval: 3 })
  const sortMode = ref('added') // added | name | size | date

  // --- Zuschneiden -------------------------------------------------------
  const cropMode = ref(false)
  const cropAspect = ref(null) // null = frei, sonst Breite/Hoehe
  const cropDraft = ref(null) // { x, y, width, height } relativ 0..1

  // --- Pipette -----------------------------------------------------------
  const eyedropperMode = ref(false)
  const clippingWarning = ref(false)
  /** Hoechstzahl gezielter Farbaenderungen je Bild. */
  const COLOR_SHIFT_LIMIT = 6

  // --- Stapelverarbeitung ------------------------------------------------
  const batch = ref({
    format: 'jpeg',
    quality: 88,
    resize: { mode: 'none', value: 1920 },
    applyEdits: true,
    pattern: '{name}',
  })

  // --- Wasserzeichen -------------------------------------------------------
  // Wird beim Export angewendet (Einzelbild, Zwischenablage und Stapel) - nicht
  // in der Bearbeitungsvorschau, damit es die eigentliche Bildbearbeitung nicht beeinflusst.
  const metadataOptions = ref({ ...DEFAULT_METADATA })
  const watermark = ref({
    enabled: false,
    text: '',
    position: 'br',
    opacity: 65,
    scale: 4,
  })

  const history = reactive(new Map())
  const historyTimers = new Map()
  let restoringHistory = false
  let selectionVersion = 0
  let sourceId = null
  let renderController = null
  let batchController = null
  let exportController = null
  let importCanceled = false
  let importQueue = Promise.resolve()
  const sourceLimit = ref(VIEW_MAX_SIZE)
  const exportBusy = ref(false)
  const folderNavigation = ref(false)
  const isDirty = computed(() => items.value.some(item => hasEdits(item.edits)))
  const hasPendingWork = computed(() => isDirty.value || isImporting.value || exportBusy.value || Boolean(batchProgress.value))

  const activeItem = computed(() => items.value.find((item) => item.id === activeId.value) || null)
  const activeIndex = computed(() => items.value.findIndex((item) => item.id === activeId.value))
  const hasItems = computed(() => items.value.length > 0)
  const totalBytes = computed(() => items.value.reduce((sum, item) => sum + item.size, 0))
  const editedCount = computed(() => items.value.filter((item) => hasEdits(item.edits)).length)

  const outputSize = computed(() => {
    const item = activeItem.value
    if (!item) return null
    return previewGeometry(item.width, item.height, item.edits)
  })

  const canUndo = computed(() => {
    const item = activeItem.value
    const entry = history.get(item?.id)
    return Boolean(entry && (entry.undo.length || JSON.stringify(item.edits) !== entry.committed))
  })
  const canRedo = computed(() => (history.get(activeId.value)?.redo.length || 0) > 0)

  const histogram = shallowRef(null)

  // --- Import ------------------------------------------------------------
  /** @returns {Promise<number[]>} Kennungen der neu aufgenommenen Bilder */
  function addFiles(fileList) {
    const files = Array.from(fileList || [])
    const pending = importQueue.then(() => addFilesImpl(files))
    importQueue = pending.catch(() => {})
    return pending
  }
  async function addFilesImpl(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length || isImporting.value) return []
    if (items.value.length + files.length > 1000) {
      ui.setNotice('error', 'A collection can contain at most 1,000 images.', 8000)
      return []
    }
    const retainedBytes = [...items.value.map(item => item.file), ...files]
      .filter(file => !file.desktopId).reduce((sum, file) => sum + file.size, 0)
    if (retainedBytes > 512 * 1024 * 1024) {
      ui.setNotice('error', 'Browser collection limit is 512 MiB. Use fewer files or open them in the desktop app.', 8000)
      return []
    }
    importCanceled = false
    folderNavigation.value = items.value.length === 0 && files.length === 1 && Boolean(files[0].desktopId)

    isImporting.value = true
    const addedIds = []
    const failed = []
    const formatWarnings = []

    for (const file of files) {
      if (importCanceled) break
      if (file.desktopId && items.value.some(item => item.file.desktopId === file.desktopId)) continue
      try {
        const info = await readPhotoInfo(file)
        if (importCanceled) break
        if (info.warnings?.length) formatWarnings.push(file.name + ': ' + info.warnings.join(' '))
        const id = nextId++
        items.value.push({
          id,
          draftId: 'photo:' + crypto.randomUUID(),
          file: markRaw(file),
          desktopId: file.desktopId || null,
          ...info,
          edits: createEdits(),
        })
        entryFor(id)
        addedIds.push(id)
      } catch (error) {
        failed.push(file.name + ' (' + error.message + ')')
      }
    }

    isImporting.value = false

    if (addedIds.length && activeId.value === null) {
      await select(items.value[0].id)
    }
    if (failed.length) {
      ui.setNotice('error', 'Could not read: ' + failed.join(', '), 8000)
    } else if (formatWarnings.length) {
      ui.setNotice('info', formatWarnings.slice(0, 3).join(' · '), 10000)
    } else if (addedIds.length) {
      ui.setNotice('success', addedIds.length + ' image(s) added.')
    }

    return addedIds
  }

  function cancelImport() { importCanceled = true }

  async function select(id, { fullResolution = false } = {}) {
    if (id === activeId.value && sourceCanvas.value && (!fullResolution || sourceLimit.value === 0)) return
    const item = items.value.find((entry) => entry.id === id)
    if (!item) return

    commitHistory(activeItem.value)
    const version = ++selectionVersion
    cancelPendingRender()
    renderController?.abort()
    sourceCanvas.value = null
    previewCanvas.value = null
    histogram.value = null
    sourceId = null
    isRendering.value = false
    activeId.value = id
    sourceLimit.value = fullResolution ? 0 : VIEW_MAX_SIZE
    entryFor(id)
    cropMode.value = false
    cropDraft.value = null
    eyedropperMode.value = false
    fitToView.value = true
    zoom.value = 1
    isDecoding.value = true

    try {
      const canvas = await decodePhoto(item.file, {
        maxSize: sourceLimit.value,
        orientation: item.orientation,
      })
      if (version !== selectionVersion || activeId.value !== id) return
      sourceId = id
      sourceCanvas.value = markRaw(canvas)
      await renderNow()
    } catch (error) {
      if (version !== selectionVersion) return
      ui.setNotice('error', 'Could not open ' + item.name + ': ' + error.message, 8000)
      sourceCanvas.value = null
      previewCanvas.value = null
    } finally {
      if (version === selectionVersion) isDecoding.value = false
    }
  }

  async function remove(id) {
    let index = items.value.findIndex((item) => item.id === id)
    if (index < 0) return
    if (hasEdits(items.value[index].edits) && !await confirmDiscard('Remove this image and discard its edits?')) return
    index = items.value.findIndex(item => item.id === id)
    if (index < 0) return
    clearTimeout(historyTimers.get(id))
    historyTimers.delete(id)
    items.value.splice(index, 1)
    history.delete(id)

    if (activeId.value === id) {
      const next = items.value[index] || items.value[index - 1]
      if (next) {
        select(next.id)
      } else {
        selectionVersion++
        renderController?.abort()
        cancelPendingRender()
        isRendering.value = false
        isDecoding.value = false
        activeId.value = null
        sourceCanvas.value = null
        previewCanvas.value = null
      }
    }
  }

  async function clearAll() {
    if (isDirty.value && !await confirmDiscard('Clear the collection and discard all image edits?')) return
    cancelImport()
    selectionVersion++
    renderController?.abort()
    cancelPendingRender()
    for (const timer of historyTimers.values()) clearTimeout(timer)
    historyTimers.clear()
    folder.value = null
    folderNavigation.value = false
    isDecoding.value = false
    isRendering.value = false
    items.value = []
    history.clear()
    activeId.value = null
    sourceCanvas.value = null
    previewCanvas.value = null
  }

  // --- Ordner des aktiven Bildes -----------------------------------------
  // Ein einzeln geoeffnetes Bild (Doppelklick im Explorer) laesst sich wie in
  // jedem Bildbetrachter durchblaettern: die Pfeiltasten laufen durch den
  // ganzen Ordner, nicht nur durch die geladenen Bilder.
  const folder = ref(null)
  let folderBusy = false

  async function ensureFolder() {
    const item = activeItem.value
    if (!isDesktop || !item?.desktopId) { folder.value = null; return null }
    if (folder.value?.entries.some(entry => entry.id === item.desktopId)) return folder.value
    try {
      const listing = await listFolderImages(item.desktopId)
      if (activeId.value !== item.id) return null
      folder.value = listing
      return listing
    } catch (error) {
      if (activeId.value === item.id) folder.value = null
      ui.setNotice('error', 'Could not read the folder: ' + error.message, 6000)
      return null
    }
  }
  const folderIndex = computed(() => ui.mode === 'view'
    ? folder.value?.entries.findIndex(entry => entry.id === activeItem.value?.desktopId) ?? -1 : -1)
  const canStep = computed(() => items.value.length > 1 || (folderIndex.value >= 0 && folder.value.entries.length > 1))
  const position = computed(() => folderNavigation.value && folderIndex.value >= 0
    ? { index: folderIndex.value + 1, total: folder.value.entries.length }
    : { index: activeIndex.value + 1, total: items.value.length })

  async function stepFolder(delta) {
    const item = activeItem.value
    if (ui.mode !== 'view' || !isDesktop || !item?.desktopId || folderBusy) return false
    folderBusy = true
    try {
      const listing = await ensureFolder()
      if (!listing || listing.entries.length < 2 || activeId.value !== item.id) return false
      const index = listing.entries.findIndex(entry => entry.id === item.desktopId)
      if (index < 0) { folder.value = null; return false }
      const next = listing.entries[(index + delta + listing.entries.length) % listing.entries.length]
      let fresh = items.value.find(entry => entry.desktopId === next.id)
      if (!fresh) {
        // Only the requested neighbor is read; edits and history of existing images survive.
        const { files, error } = await readImagesById([next.id])
        if (!files.length) throw new Error(error || 'Image could not be read.')
        const info = await readPhotoInfo(files[0])
        if (activeId.value !== item.id || ui.mode !== 'view') return false
        if (items.value.length >= 1000) throw new Error('Collection limit reached. Remove some images first.')
        const descriptor = { desktopId: next.id, name: info.name, type: info.type, size: info.size, lastModified: info.lastModified }
        fresh = { id: nextId++, draftId: 'photo:' + crypto.randomUUID(), file: markRaw(descriptor), desktopId: next.id, ...info, edits: createEdits(), ephemeral: true }
        items.value.push(fresh)
        entryFor(fresh.id)
      }
      await select(fresh.id)
      const oldHistory = history.get(item.id)
      if (item.ephemeral && !hasEdits(item.edits) && !oldHistory?.undo.length && !oldHistory?.redo.length) {
        const slot = items.value.findIndex(entry => entry.id === item.id)
        if (slot >= 0) items.value.splice(slot, 1)
        clearTimeout(historyTimers.get(item.id))
        historyTimers.delete(item.id)
        history.delete(item.id)
      }
      return true
    } catch (error) {
      ui.setNotice('error', 'Could not open neighbor: ' + error.message, 8000)
      return false
    } finally { folderBusy = false }
  }
  function step(delta) {
    if (folderNavigation.value && ui.mode === 'view') return stepFolder(delta)
    if (items.value.length > 1) {
      const next = (activeIndex.value + delta + items.value.length) % items.value.length
      return select(items.value[next].id)
    }
    return stepFolder(delta)
  }

  function sortBy(mode) {
    sortMode.value = mode
    const compare = {
      added: (a, b) => a.id - b.id,
      name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      size: (a, b) => b.size - a.size,
      date: (a, b) => b.lastModified - a.lastModified,
    }[mode]
    if (compare) items.value.sort(compare)
  }

  // --- Rendern -----------------------------------------------------------
  let renderHandle = null
  let renderFallback = null

  function cancelPendingRender() {
    if (renderHandle) cancelAnimationFrame(renderHandle)
    if (renderFallback) clearTimeout(renderFallback)
    renderHandle = null
    renderFallback = null
  }

  function scheduleRender() {
    if (!sourceCanvas.value) return
    cancelPendingRender()
    isRendering.value = true
    renderHandle = requestAnimationFrame(runScheduledRender)
    // Ohne Animationsframes (Hintergrundtab, verstecktes Fenster) wuerde die
    // Vorschau sonst stehen bleiben - deshalb ein zweiter Ausloeser.
    renderFallback = setTimeout(runScheduledRender, 200)
  }

  function runScheduledRender() {
    cancelPendingRender()
    renderNow()
  }

  async function renderNow() {
    const item = activeItem.value
    if (!item || !sourceCanvas.value || sourceId !== item.id) return
    renderController?.abort()
    const controller = new AbortController()
    renderController = controller
    isRendering.value = true
    try {
      // Die Ansicht ist bereits skaliert - die Resize-Regel gilt nur beim Export.
      const factor = Math.max(1, Math.max(sourceCanvas.value.width, sourceCanvas.value.height) / VIEW_MAX_SIZE)
      const canvas = await processPhotoAsync(sourceCanvas.value, { ...item.edits, blur: item.edits.blur > 0 ? Math.round(item.edits.blur * factor) : 0 }, { skipResize: true }, controller.signal)
      if (controller.signal.aborted || sourceId !== item.id) return
      previewCanvas.value = markRaw(canvas)
      renderVersion.value++
      histogram.value = null
    } catch (error) {
      if (error.name === 'AbortError') return
      ui.setNotice('error', 'Processing failed: ' + error.message, 6000)
    } finally {
      if (renderController === controller) isRendering.value = false
    }
  }

  /** Histogramm wird nur auf Anfrage berechnet - es kostet einen vollen Pixellauf. */
  function ensureHistogram() {
    if (histogram.value || !previewCanvas.value) return histogram.value
    const source = previewCanvas.value
    const scale = Math.min(1, 512 / Math.max(source.width, source.height))
    let sample = source
    if (scale < 1) {
      const small = document.createElement('canvas')
      small.width = Math.max(1, Math.round(source.width * scale))
      small.height = Math.max(1, Math.round(source.height * scale))
      small.getContext('2d').drawImage(source, 0, 0, small.width, small.height)
      sample = small
    }
    histogram.value = markRaw(computeHistogram(canvasToImageData(sample)))
    return histogram.value
  }

  watch(
    () => activeItem.value?.edits,
    () => {
      scheduleRender()
      queueHistoryCommit()
    },
    { deep: true, flush: 'sync' },
  )

  // --- Bearbeiten --------------------------------------------------------
  function patchEdits(patch) {
    const item = activeItem.value
    if (!item) return
    Object.assign(item.edits, patch)
  }

  function rotateBy(degrees) {
    const item = activeItem.value
    if (!item) return
    const quarter = Math.round(degrees / 90)
    if (Math.abs(quarter) % 2) {
      const horizontal = item.edits.flipH
      item.edits.flipH = item.edits.flipV
      item.edits.flipV = horizontal
    }
    item.edits.rotate = (((item.edits.rotate + quarter * 90) % 360) + 360) % 360
    item.edits.crop = rotateCropRect(item.edits.crop, quarter)
  }

  function flip(axis) {
    const item = activeItem.value
    if (!item) return
    if (axis === 'h') {
      item.edits.flipH = !item.edits.flipH
      item.edits.crop = flipCropRect(item.edits.crop, true)
    } else {
      item.edits.flipV = !item.edits.flipV
      item.edits.crop = flipCropRect(item.edits.crop, false)
    }
  }

  function applyCrop() {
    const item = activeItem.value
    if (!item || !cropDraft.value) return
    const draft = cropDraft.value
    const previous = item.edits.crop

    // Der Entwurf bezieht sich auf die aktuelle Ansicht - also auf ein bereits
    // zugeschnittenes Bild. Deshalb in die Koordinaten des Originals umrechnen.
    item.edits.crop = previous
      ? {
          x: previous.x + draft.x * previous.width,
          y: previous.y + draft.y * previous.height,
          width: previous.width * draft.width,
          height: previous.height * draft.height,
        }
      : { ...draft }

    cropMode.value = false
    cropDraft.value = null
  }

  function cancelCrop() {
    cropMode.value = false
    cropDraft.value = null
  }

  function clearCrop() {
    const item = activeItem.value
    if (!item) return
    item.edits.crop = null
    cropDraft.value = null
  }

  function autoEnhance() {
    const item = activeItem.value
    if (!item || !previewCanvas.value) return
    const auto = computeAutoAdjustments(canvasToImageData(previewCanvas.value))
    item.edits.adjustments = { ...item.edits.adjustments, ...auto }
    ui.setNotice('success', 'Auto tone applied.')
  }

  function resetEdits() {
    const item = activeItem.value
    if (!item) return
    item.edits = createEdits()
    cropDraft.value = null
    ui.setNotice('info', 'Edits reset for this image.')
  }

  function applyEditsToAll() {
    const item = activeItem.value
    if (!item) return
    // Der Zuschnitt bleibt bewusst aussen vor: er passt selten auf andere Motive.
    const shared = {
      adjustments: { ...item.edits.adjustments },
      curve: [...item.edits.curve],
      localMasks: item.edits.localMasks.map(mask => ({ ...mask })),
      colorShifts: item.edits.colorShifts.map((shift) => ({ ...shift })),
      sharpen: item.edits.sharpen,
      blur: item.edits.blur,
      vignette: item.edits.vignette,
      resize: { ...item.edits.resize },
    }
    for (const entry of items.value) {
      if (entry.id === item.id) continue
      commitHistory(entry)
      Object.assign(entry.edits, {
        adjustments: { ...shared.adjustments },
        curve: [...shared.curve],
        localMasks: shared.localMasks.map(mask => ({ ...mask })),
        colorShifts: shared.colorShifts.map((shift) => ({ ...shift })),
        sharpen: shared.sharpen,
        blur: shared.blur,
        vignette: shared.vignette,
        resize: { ...shared.resize },
      })
      commitHistory(entry)
    }
    ui.setNotice('success', 'Applied to ' + (items.value.length - 1) + ' other image(s).')
  }

  // --- Gezielte Farbaenderung --------------------------------------------
  // Die Pipette liest aus der fertigen Vorschau: was auf dem Schirm steht, ist
  // genau das, was der neue Eintrag spaeter trifft.
  let pickerSample = null

  watch([eyedropperMode, renderVersion], () => {
    // Einmal auslesen statt bei jeder Mausbewegung - getImageData ist teuer.
    if (eyedropperMode.value === 'white-balance' && sourceCanvas.value && activeItem.value) {
      const { rotate, flipH, flipV, straighten, crop } = activeItem.value.edits
      const originalGeometry = processPhoto(sourceCanvas.value, createEdits({ rotate, flipH, flipV, straighten, crop }), { skipResize: true })
      pickerSample = canvasToImageData(originalGeometry)
      originalGeometry.width = originalGeometry.height = 1
    } else pickerSample = eyedropperMode.value && previewCanvas.value ? canvasToImageData(previewCanvas.value) : null
  })

  // Zuschneiden und Pipette greifen beide auf die Buehne zu - nur eins davon.
  watch(eyedropperMode, (active) => {
    if (active) cropMode.value = false
  })
  watch(cropMode, (active) => {
    if (active) eyedropperMode.value = false
  })

  /** Farbe an einer Vorschaukoordinate lesen - fuer die Anzeige unter dem Zeiger. */
  function samplePreviewColor(x, y) {
    return pickerSample ? sampleColorAt(pickerSample, x, y, 1) : null
  }

  function addColorShift(hex) {
    const item = activeItem.value
    if (!item) return
    const rgb = hexToRgb(hex)
    if (!rgb) return
    if (item.edits.colorShifts.length >= COLOR_SHIFT_LIMIT) {
      ui.setNotice('info', 'At most ' + COLOR_SHIFT_LIMIT + ' selective colors per image.')
      return
    }
    item.edits.colorShifts.push(createColorShift(rgbToHex(rgb.r, rgb.g, rgb.b)))
  }

  /** Farbe aufnehmen und als neuen Eintrag anlegen. */
  function pickColorShift(x, y) {
    const sample = samplePreviewColor(x, y)
    if (!sample) {
      ui.setNotice('error', 'This spot is fully transparent - there is no color to pick.')
      return null
    }
    if (eyedropperMode.value === 'white-balance') {
      try {
        const correction = whiteBalanceFromSample(sample)
        const adjustments = activeItem.value.edits.adjustments
        for (const channel of ['R', 'G', 'B']) correction['whiteBalance' + channel] = Math.max(0.25, Math.min(4, correction['whiteBalance' + channel]))
        Object.assign(adjustments, correction)
        eyedropperMode.value = false
        ui.setNotice('success', 'White balance sampled. Tone and other color edits remain applied.')
      } catch (error) { ui.setNotice('error', error.message) }
    } else addColorShift(sample.hex)
    return sample
  }

  function removeColorShift(index) {
    const item = activeItem.value
    if (item) item.edits.colorShifts.splice(index, 1)
  }

  function clearColorShifts() {
    const item = activeItem.value
    if (item) item.edits.colorShifts = []
  }

  // --- History -----------------------------------------------------------
  function entryFor(id) {
    if (!history.has(id)) {
      const item = items.value.find(entry => entry.id === id)
      history.set(id, { undo: [], redo: [], committed: JSON.stringify(item?.edits || createEdits()) })
    }
    return history.get(id)
  }
  function queueHistoryCommit() {
    const item = activeItem.value
    if (!item || restoringHistory) return
    clearTimeout(historyTimers.get(item.id))
    historyTimers.set(item.id, setTimeout(() => commitHistory(item), 350))
  }
  function commitHistory(item = activeItem.value) {
    if (!item) return
    clearTimeout(historyTimers.get(item.id))
    historyTimers.delete(item.id)
    const entry = entryFor(item.id)
    const serialized = JSON.stringify(item.edits)
    if (serialized === entry.committed) return
    entry.undo.push(entry.committed)
    if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift()
    entry.redo = []
    entry.committed = serialized
  }
  function undo() {
    const item = activeItem.value
    if (!item) return
    commitHistory(item)
    const entry = entryFor(item.id)
    const previous = entry.undo.pop()
    if (!previous) return
    entry.redo.push(JSON.stringify(item.edits))
    restoringHistory = true
    try { item.edits = JSON.parse(previous); entry.committed = previous }
    finally { restoringHistory = false }
  }
  function redo() {
    const item = activeItem.value
    if (!item) return
    commitHistory(item)
    const entry = entryFor(item.id)
    const next = entry.redo.pop()
    if (!next) return
    entry.undo.push(JSON.stringify(item.edits))
    restoringHistory = true
    try { item.edits = JSON.parse(next); entry.committed = next }
    finally { restoringHistory = false }
  }

  // --- Export ------------------------------------------------------------
  function hasSavedEdits(item) {
    const entry = history.get(item.id)
    return hasEdits(item.edits) || Boolean(entry?.undo.length || entry?.redo.length) || Boolean(Object.keys(item.extensions || {}).length)
  }
  function draftState(id) {
    const item = items.value.find(entry => entry.id === id)
    if (!item) return null
    const entry = history.get(id)
    return { edits: JSON.parse(JSON.stringify(item.edits)), history: entry ? { undo: [...entry.undo], redo: [...entry.redo], committed: entry.committed } : null, extensions: pluginExtensions(item.extensions) }
  }
  async function restoreDraft(draft) {
    if (!draft.state?.edits || typeof draft.state.edits !== 'object') throw new Error('Project has no valid photo settings.')
    const restoredEdits = createEdits(draft.state.edits)
    const restoredExtensions = pluginExtensions(draft.state.extensions)
    const prior = draft.state.history
    const sanitize = values => (Array.isArray(values) ? values : []).slice(-HISTORY_LIMIT).map(value => JSON.stringify(createEdits(JSON.parse(value))))
    const restoredHistory = { undo: sanitize(prior?.undo), redo: sanitize(prior?.redo), committed: JSON.stringify(restoredEdits) }
    if (prior?.committed && JSON.stringify(createEdits(JSON.parse(prior.committed))) !== restoredHistory.committed) restoredHistory.undo.push(JSON.stringify(createEdits(JSON.parse(prior.committed))))
    let item = items.value.find(entry => entry.draftId === draft.id)
    if (item && hasEdits(item.edits) && !await confirmDiscard('Replace the open edits with this saved copy?')) return false
    if (!item) {
      const ids = await addFiles([draft.file])
      item = items.value.find(entry => entry.id === ids[0])
      if (!item) throw new Error('Unable to restore the saved original.')
    }
    clearTimeout(historyTimers.get(item.id))
    item.draftId = draft.id
    item.edits = restoredEdits
    item.extensions = restoredExtensions
    history.set(item.id, restoredHistory)
    await select(item.id)
    scheduleRender()
    return true
  }
  /**
   * Rendert ein Bild in Originalaufloesung. Pixelbasierte Effekte werden dabei
   * hochgerechnet, damit das Ergebnis der Vorschau entspricht.
   */
  async function renderItemFullSize(item, overrides = {}, mark = watermark.value, signal) {
    const source = JSON.parse(JSON.stringify({ ...item.edits, ...overrides }))
    const watermarkSnapshot = JSON.parse(JSON.stringify(mark))
    const canvas = await decodePhoto(item.file, { orientation: item.orientation })
    // Die Vorschau rechnet auf einer verkleinerten Kopie. Pixelbasierte Effekte
    // muessen deshalb um genau diesen Faktor mitwachsen - je Bild, nicht global.
    const viewScale = Math.min(1, VIEW_MAX_SIZE / Math.max(item.width, item.height))
    const factor = viewScale > 0 ? 1 / viewScale : 1
    const edits = {
      ...source,
      adjustments: { ...source.adjustments },
      resize: source.resize,
      blur: source.blur > 0 ? Math.max(1, Math.round(source.blur * factor)) : 0,
    }
    const result = await processPhotoAsync(canvas, edits, {}, signal)
    if (watermarkSnapshot.enabled) applyWatermark(result, watermarkSnapshot)
    return result
  }

  async function capturePluginPhoto(signal) {
    const item = activeItem.value
    if (!item) throw new Error('Open a photo first.')
    const geometry = previewGeometry(item.width, item.height, item.edits)
    if (item.width * item.height > 24000000 || geometry.width * geometry.height > 24000000) throw new Error('Local AI currently supports photos up to 24 megapixels. Export a smaller copy first.')
    const edits = JSON.parse(JSON.stringify(item.edits))
    const snapshot = { id: item.id, draftId: item.draftId, file: item.file, name: item.name, edits,
      metadata: JSON.parse(JSON.stringify(item.metadata || {})), metadataOptions: { ...metadataOptions.value },
      revision: JSON.stringify(item.edits) }
    snapshot.canvas = await renderItemFullSize({ ...item, edits }, { resize: { mode: 'none' } }, { enabled: false }, signal)
    signal?.throwIfAborted()
    if (!isPluginSnapshotCurrent(snapshot)) throw new Error('The source changed while preparing the workspace.')
    return snapshot
  }
  function isPluginSnapshotCurrent(snapshot) {
    const item = items.value.find(entry => entry.id === snapshot.id)
    return Boolean(item && item.file === snapshot.file && item.draftId === snapshot.draftId && JSON.stringify(item.edits) === snapshot.revision)
  }
  function assertCanAddPluginFile(file) {
    if (!(file instanceof File) || file.size > 128 * 1024 ** 2) throw new Error('Generated photo exceeds the 128 MiB file limit.')
    if (items.value.length >= 1000) throw new Error('The collection is full. Make room for a new photo first.')
    const retained = items.value.filter(item => !item.file.desktopId).reduce((sum, item) => sum + item.file.size, 0)
    if (retained + file.size > 512 * 1024 ** 2) throw new Error('The collection cannot retain another generated photo within its 512 MiB memory budget.')
  }

  async function saveActiveAsImpl(format = 'png', quality = 92) {
    const item = activeItem.value
    if (!item) return
    const config = EXPORT_FORMATS[format] || EXPORT_FORMATS.png
    const metadata = { ...metadataOptions.value }
    const canvas = await renderItemFullSize(item, {}, watermark.value, exportController?.signal)
    const blob = await canvasToBlob(canvas, format, quality / 100, item.metadata, metadata)
    const fileName = slugify(item.name) + '.' + config.extension
    const result = await saveBlob(blob, fileName, { signal: exportController?.signal })
    if (result.saved) ui.setNotice('success', 'Saved: ' + (result.path || fileName))
  }

  async function copyActiveToClipboardImpl() {
    const item = activeItem.value
    if (!item) return
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      ui.setNotice('error', 'This browser does not support the clipboard.')
      return
    }
    const metadata = { ...metadataOptions.value }
    const canvas = await renderItemFullSize(item, {}, watermark.value, exportController?.signal)
    const blob = await canvasToBlob(canvas, 'png', 0.92, item.metadata, metadata)
    exportController?.signal.throwIfAborted()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    ui.setNotice('success', 'PNG copied to the clipboard.')
  }

  async function runExport(action) {
    if (exportBusy.value || batchProgress.value) return
    exportBusy.value = true
    exportController = new AbortController()
    try { return await action() }
    catch (error) { ui.setNotice(error.name === 'AbortError' ? 'info' : 'error', error.message, 8000) }
    finally { exportBusy.value = false; exportController = null }
  }
  function cancelExport() { exportController?.abort() }
  function saveActiveAs(...args) { return runExport(() => saveActiveAsImpl(...args)) }
  function copyActiveToClipboard() { return runExport(copyActiveToClipboardImpl) }
  function cancelBatch() { batchController?.abort() }
  async function showActualPixels() {
    if (!activeItem.value) return
    const id = activeId.value
    await select(id, { fullResolution: true })
    if (activeId.value === id) { zoom.value = 1; fitToView.value = false }
  }

  async function runBatch() {
    if (!items.value.length || batchProgress.value || exportBusy.value) return
    const settings = JSON.parse(JSON.stringify(batch.value))
    const mark = JSON.parse(JSON.stringify(watermark.value))
    const metadata = { ...metadataOptions.value }
    const snapshot = items.value.map(item => ({ ...item, edits: JSON.parse(JSON.stringify(item.edits)) }))
    const config = EXPORT_FORMATS[settings.format] || EXPORT_FORMATS.png
    const used = new Set()
    const controller = new AbortController()
    batchController = controller
    let session = null
    batchProgress.value = { done: 0, total: snapshot.length, label: 'Choose output location' }
    try {
      session = await beginFileSet({ zipName: 'images-' + snapshot.length + '.zip' })
      if (!session) { ui.setNotice('info', 'Export canceled.'); return }
      for (let index = 0; index < snapshot.length; index++) {
        if (controller.signal.aborted) throw new DOMException('Export canceled.', 'AbortError')
        const item = snapshot[index]
        batchProgress.value = { done: index, total: snapshot.length, label: item.name }
        const edits = settings.applyEdits ? item.edits : createEdits()
        const canvas = await renderItemFullSize(item, { ...edits, resize: settings.resize }, mark, controller.signal)
        const blob = await canvasToBlob(canvas, settings.format, settings.quality / 100, item.metadata, metadata)
        if (controller.signal.aborted) throw new DOMException('Export canceled.', 'AbortError')
        const name = uniqueExportName(exportName(settings.pattern, item, index, canvas, config.extension), used)
        await session.write({ name, blob })
        canvas.width = 1; canvas.height = 1
        batchProgress.value = { done: index + 1, total: snapshot.length, label: item.name }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      const result = await session.finish()
      ui.setNotice('success', result.count + ' image(s) exported' + (result.path ? ' to ' + result.path : '.'))
    } catch (error) {
      let suffix = ''
      if (session) {
        try {
          const result = await session.finish({ canceled: true })
          if (result.path) suffix = ' Completed files kept in: ' + result.path
        } catch (finishError) { suffix = ' Export cleanup failed: ' + finishError.message }
      }
      ui.setNotice(error.name === 'AbortError' ? 'info' : 'error', error.message + suffix, 10000)
    } finally { batchProgress.value = null; batchController = null }
  }

  /** Geschaetzte Ausgabegroesse eines Bildes mit den aktuellen Stapel-Einstellungen. */
  function batchTargetSize(item) {
    const geometry = previewGeometry(item.width, item.height, {
      ...(batch.value.applyEdits ? item.edits : createEdits()),
      resize: { mode: 'none', value: 0 },
    })
    return resolveTargetSize(geometry.width, geometry.height, batch.value.resize)
  }

  return {
    capturePluginPhoto, isPluginSnapshotCurrent, assertCanAddPluginFile, freshPhotoEdits: createEdits,
    draftState, restoreDraft, hasSavedEdits, clippingWarning,
    // State
    exportBusy,
    sourceLimit,
    showActualPixels,
    isDirty,
    hasPendingWork,
    cancelBatch,
    cancelExport,
    cancelImport,
    items,
    activeId,
    sourceCanvas,
    previewCanvas,
    renderVersion,
    isImporting,
    isDecoding,
    isRendering,
    batchProgress,
    zoom,
    fitToView,
    showOriginal,
    isFullscreen,
    slideshow,
    sortMode,
    cropMode,
    cropAspect,
    cropDraft,
    eyedropperMode,
    batch,
    watermark,
    metadataOptions,
    histogram,
    // Getter
    activeItem,
    activeIndex,
    hasItems,
    totalBytes,
    editedCount,
    outputSize,
    canUndo,
    canRedo,
    canStep,
    position,
    // Actions
    addFiles,
    select,
    remove,
    clearAll,
    step,
    ensureFolder,
    sortBy,
    scheduleRender,
    ensureHistogram,
    patchEdits,
    rotateBy,
    flip,
    applyCrop,
    cancelCrop,
    clearCrop,
    autoEnhance,
    samplePreviewColor,
    addColorShift,
    pickColorShift,
    removeColorShift,
    clearColorShifts,
    resetEdits,
    applyEditsToAll,
    undo,
    redo,
    saveActiveAs,
    copyActiveToClipboard,
    runBatch,
    batchTargetSize,
    DEFAULT_EDITS,
    DEFAULT_ADJUSTMENTS,
  }
})
