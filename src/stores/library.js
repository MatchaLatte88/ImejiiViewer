import { computed, markRaw, ref, shallowRef, watch } from 'vue'
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
import { canvasToImageData } from '../lib/transform.js'
import { EXPORT_FORMATS, canvasToBlob, slugify } from '../lib/exportImage.js'
import { applyWatermark } from '../lib/watermark.js'
import { isDesktop, listFolderImages, readImagesByPath, saveBlob, saveFileSet } from '../lib/desktop.js'
import { useUiStore } from './ui.js'

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
  const watermark = ref({
    enabled: false,
    text: '',
    position: 'br',
    opacity: 65,
    scale: 4,
  })

  const history = new Map() // itemId -> { undo: [], redo: [] }
  let historyTimer = null
  let lastCommitted = null

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

  const canUndo = computed(() => (history.get(activeId.value)?.undo.length || 0) > 0)
  const canRedo = computed(() => (history.get(activeId.value)?.redo.length || 0) > 0)

  const histogram = shallowRef(null)

  // --- Import ------------------------------------------------------------
  /** @returns {Promise<number[]>} Kennungen der neu aufgenommenen Bilder */
  async function addFiles(fileList) {
    const files = Array.from(fileList || [])
    if (!files.length) return []

    isImporting.value = true
    const addedIds = []
    const failed = []

    for (const file of files) {
      try {
        const info = await readPhotoInfo(file)
        const id = nextId++
        items.value.push({
          id,
          file: markRaw(file),
          path: file.desktopPath || null,
          ...info,
          edits: createEdits(),
        })
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
    } else if (addedIds.length) {
      ui.setNotice('success', addedIds.length + ' image(s) added.')
    }

    return addedIds
  }

  async function select(id) {
    if (id === activeId.value && sourceCanvas.value) return
    const item = items.value.find((entry) => entry.id === id)
    if (!item) return

    activeId.value = id
    cropMode.value = false
    cropDraft.value = null
    fitToView.value = true
    zoom.value = 1
    isDecoding.value = true

    try {
      const canvas = await decodePhoto(item.file, {
        maxSize: VIEW_MAX_SIZE,
        orientation: item.orientation,
      })
      sourceCanvas.value = markRaw(canvas)
      lastCommitted = JSON.stringify(item.edits)
      renderNow()
    } catch (error) {
      ui.setNotice('error', 'Could not open ' + item.name + ': ' + error.message, 8000)
      sourceCanvas.value = null
      previewCanvas.value = null
    } finally {
      isDecoding.value = false
    }
  }

  function remove(id) {
    const index = items.value.findIndex((item) => item.id === id)
    if (index < 0) return
    items.value.splice(index, 1)
    history.delete(id)

    if (activeId.value === id) {
      const next = items.value[index] || items.value[index - 1]
      if (next) {
        select(next.id)
      } else {
        activeId.value = null
        sourceCanvas.value = null
        previewCanvas.value = null
      }
    }
  }

  function clearAll() {
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
  const folder = ref(null) // { key, dir, names, separator } - Ordner des aktiven Bildes
  let folderBusy = false

  /** Ordnerteil eines Pfads - Windows und POSIX. */
  function dirOf(filePath) {
    const cut = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'))
    return cut > 0 ? filePath.slice(0, cut) : ''
  }

  /** Dateiname eines Pfads, gemessen am Ordner der Liste. */
  function nameIn(listing, filePath) {
    return filePath.slice(listing.dir.length).replace(/^[\\/]+/, '')
  }

  /**
   * Liest den Ordner des aktiven Bildes ein - einmal je Ordner. Der Betrachter
   * stoesst das beim Bildwechsel an, damit Pfeile und Zaehler stimmen.
   */
  async function ensureFolder() {
    const item = activeItem.value
    if (!isDesktop || !item?.path) {
      folder.value = null
      return null
    }

    const key = dirOf(item.path)
    if (folder.value?.key === key) return folder.value

    try {
      const listing = await listFolderImages(item.path)
      folder.value = listing ? { key, ...listing } : null
    } catch (error) {
      folder.value = null
      ui.setNotice('error', 'Could not read the folder: ' + error.message, 6000)
    }
    return folder.value
  }

  /** Platz des aktiven Bildes im Ordner - -1, wenn er nicht bekannt ist. */
  const folderIndex = computed(() => {
    const item = activeItem.value
    const listing = folder.value
    if (ui.mode !== 'view' || !item?.path || !listing) return -1
    return listing.names.indexOf(nameIn(listing, item.path))
  })

  /** Laesst sich ueberhaupt blaettern - in der Sammlung oder im Ordner? */
  const canStep = computed(
    () => items.value.length > 1 || (folderIndex.value >= 0 && folder.value.names.length > 1),
  )

  /** Anzeige "x / y": im Betrachter zaehlt der Ordner, sonst die Sammlung. */
  const position = computed(() => {
    if (items.value.length === 1 && folderIndex.value >= 0) {
      return { index: folderIndex.value + 1, total: folder.value.names.length }
    }
    return { index: activeIndex.value + 1, total: items.value.length }
  })

  /**
   * Blaettert im Ordner des aktiven Bildes. Das Nachbarbild wird erst beim
   * Anzeigen gelesen und ersetzt das bisherige - so waechst der Speicher beim
   * Durchblaettern grosser Ordner nicht mit.
   * @returns {Promise<boolean>} false, wenn nicht geblaettert werden konnte
   */
  async function stepFolder(delta) {
    const item = activeItem.value
    // Nur im Betrachter: im Bildmodus wuerde das Ersetzen Bearbeitungen verwerfen.
    if (ui.mode !== 'view' || !isDesktop || !item?.path || folderBusy) return false

    const listing = await ensureFolder()
    if (!listing || listing.names.length < 2) return false

    const index = listing.names.indexOf(nameIn(listing, item.path))
    if (index < 0) {
      // Der Ordner hat sich geaendert - beim naechsten Versuch neu einlesen.
      folder.value = null
      return false
    }

    const nextName = listing.names[(index + delta + listing.names.length) % listing.names.length]
    const separator = listing.dir.endsWith(listing.separator) ? '' : listing.separator
    const nextPath = listing.dir + separator + nextName

    folderBusy = true
    isDecoding.value = true
    try {
      const { files, error } = await readImagesByPath([nextPath])
      if (!files.length) throw new Error(error || 'file could not be read')

      const info = await readPhotoInfo(files[0])
      const id = nextId++
      const fresh = {
        id,
        file: markRaw(files[0]),
        path: nextPath,
        ...info,
        edits: createEdits(),
      }

      // Das bisherige Bild wird an seiner Stelle ersetzt und nicht erst
      // angehaengt: sonst waeren fuer die Dauer des Ladens zwei Bilder in der
      // Sammlung - Bibliotheksleiste und Zaehler wuerden aufblitzen und die
      // Buehne dabei springen.
      const slot = items.value.findIndex((candidate) => candidate.id === item.id)
      items.value.splice(slot, 1, fresh)
      history.delete(item.id)
      await select(id)
      return true
    } catch (failure) {
      ui.setNotice('error', 'Could not open ' + nextName + ': ' + failure.message, 8000)
      return false
    } finally {
      folderBusy = false
      isDecoding.value = false
    }
  }

  function step(delta) {
    if (items.value.length > 1) {
      const index = activeIndex.value
      const next = (index + delta + items.value.length) % items.value.length
      select(items.value[next].id)
      return
    }
    stepFolder(delta)
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

  function renderNow() {
    const item = activeItem.value
    if (!item || !sourceCanvas.value) return
    try {
      // Die Ansicht ist bereits skaliert - die Resize-Regel gilt nur beim Export.
      const canvas = processPhoto(sourceCanvas.value, item.edits, { skipResize: true })
      previewCanvas.value = markRaw(canvas)
      renderVersion.value++
      histogram.value = null
    } catch (error) {
      ui.setNotice('error', 'Processing failed: ' + error.message, 6000)
    } finally {
      isRendering.value = false
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
    { deep: true },
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
      sharpen: item.edits.sharpen,
      blur: item.edits.blur,
      vignette: item.edits.vignette,
      resize: { ...item.edits.resize },
    }
    for (const entry of items.value) {
      if (entry.id === item.id) continue
      Object.assign(entry.edits, {
        adjustments: { ...shared.adjustments },
        sharpen: shared.sharpen,
        blur: shared.blur,
        vignette: shared.vignette,
        resize: { ...shared.resize },
      })
    }
    ui.setNotice('success', 'Applied to ' + (items.value.length - 1) + ' other image(s).')
  }

  // --- History -----------------------------------------------------------
  function queueHistoryCommit() {
    if (historyTimer) clearTimeout(historyTimer)
    historyTimer = setTimeout(commitHistory, 350)
  }

  function entryFor(id) {
    if (!history.has(id)) history.set(id, { undo: [], redo: [] })
    return history.get(id)
  }

  function commitHistory() {
    const item = activeItem.value
    if (!item) return
    const serialized = JSON.stringify(item.edits)
    if (serialized === lastCommitted) return
    const entry = entryFor(item.id)
    if (lastCommitted) {
      entry.undo.push(lastCommitted)
      if (entry.undo.length > HISTORY_LIMIT) entry.undo.shift()
      entry.redo = []
    }
    lastCommitted = serialized
  }

  function undo() {
    const item = activeItem.value
    if (!item) return
    if (historyTimer) {
      clearTimeout(historyTimer)
      historyTimer = null
      commitHistory()
    }
    const entry = entryFor(item.id)
    const previous = entry.undo.pop()
    if (!previous) return
    entry.redo.push(JSON.stringify(item.edits))
    item.edits = JSON.parse(previous)
    lastCommitted = previous
  }

  function redo() {
    const item = activeItem.value
    if (!item) return
    const entry = entryFor(item.id)
    const next = entry.redo.pop()
    if (!next) return
    entry.undo.push(JSON.stringify(item.edits))
    item.edits = JSON.parse(next)
    lastCommitted = next
  }

  // --- Export ------------------------------------------------------------
  /**
   * Rendert ein Bild in Originalaufloesung. Pixelbasierte Effekte werden dabei
   * hochgerechnet, damit das Ergebnis der Vorschau entspricht.
   */
  async function renderItemFullSize(item, overrides = {}) {
    const canvas = await decodePhoto(item.file, { orientation: item.orientation })
    // Die Vorschau rechnet auf einer verkleinerten Kopie. Pixelbasierte Effekte
    // muessen deshalb um genau diesen Faktor mitwachsen - je Bild, nicht global.
    const viewScale = Math.min(1, VIEW_MAX_SIZE / Math.max(item.width, item.height))
    const factor = viewScale > 0 ? 1 / viewScale : 1
    const source = { ...item.edits, ...overrides }
    const edits = {
      ...source,
      adjustments: { ...source.adjustments },
      resize: overrides.resize || source.resize,
      blur: source.blur > 0 ? Math.max(1, Math.round(source.blur * factor)) : 0,
    }
    const result = processPhoto(canvas, edits)
    if (watermark.value.enabled) applyWatermark(result, watermark.value)
    return result
  }

  async function saveActiveAs(format = 'png', quality = 92) {
    const item = activeItem.value
    if (!item) return
    const config = EXPORT_FORMATS[format] || EXPORT_FORMATS.png
    const canvas = await renderItemFullSize(item)
    const blob = await canvasToBlob(canvas, format, quality / 100)
    const fileName = slugify(item.name) + '.' + config.extension
    const result = await saveBlob(blob, fileName)
    if (result.saved) ui.setNotice('success', 'Saved: ' + (result.path || fileName))
  }

  async function copyActiveToClipboard() {
    const item = activeItem.value
    if (!item) return
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      ui.setNotice('error', 'This browser does not support the clipboard.')
      return
    }
    const canvas = await renderItemFullSize(item)
    const blob = await canvasToBlob(canvas, 'png')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    ui.setNotice('success', 'PNG copied to the clipboard.')
  }

  function buildName(item, index, size, extension) {
    const base = (batch.value.pattern || '{name}')
      .replace(/\{name\}/g, item.name.replace(/\.[^.]+$/, ''))
      .replace(/\{index\}/g, String(index + 1).padStart(3, '0'))
      .replace(/\{width\}/g, String(size.width))
      .replace(/\{height\}/g, String(size.height))
      .replace(/[\\/:*?"<>|]/g, '-')
      .trim()
    return (base || 'image-' + (index + 1)) + '.' + extension
  }

  /** Verarbeitet alle Bilder nacheinander und laedt das Ergebnis als ZIP herunter. */
  async function runBatch() {
    if (!items.value.length) return
    const settings = batch.value
    const config = EXPORT_FORMATS[settings.format] || EXPORT_FORMATS.png
    const files = []
    const used = new Set()

    batchProgress.value = { done: 0, total: items.value.length, label: '' }

    try {
      for (let index = 0; index < items.value.length; index++) {
        const item = items.value[index]
        batchProgress.value = { done: index, total: items.value.length, label: item.name }

        const edits = settings.applyEdits
          ? { ...item.edits, resize: settings.resize }
          : { ...createEdits(), resize: settings.resize }

        const canvas = await renderItemFullSize(item, { ...edits, resize: settings.resize })
        const blob = await canvasToBlob(canvas, settings.format, settings.quality / 100)

        let name = buildName(item, index, { width: canvas.width, height: canvas.height }, config.extension)
        // Doppelte Namen wuerden sich im ZIP gegenseitig ueberschreiben.
        if (used.has(name)) {
          const dot = name.lastIndexOf('.')
          name = name.slice(0, dot) + '-' + (index + 1) + name.slice(dot)
        }
        used.add(name)
        files.push({ name, blob })

        // Dem Browser Luft zum Aufraeumen geben.
        await new Promise((resolve) => setTimeout(resolve, 0))
      }

      const result = await saveFileSet(files, { zipName: 'images-' + files.length + '.zip' })
      if (result.mode === 'canceled') {
        ui.setNotice('info', 'Export cancelled.')
      } else {
        ui.setNotice(
          'success',
          result.count + ' image(s) exported' + (result.path ? ' to ' + result.path : '.'),
        )
      }
    } catch (error) {
      ui.setNotice('error', 'Batch export failed: ' + error.message, 8000)
    } finally {
      batchProgress.value = null
    }
  }

  /** Geschaetzte Ausgabegroesse eines Bildes mit den aktuellen Stapel-Einstellungen. */
  function batchTargetSize(item) {
    const geometry = previewGeometry(item.width, item.height, {
      ...item.edits,
      resize: { mode: 'none', value: 0 },
    })
    return resolveTargetSize(geometry.width, geometry.height, batch.value.resize)
  }

  return {
    // State
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
    batch,
    watermark,
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
