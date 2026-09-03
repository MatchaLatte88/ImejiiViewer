import { computed, markRaw, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS, cloneSettings, processImage } from '../lib/pipeline.js'
import { detectBackgroundColor, loadImageFile, sampleColorAt } from '../lib/imageLoader.js'
import { canvasToBlob, renderSizeSet, renderToSize, slugify, EXPORT_FORMATS } from '../lib/exportImage.js'
import { createIcoBlob } from '../lib/ico.js'
import { saveBlob, saveFileSet } from '../lib/desktop.js'
import { getPreset } from '../lib/presets.js'
import { hexToRgb, rgbToHex } from '../lib/color.js'
import { useUiStore } from './ui.js'

/** Obere und untere Kantenlaenge, mit der die Vorschau gerechnet wird. */
const PREVIEW_MAX_SIZE = 1280
const PREVIEW_MIN_SIZE = 560

const HISTORY_LIMIT = 50
const PRESET_STORAGE_KEY = 'logo-creator:presets'

function loadStoredPresets() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export const useEditorStore = defineStore('editor', () => {
  // --- Quelle & Ergebnis -------------------------------------------------
  const source = shallowRef(null) // { name, width, height, imageData, ... }
  const previewCanvas = shallowRef(null)
  const originalCanvas = shallowRef(null)
  const renderVersion = ref(0)
  const isLoading = ref(false)
  const isRendering = ref(false)
  const ui = useUiStore()

  // --- Einstellungen -----------------------------------------------------
  const settings = ref(cloneSettings(DEFAULT_SETTINGS))

  // --- Werkzeuge / UI ----------------------------------------------------
  const activeTool = ref('background') // background | adjust | effects | transform
  const eyedropperMode = ref(null) // null | 'add' | 'replace'
  const showOriginal = ref(false)
  const zoom = ref(1)
  const fitToView = ref(true)
  const savedPresets = ref(loadStoredPresets())

  // --- History -----------------------------------------------------------
  const undoStack = ref([])
  const redoStack = ref([])
  let historyTimer = null
  let lastCommitted = JSON.stringify(settings.value)

  /** Faktor, mit dem die Vorschau gegenueber dem Original verkleinert wurde. */
  const previewScale = ref(1)
  /** Aktuell erlaubte Kantenlaenge der Vorschauberechnung (passt sich der Leistung an). */
  const previewBudget = ref(PREVIEW_MAX_SIZE)

  const hasImage = computed(() => source.value !== null)
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const keyColors = computed(() => settings.value.keying.keys)
  const outputSize = computed(() => {
    const canvas = previewCanvas.value
    if (!canvas || !source.value) return null
    // Die Vorschau ist skaliert - die echte Ausgabegroesse daraus hochrechnen.
    return {
      width: Math.round(canvas.width / previewScale.value),
      height: Math.round(canvas.height / previewScale.value),
    }
  })

  // Hinweise laufen zentral ueber den UI-Store, damit beide Modi dieselbe Anzeige nutzen.
  function setNotice(type, message, timeout = 4000) {
    ui.setNotice(type, message, timeout)
  }

  // --- Rendern -----------------------------------------------------------
  let renderHandle = null
  let renderFallback = null
  let qualityTimer = null

  function cancelPendingRender() {
    if (renderHandle) cancelAnimationFrame(renderHandle)
    if (renderFallback) clearTimeout(renderFallback)
    renderHandle = null
    renderFallback = null
  }

  function scheduleRender() {
    if (!source.value) return
    cancelPendingRender()
    if (qualityTimer) clearTimeout(qualityTimer)
    isRendering.value = true
    renderHandle = requestAnimationFrame(runScheduledRender)
    // Ohne Animationsframes (Hintergrundtab, verstecktes Fenster) wuerde die
    // Vorschau sonst stehen bleiben - deshalb ein zweiter Ausloeser.
    renderFallback = setTimeout(runScheduledRender, 200)
  }

  function runScheduledRender() {
    cancelPendingRender()
    renderNow()
    // Nach der Interaktion einmal in voller Vorschauqualitaet nachziehen.
    if (previewBudget.value < PREVIEW_MAX_SIZE) {
      qualityTimer = setTimeout(() => renderNow(true), 500)
    }
  }

  function renderNow(highQuality = false) {
    if (!source.value) return
    try {
      const longest = Math.max(source.value.width, source.value.height)
      const budget = highQuality ? PREVIEW_MAX_SIZE : previewBudget.value
      previewScale.value = longest > budget ? budget / longest : 1

      const started = performance.now()
      const canvas = processImage(source.value.imageData, settings.value, { maxSize: budget })
      const duration = performance.now() - started

      // Vorschauaufloesung an die tatsaechliche Rechenzeit anpassen: teure
      // Kombinationen (Kontur, Weichzeichner) bleiben so bedienbar.
      if (!highQuality) {
        if (duration > 90) {
          previewBudget.value = Math.max(PREVIEW_MIN_SIZE, Math.round(budget * 0.75))
        } else if (duration < 25 && budget < PREVIEW_MAX_SIZE) {
          previewBudget.value = Math.min(PREVIEW_MAX_SIZE, Math.round(budget * 1.3))
        }
      }

      previewCanvas.value = markRaw(canvas)
      renderVersion.value++
    } catch (error) {
      setNotice('error', 'Processing failed: ' + error.message, 6000)
    } finally {
      isRendering.value = false
    }
  }

  /** Rendert die Datei in voller Aufloesung - nur fuer den Export. */
  function renderFullResolution() {
    if (!source.value) throw new Error('No image loaded.')
    return processImage(source.value.imageData, settings.value)
  }

  watch(
    settings,
    () => {
      scheduleRender()
      queueHistoryCommit()
    },
    { deep: true },
  )

  // --- Datei laden -------------------------------------------------------
  async function loadFile(file) {
    isLoading.value = true
    try {
      const loaded = await loadImageFile(file)
      source.value = markRaw(loaded)
      previewScale.value = 1
      previewBudget.value = PREVIEW_MAX_SIZE

      const original = document.createElement('canvas')
      original.width = loaded.width
      original.height = loaded.height
      original.getContext('2d').putImageData(loaded.imageData, 0, 0)
      originalCanvas.value = markRaw(original)

      resetSettings({ silent: true })
      undoStack.value = []
      redoStack.value = []
      lastCommitted = JSON.stringify(settings.value)
      fitToView.value = true
      zoom.value = 1

      renderNow()

      if (loaded.scaled) {
        setNotice(
          'info',
          'Image reduced to ' + loaded.width + ' x ' + loaded.height + ' px (working limit).',
          6000,
        )
      }
    } catch (error) {
      setNotice('error', error.message, 8000)
      throw error
    } finally {
      isLoading.value = false
    }
  }

  function closeImage() {
    source.value = null
    previewCanvas.value = null
    originalCanvas.value = null
    resetSettings({ silent: true })
    undoStack.value = []
    redoStack.value = []
  }

  function resetSettings({ silent = false } = {}) {
    settings.value = cloneSettings(DEFAULT_SETTINGS)
    if (!silent) setNotice('info', 'All settings have been reset.')
  }

  // --- Hintergrund entfernen --------------------------------------------
  function addKeyColor(hex, { replace = false } = {}) {
    const rgb = hexToRgb(hex)
    if (!rgb) {
      setNotice('error', 'Invalid color value: ' + hex)
      return
    }
    const entry = { hex: rgbToHex(rgb.r, rgb.g, rgb.b), ...rgb }
    if (replace) {
      settings.value.keying.keys = [entry]
      settings.value.keying.seeds = []
      return
    }
    if (settings.value.keying.keys.some((key) => key.hex === entry.hex)) return
    settings.value.keying.keys.push(entry)
  }

  function removeKeyColor(index) {
    settings.value.keying.keys.splice(index, 1)
    if (!settings.value.keying.keys.length) settings.value.keying.seeds = []
  }

  function clearKeyColors() {
    settings.value.keying.keys = []
    settings.value.keying.seeds = []
  }

  /** Farbe an einer Bildkoordinate aufnehmen (Pipette). */
  function pickColorAtSource(x, y, { replace = false, addSeed = false } = {}) {
    if (!source.value) return null
    const sample = sampleColorAt(source.value.imageData, x, y, 1)
    if (!sample) {
      setNotice('error', 'This spot is already fully transparent.')
      return null
    }
    addKeyColor(sample.hex, { replace })
    if (addSeed && settings.value.keying.contiguous) {
      settings.value.keying.seeds.push({ x: Math.round(x), y: Math.round(y) })
    }
    return sample
  }

  function autoDetectBackground() {
    if (!source.value) return
    const detected = detectBackgroundColor(source.value.imageData)
    if (!detected) {
      setNotice('error', 'No background color could be detected.')
      return
    }
    addKeyColor(detected.hex, { replace: true })
    setNotice(
      'success',
      'Background color detected: ' +
        detected.hex +
        ' (' +
        Math.round(detected.ratio * 100) +
        '% of the border).',
    )
  }

  // --- History -----------------------------------------------------------
  function queueHistoryCommit() {
    if (historyTimer) clearTimeout(historyTimer)
    historyTimer = setTimeout(commitHistory, 350)
  }

  function commitHistory() {
    const serialized = JSON.stringify(settings.value)
    if (serialized === lastCommitted) return
    undoStack.value.push(lastCommitted)
    if (undoStack.value.length > HISTORY_LIMIT) undoStack.value.shift()
    redoStack.value = []
    lastCommitted = serialized
  }

  function undo() {
    if (historyTimer) {
      clearTimeout(historyTimer)
      historyTimer = null
      commitHistory()
    }
    const previous = undoStack.value.pop()
    if (!previous) return
    redoStack.value.push(JSON.stringify(settings.value))
    settings.value = JSON.parse(previous)
    lastCommitted = previous
  }

  function redo() {
    const next = redoStack.value.pop()
    if (!next) return
    undoStack.value.push(JSON.stringify(settings.value))
    settings.value = JSON.parse(next)
    lastCommitted = next
  }

  // --- Einstellungs-Presets ---------------------------------------------
  function persistPresets() {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(savedPresets.value))
    } catch (error) {
      setNotice('error', 'Preset could not be saved: ' + error.message)
    }
  }

  function savePreset(name) {
    const trimmed = (name || '').trim()
    if (!trimmed) {
      setNotice('error', 'Please enter a name for the preset.')
      return
    }
    const entry = {
      id: Date.now().toString(36),
      name: trimmed,
      settings: JSON.parse(JSON.stringify(settings.value)),
    }
    const existing = savedPresets.value.findIndex((preset) => preset.name === trimmed)
    if (existing >= 0) savedPresets.value.splice(existing, 1, entry)
    else savedPresets.value.push(entry)
    persistPresets()
    setNotice('success', 'Preset "' + trimmed + '" saved.')
  }

  function applySavedPreset(id) {
    const preset = savedPresets.value.find((entry) => entry.id === id)
    if (!preset) return
    settings.value = JSON.parse(JSON.stringify(preset.settings))
    setNotice('success', 'Preset "' + preset.name + '" applied.')
  }

  function deleteSavedPreset(id) {
    savedPresets.value = savedPresets.value.filter((entry) => entry.id !== id)
    persistPresets()
  }

  // --- Export ------------------------------------------------------------
  const baseName = computed(() => slugify(source.value?.name))

  async function exportSingle({ size = null, format = 'png', quality = 0.92, background = null }) {
    if (!source.value) return
    const canvas = renderFullResolution()
    const config = EXPORT_FORMATS[format] || EXPORT_FORMATS.png
    const fill = config.supportsAlpha ? background : background || '#ffffff'

    let target = canvas
    if (size) target = renderToSize(canvas, size, size, { background: fill })
    else if (fill) target = renderToSize(canvas, canvas.width, canvas.height, { background: fill })

    const blob = await canvasToBlob(target, format, quality)
    const suffix = size ? '-' + size : ''
    const fileName = baseName.value + suffix + '.' + config.extension
    const result = await saveBlob(blob, fileName)
    if (result.saved) setNotice('success', 'Saved: ' + (result.path || fileName))
  }

  async function exportIco(sizes) {
    if (!source.value) return
    const canvas = renderFullResolution()
    const blob = await createIcoBlob(canvas, sizes)
    const result = await saveBlob(blob, baseName.value + '.ico')
    if (result.saved) setNotice('success', 'ICO created with ' + sizes.length + ' sizes.')
  }

  async function exportCustomSizes(sizes, { format = 'png', quality = 0.92, background = null }) {
    if (!source.value || !sizes.length) return
    const canvas = renderFullResolution()
    const files = await renderSizeSet(canvas, sizes, {
      format,
      quality,
      background,
      baseName: baseName.value,
    })
    if (files.length === 1) {
      const result = await saveBlob(files[0].blob, files[0].name)
      if (result.saved) setNotice('success', 'Saved: ' + (result.path || files[0].name))
      return
    }

    const result = await saveFileSet(files, { zipName: baseName.value + '-icons.zip' })
    if (result.mode !== 'canceled') {
      setNotice('success', result.count + ' file(s) exported' + (result.path ? ' to ' + result.path : '.'))
    }
  }

  async function exportPreset(presetId, { format = 'png', quality = 0.92, background = null } = {}) {
    if (!source.value) return
    const preset = getPreset(presetId)
    if (!preset) throw new Error('Unknown preset: ' + presetId)

    const canvas = renderFullResolution()
    const files = []

    for (const entry of preset.pngs || []) {
      const target = renderToSize(canvas, entry.size, entry.size, { background })
      files.push({ name: entry.name, blob: await canvasToBlob(target, format, quality) })
    }

    if (preset.ico) {
      files.push({ name: preset.ico.name, blob: await createIcoBlob(canvas, preset.ico.sizes) })
    }

    for (const entry of preset.text || []) {
      files.push({ name: entry.name, text: entry.build(baseName.value) })
    }

    const result = await saveFileSet(files, { zipName: baseName.value + '-' + preset.id + '.zip' })
    if (result.mode !== 'canceled') {
      setNotice(
        'success',
        preset.name + ' exported (' + result.count + ' files)' + (result.path ? ' to ' + result.path : '.'),
      )
    }
  }

  /** Kopiert das Ergebnis als PNG in die Zwischenablage. */
  async function copyToClipboard() {
    if (!source.value) return
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      setNotice('error', 'This browser does not support the clipboard.')
      return
    }
    const blob = await canvasToBlob(renderFullResolution(), 'png')
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    setNotice('success', 'PNG copied to the clipboard.')
  }

  return {
    // State
    source,
    previewCanvas,
    originalCanvas,
    renderVersion,
    isLoading,
    isRendering,
    settings,
    activeTool,
    eyedropperMode,
    showOriginal,
    zoom,
    fitToView,
    savedPresets,
    // Getter
    hasImage,
    canUndo,
    canRedo,
    keyColors,
    outputSize,
    baseName,
    // Actions
    setNotice,
    loadFile,
    closeImage,
    resetSettings,
    addKeyColor,
    removeKeyColor,
    clearKeyColors,
    pickColorAtSource,
    autoDetectBackground,
    scheduleRender,
    renderFullResolution,
    undo,
    redo,
    savePreset,
    applySavedPreset,
    deleteSavedPreset,
    exportSingle,
    exportIco,
    exportCustomSizes,
    exportPreset,
    copyToClipboard,
  }
})
